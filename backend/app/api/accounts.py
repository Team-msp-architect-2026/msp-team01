# backend/app/api/accounts.py
import boto3
import json as _json
from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.aws_account import AWSAccount
from app.models.user import User

router = APIRouter()


class ConnectAccountRequest(BaseModel):
    role_arn: str
    account_alias: str | None = None


def _setup_config_and_drift(temp_creds: dict, aws_account_id: str):
    """
    사용자 계정에 AWS Config 설정 + 플랫폼 리소스 정책 업데이트.
    계정 연동 시 1회 실행. 이미 설정된 경우 스킵.

    CF 스택(autoops-role.yaml)에서 처리하는 것:
      - AutoOpsDriftEventRole
      - EventBridge Rules (Drift 감지 + RDS 스냅샷 완료)
      - KMS Key (alias/autoops-rds-export)

    accounts.py에서 처리하는 것:
      - AWS Config (S3, ConfigRole, Recorder, Delivery, Recording)
      - 플랫폼 SQS 정책 업데이트 (Drift + MirrorOps)
      - 플랫폼 DR S3 버킷 정책 업데이트
    """
    region             = "us-west-2"
    platform_account_id = "611058323802"
    bucket_name        = f"autoops-config-{aws_account_id}"
    sqs_arn            = f"arn:aws:sqs:{region}:{platform_account_id}:autoops-drift-events"
    mirrorops_sqs_arn  = f"arn:aws:sqs:{region}:{platform_account_id}:autoops-mirrorops-trigger"
    queue_url          = f"https://sqs.{region}.amazonaws.com/{platform_account_id}/autoops-drift-events"
    mirrorops_queue_url = f"https://sqs.{region}.amazonaws.com/{platform_account_id}/autoops-mirrorops-trigger"

    def _client(service):
        return boto3.client(
            service,
            region_name=region,
            aws_access_key_id=temp_creds["AccessKeyId"],
            aws_secret_access_key=temp_creds["SecretAccessKey"],
            aws_session_token=temp_creds["SessionToken"],
        )

    try:
        # ── 1. S3 버킷 생성 (Config 전송용) ─────────────────────────
        s3 = _client("s3")
        try:
            s3.create_bucket(
                Bucket=bucket_name,
                CreateBucketConfiguration={"LocationConstraint": region},
            )
            s3.put_bucket_policy(
                Bucket=bucket_name,
                Policy=f'''{{
                    "Version": "2012-10-17",
                    "Statement": [{{
                        "Effect": "Allow",
                        "Principal": {{"Service": "config.amazonaws.com"}},
                        "Action": ["s3:GetBucketAcl", "s3:PutObject"],
                        "Resource": [
                            "arn:aws:s3:::{bucket_name}",
                            "arn:aws:s3:::{bucket_name}/*"
                        ]
                    }}]
                }}''',
            )
            print(f"[Config] S3 버킷 생성: {bucket_name}")
        except ClientError as e:
            if e.response["Error"]["Code"] == "BucketAlreadyOwnedByYou":
                print(f"[Config] S3 버킷 이미 존재: {bucket_name}")
            else:
                raise

        # ── 2. ConfigRole 생성 ───────────────────────────────────────
        iam = _client("iam")
        try:
            iam.create_role(
                RoleName="AutoOpsConfigRole",
                AssumeRolePolicyDocument='''{
                    "Version": "2012-10-17",
                    "Statement": [{
                        "Effect": "Allow",
                        "Principal": {"Service": "config.amazonaws.com"},
                        "Action": "sts:AssumeRole"
                    }]
                }''',
            )
            iam.attach_role_policy(
                RoleName="AutoOpsConfigRole",
                PolicyArn="arn:aws:iam::aws:policy/ReadOnlyAccess",
            )
            print("[Config] ConfigRole 생성 완료")
        except ClientError as e:
            if e.response["Error"]["Code"] == "EntityAlreadyExists":
                print("[Config] ConfigRole 이미 존재")
            else:
                raise

        config_role_arn = iam.get_role(RoleName="AutoOpsConfigRole")["Role"]["Arn"]

        # ── 3. ConfigRecorder 생성 ───────────────────────────────────
        config = _client("config")
        try:
            existing = config.describe_configuration_recorders()
            if not existing.get("ConfigurationRecorders"):
                config.put_configuration_recorder(
                    ConfigurationRecorder={
                        "name": "autoops-config-recorder",
                        "roleARN": config_role_arn,
                        "recordingGroup": {
                            "allSupported": True,
                            "includeGlobalResourceTypes": True,
                        },
                    }
                )
                print("[Config] ConfigRecorder 생성 완료")
            else:
                print("[Config] ConfigRecorder 이미 존재")
        except ClientError as e:
            raise

        # ── 4. DeliveryChannel 생성 ──────────────────────────────────
        try:
            existing = config.describe_delivery_channels()
            if not existing.get("DeliveryChannels"):
                config.put_delivery_channel(
                    DeliveryChannel={
                        "name": "autoops-config-delivery",
                        "s3BucketName": bucket_name,
                    }
                )
                print("[Config] DeliveryChannel 생성 완료")
            else:
                print("[Config] DeliveryChannel 이미 존재")
        except ClientError as e:
            raise

        # ── 5. Config Recording 시작 ─────────────────────────────────
        try:
            status_resp = config.describe_configuration_recorder_status()
            recorders = status_resp.get("ConfigurationRecordersStatus", [])
            if not recorders or not recorders[0].get("recording"):
                config.start_configuration_recorder(
                    ConfigurationRecorderName="autoops-config-recorder"
                )
                print("[Config] Config Recording 시작")
            else:
                print("[Config] Config Recording 이미 실행 중")
        except ClientError as e:
            raise

        # ── 6. AutoOpsRole IAM 안전망 (CF 스택 미사용 계정 대응) ────
        try:
            iam.put_role_policy(
                RoleName="AutoOpsRole",
                PolicyName="AutoOpsIAMWritePolicy",
                PolicyDocument='''{
                    "Version": "2012-10-17",
                    "Statement": [{
                        "Effect": "Allow",
                        "Action": [
                            "iam:ListRoles",
                            "iam:GetRole",
                            "iam:ListRolePolicies",
                            "iam:ListAttachedRolePolicies"
                        ],
                        "Resource": "*"
                    }]
                }''',
            )
            print("[Config] AutoOpsRole IAM 안전망 추가 완료")
        except ClientError as e:
            print(f"[Config] AutoOpsRole IAM 안전망 추가 실패 (무시): {e}")

        # ── 7. AutoOpsDriftEventRole ARN 조회 ────────────────────────
        # CF 스택에서 생성됨. 플랫폼 SQS 정책 업데이트에 필요.
        try:
            drift_role_arn = iam.get_role(
                RoleName="AutoOpsDriftEventRole"
            )["Role"]["Arn"]
        except ClientError:
            drift_role_arn = f"arn:aws:iam::{aws_account_id}:role/AutoOpsDriftEventRole"

        # ── 8. 플랫폼 Drift SQS 정책 업데이트 ──────────────────────
        try:
            platform_sqs = boto3.client("sqs", region_name=region)
            existing_policy_str = platform_sqs.get_queue_attributes(
                QueueUrl=queue_url,
                AttributeNames=["Policy"],
            ).get("Attributes", {}).get("Policy", "")

            policy = _json.loads(existing_policy_str) if existing_policy_str else {
                "Version": "2012-10-17",
                "Statement": [],
            }

            new_sid = f"AllowCrossAccount_{aws_account_id}"
            existing_sids = [s.get("Sid", "") for s in policy["Statement"]]

            if new_sid not in existing_sids:
                policy["Statement"].append({
                    "Sid": new_sid,
                    "Effect": "Allow",
                    "Principal": {"AWS": drift_role_arn},
                    "Action": "sqs:SendMessage",
                    "Resource": sqs_arn,
                })
                platform_sqs.set_queue_attributes(
                    QueueUrl=queue_url,
                    Attributes={"Policy": _json.dumps(policy)},
                )
                print(f"[Config] Drift SQS 정책 업데이트 완료: {drift_role_arn}")
            else:
                print(f"[Config] Drift SQS 정책 이미 존재: {new_sid}")
        except Exception as e:
            print(f"[Config] Drift SQS 정책 업데이트 실패 (무시): {e}")

        # ── 9. 플랫폼 MirrorOps SQS 정책 업데이트 ───────────────────
        try:
            existing_policy_str = platform_sqs.get_queue_attributes(
                QueueUrl=mirrorops_queue_url,
                AttributeNames=["Policy"],
            ).get("Attributes", {}).get("Policy", "")

            policy = _json.loads(existing_policy_str) if existing_policy_str else {
                "Version": "2012-10-17",
                "Statement": [],
            }

            new_sid = f"AllowCrossAccountMirrorOps_{aws_account_id}"
            existing_sids = [s.get("Sid", "") for s in policy["Statement"]]

            if new_sid not in existing_sids:
                policy["Statement"].append({
                    "Sid": new_sid,
                    "Effect": "Allow",
                    "Principal": {"AWS": drift_role_arn},
                    "Action": "sqs:SendMessage",
                    "Resource": mirrorops_sqs_arn,
                })
                platform_sqs.set_queue_attributes(
                    QueueUrl=mirrorops_queue_url,
                    Attributes={"Policy": _json.dumps(policy)},
                )
                print(f"[Config] MirrorOps SQS 정책 업데이트 완료: {drift_role_arn}")
            else:
                print(f"[Config] MirrorOps SQS 정책 이미 존재: {new_sid}")
        except Exception as e:
            print(f"[Config] MirrorOps SQS 정책 업데이트 실패 (무시): {e}")

        # ── 10. autoops-dr-packages S3 버킷 정책 업데이트 ───────────
        try:
            platform_s3 = boto3.client("s3", region_name=region)
            bucket_name_dr = "autoops-dr-packages"

            existing_policy_str = ""
            try:
                resp = platform_s3.get_bucket_policy(Bucket=bucket_name_dr)
                existing_policy_str = resp.get("Policy", "")
            except Exception:
                pass

            policy = _json.loads(existing_policy_str) if existing_policy_str else {
                "Version": "2012-10-17",
                "Statement": [],
            }

            new_sid = f"AllowAutoOpsRole_{aws_account_id}"
            existing_sids = [s.get("Sid", "") for s in policy["Statement"]]

            if new_sid not in existing_sids:
                autoops_role_arn    = f"arn:aws:iam::{aws_account_id}:role/AutoOpsRole"
                rds_export_role_arn = f"arn:aws:iam::{aws_account_id}:role/AutoOpsRDSExportRole"

                policy["Statement"].append({
                    "Sid": new_sid,
                    "Effect": "Allow",
                    "Principal": {"AWS": [autoops_role_arn, rds_export_role_arn]},
                    "Action": [
                        "s3:PutObject", "s3:GetObject",
                        "s3:ListBucket", "s3:DeleteObject",
                        "s3:GetBucketLocation",
                    ],
                    "Resource": [
                        f"arn:aws:s3:::{bucket_name_dr}",
                        f"arn:aws:s3:::{bucket_name_dr}/*",
                    ],
                })
                platform_s3.put_bucket_policy(
                    Bucket=bucket_name_dr,
                    Policy=_json.dumps(policy),
                )
                print(f"[Config] DR S3 버킷 정책 업데이트 완료: {aws_account_id}")
            else:
                print(f"[Config] DR S3 버킷 정책 이미 존재: {new_sid}")
        except Exception as e:
            print(f"[Config] DR S3 버킷 정책 업데이트 실패 (무시): {e}")

        print(f"[Config] 계정 {aws_account_id} 설정 완료")

    except Exception as e:
        # Config 설정 실패해도 계정 연동 자체는 성공으로 처리
        print(f"[Config] 설정 중 오류 (무시): {e}")


@router.post("/connect")
def connect_account(
    request: ConnectAccountRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sts = boto3.client("sts", region_name="us-west-2")

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

    # Config + 플랫폼 리소스 설정 (연동 시 즉시 실행)
    _setup_config_and_drift(temp_creds, aws_account_id)

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