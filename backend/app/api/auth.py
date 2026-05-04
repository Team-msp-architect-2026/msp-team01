# backend/app/api/auth.py
import boto3
from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db
from app.models.user import User

router = APIRouter()
security = HTTPBearer()


# ── Request / Response 스키마 ──────────────────────────────────────
class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    user: dict

class RefreshRequest(BaseModel):
    refresh_token: str

class SignupRequest(BaseModel):
    email: str
    password: str
    name: str

class ConfirmRequest(BaseModel):
    email: str
    code: str


@router.post("/login")
def login(request: LoginRequest, db: Session = Depends(get_db)):
    cognito = boto3.client("cognito-idp", region_name=settings.aws_default_region)

    try:
        response = cognito.initiate_auth(
            AuthFlow="USER_PASSWORD_AUTH",
            AuthParameters={
                "USERNAME": request.email,
                "PASSWORD": request.password,
            },
            ClientId=settings.cognito_client_id,
        )
    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code in ("NotAuthorizedException", "UserNotFoundException"):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "UNAUTHORIZED", "message": "이메일 또는 비밀번호가 올바르지 않습니다."},
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "인증 서버 오류가 발생했습니다."},
        )

    auth_result = response["AuthenticationResult"]
    access_token = auth_result["AccessToken"]
    refresh_token = auth_result["RefreshToken"]

    user_info = cognito.get_user(AccessToken=access_token)
    attributes = {attr["Name"]: attr["Value"] for attr in user_info["UserAttributes"]}

    cognito_sub = attributes["sub"]
    email = attributes["email"]
    name = attributes.get("name", email.split("@")[0])

    user = db.query(User).filter(User.cognito_sub == cognito_sub).first()
    if not user:
        user = User(
            cognito_sub=cognito_sub,
            email=email,
            name=name,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    from app.models.aws_account import AWSAccount
    aws_connected = db.query(AWSAccount).filter(
        AWSAccount.user_id == user.user_id,
        AWSAccount.status == "connected"
    ).first() is not None

    return {
        "success": True,
        "data": {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_in": 3600,
            "user": {
                "user_id": user.user_id,
                "email": user.email,
                "name": user.name,
                "aws_connected": aws_connected,
            },
        },
    }


@router.post("/logout")
def logout(
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    cognito = boto3.client("cognito-idp", region_name=settings.aws_default_region)

    try:
        cognito.global_sign_out(AccessToken=credentials.credentials)
    except ClientError:
        pass

    return {"success": True, "message": "로그아웃 되었습니다."}


@router.post("/refresh")
def refresh_token(request: RefreshRequest):
    cognito = boto3.client("cognito-idp", region_name=settings.aws_default_region)

    try:
        response = cognito.initiate_auth(
            AuthFlow="REFRESH_TOKEN_AUTH",
            AuthParameters={"REFRESH_TOKEN": request.refresh_token},
            ClientId=settings.cognito_client_id,
        )
    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "NotAuthorizedException":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "UNAUTHORIZED", "message": "refresh_token이 만료되었습니다. 다시 로그인하세요."},
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "토큰 갱신 중 오류가 발생했습니다."},
        )

    auth_result = response["AuthenticationResult"]
    return {
        "success": True,
        "data": {
            "access_token": auth_result["AccessToken"],
            "expires_in": 3600,
        },
    }


@router.post("/signup")
def signup(request: SignupRequest):
    cognito = boto3.client("cognito-idp", region_name=settings.aws_default_region)
    try:
        cognito.sign_up(
            ClientId=settings.cognito_client_id,
            Username=request.email,
            Password=request.password,
            UserAttributes=[
                {"Name": "email", "Value": request.email},
                {"Name": "name", "Value": request.name},
            ]
        )
        return {"success": True, "data": {"message": "인증 코드가 이메일로 발송되었습니다."}}
    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "UsernameExistsException":
            raise HTTPException(
                status_code=400,
                detail={"code": "USER_EXISTS", "message": "이미 사용 중인 이메일입니다."}
            )
        raise HTTPException(
            status_code=500,
            detail={"code": "INTERNAL_ERROR", "message": str(e)}
        )


@router.post("/confirm")
def confirm(request: ConfirmRequest):
    cognito = boto3.client("cognito-idp", region_name=settings.aws_default_region)
    try:
        cognito.confirm_sign_up(
            ClientId=settings.cognito_client_id,
            Username=request.email,
            ConfirmationCode=request.code,
        )
        return {"success": True, "data": {"message": "이메일 인증이 완료되었습니다."}}
    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "CodeMismatchException":
            raise HTTPException(
                status_code=400,
                detail={"code": "INVALID_CODE", "message": "인증 코드가 올바르지 않습니다."}
            )
        if error_code == "ExpiredCodeException":
            raise HTTPException(
                status_code=400,
                detail={"code": "EXPIRED_CODE", "message": "인증 코드가 만료되었습니다."}
            )
        raise HTTPException(
            status_code=500,
            detail={"code": "INTERNAL_ERROR", "message": str(e)}
        )