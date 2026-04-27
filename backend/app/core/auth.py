# backend/app/core/auth.py
import json
import httpx
import jwt
from jwt.algorithms import RSAAlgorithm
from functools import lru_cache
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db

security = HTTPBearer()


@lru_cache(maxsize=1)
def get_cognito_public_keys() -> dict:
    """
    Cognito JWKS(JSON Web Key Set) 공개키를 조회한다.
    lru_cache로 애플리케이션 수명 동안 1회만 조회한다.
    """
    jwks_url = (
        f"https://cognito-idp.{settings.aws_default_region}.amazonaws.com"
        f"/{settings.cognito_user_pool_id}/.well-known/jwks.json"
    )
    response = httpx.get(jwks_url, timeout=10)
    response.raise_for_status()
    jwks = response.json()

    # kid → 공개키 객체 매핑
    public_keys = {}
    for key_data in jwks["keys"]:
        kid = key_data["kid"]
        public_keys[kid] = RSAAlgorithm.from_jwk(json.dumps(key_data))

    return public_keys


def verify_cognito_token(token: str) -> dict:
    """
    Cognito JWT 토큰을 검증하고 payload를 반환한다.
    검증 항목: 서명, 만료 시간, 발급자(iss), 토큰 사용 용도(token_use)
    """
    try:
        # 헤더에서 kid 추출 (검증 전 공개키 선택용)
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")

        public_keys = get_cognito_public_keys()
        if kid not in public_keys:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "UNAUTHORIZED", "message": "유효하지 않은 토큰입니다."},
            )

        expected_issuer = (
            f"https://cognito-idp.{settings.aws_default_region}.amazonaws.com"
            f"/{settings.cognito_user_pool_id}"
        )

        payload = jwt.decode(
            token,
            public_keys[kid],
            algorithms=["RS256"],
            options={"verify_aud": False},  # Cognito access_token은 aud 미포함
        )

        # 발급자 검증
        if payload.get("iss") != expected_issuer:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "UNAUTHORIZED", "message": "토큰 발급자가 올바르지 않습니다."},
            )

        # access_token 여부 확인
        if payload.get("token_use") != "access":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "UNAUTHORIZED", "message": "access_token이 아닙니다."},
            )

        return payload

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "토큰이 만료되었습니다."},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "유효하지 않은 토큰입니다."},
        )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
):
    """
    FastAPI 의존성 주입용 현재 사용자 조회.
    JWT 검증 → cognito_sub로 DB users 테이블 조회.
    """
    from app.models.user import User

    token = credentials.credentials
    payload = verify_cognito_token(token)

    cognito_sub = payload.get("sub")
    if not cognito_sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "사용자 정보를 확인할 수 없습니다."},
        )

    user = db.query(User).filter(User.cognito_sub == cognito_sub).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "등록되지 않은 사용자입니다. 로그인을 먼저 진행하세요."},
        )

    return user