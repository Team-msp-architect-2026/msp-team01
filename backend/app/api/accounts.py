# backend/app/api/accounts.py
import boto3
from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.core.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.aws_account import AWSAccount
from app.models.user import User

router = APIRouter()


class ConnectAccountRequest(BaseModel):
    role_arn: str
    account_alias: str | None = None


@router.post("/connect")
def connect_account(
    request: ConnectAccountRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Cross-Account IAM Role을 통해 사용자의 AWS 계정을 AutoOps에 연동한다.

    검증 흐름:
    1. STS AssumeRole (ExternalId = user_id)
    2. 임시 자격증명으로 get_caller_identity 호출
    3. 반환된 Account ID를 DB에 저장

    ExternalId를 user_id로 사용하는 이유:
    Confused Deputy 공격 방지 — 다른 사용자의 Role을 연동할 수 없도록 한다.
    사용자가 CloudFormation으로 AutoOpsRole 생성 시 ExternalId에 user_id가 자동 주입된다.

    로컬 개발 시 SKIP_ASSUME_ROLE=true:
    AutoOps 서버 계정 = 사용자 계정 동일 + MFA 정책으로 AssumeRole 불가
    → ARN에서 계정 ID 직접 추출하여 bypass
    ECS Fargate 배포 시 SKIP_ASSUME_ROLE=false:
    Task IAM Role로 MFA 없이 AssumeRole 정상 동작
    """
    sts = boto3.client("sts", region_name="us-west-2")

    if settings.skip_assume_role:
        # 로컬 개발용 bypass
        # ARN 형식: arn:aws:iam::{account_id}:role/AutoOpsRole
        aws_account_id = request.role_arn.split(":")[4]
    else:
        # 실제 AssumeRole (ECS Fargate 배포 시)
        try:
            assumed = sts.assume_role(
                RoleArn=request.role_arn,
                RoleSessionName="autoops-verification",
                ExternalId=current_user.user_id,
                DurationSeconds=900,
            )
        except ClientError as e:
            error_code = e.response["Error"]["Code"]
            if error_code in ("AccessDenied", "InvalidClientTokenId"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": "AWS_ROLE_ERROR",
                        "message": "IAM Role Assume에 실패했습니다. Role ARN과 ExternalId를 확인하세요.",
                    },
                )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "AWS_ROLE_ERROR", "message": str(e)},
            )

        temp_creds = assumed["Credentials"]
        temp_sts = boto3.client(
            "sts",
            aws_access_key_id=temp_creds["AccessKeyId"],
            aws_secret_access_key=temp_creds["SecretAccessKey"],
            aws_session_token=temp_creds["SessionToken"],
            region_name="us-west-2",
        )
        try:
            identity = temp_sts.get_caller_identity()
            aws_account_id = identity["Account"]
        except ClientError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "AWS_ROLE_ERROR", "message": "연동된 계정 정보를 확인할 수 없습니다."},
            )

    # 이미 연동된 계정 여부 확인
    existing = db.query(AWSAccount).filter(
        AWSAccount.user_id == current_user.user_id,
        AWSAccount.aws_account_id == aws_account_id,
        AWSAccount.status == "connected",
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "CONFLICT", "message": "이미 연동된 AWS 계정입니다."},
        )

    # DB 저장
    account = AWSAccount(
        user_id=current_user.user_id,
        role_arn=request.role_arn,
        aws_account_id=aws_account_id,
        account_alias=request.account_alias,
        status="connected",
    )
    db.add(account)
    db.commit()
    db.refresh(account)

    return {
        "success": True,
        "data": {
            "account_id": account.account_id,
            "aws_account_id": account.aws_account_id,
            "role_arn": account.role_arn,
            "account_alias": account.account_alias,
            "status": account.status,
            "connected_at": account.connected_at.isoformat(),
        },
    }

@router.get("")
def list_accounts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """연동된 AWS 계정 목록을 반환한다."""
    accounts = db.query(AWSAccount).filter(
        AWSAccount.user_id == current_user.user_id,
        AWSAccount.status == "connected",
    ).all()

    return {
        "success": True,
        "data": [
            {
                "account_id": acc.account_id,
                "aws_account_id": acc.aws_account_id,
                "role_arn": acc.role_arn,
                "account_alias": acc.account_alias,
                "status": acc.status,
                "connected_at": acc.connected_at.isoformat(),
            }
            for acc in accounts
        ],
    }


@router.delete("/{account_id}")
def disconnect_account(
    account_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """AWS 계정 연동을 해제한다. status를 disconnected로 변경한다."""
    account = db.query(AWSAccount).filter(
        AWSAccount.account_id == account_id,
        AWSAccount.user_id == current_user.user_id,
    ).first()

    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "연동된 AWS 계정을 찾을 수 없습니다."},
        )

    account.status = "disconnected"
    db.commit()

    return {"success": True, "message": "AWS 계정 연동이 해제되었습니다."}