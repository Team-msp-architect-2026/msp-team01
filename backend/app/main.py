# backend/app/main.py
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from app.api import auth, accounts, projects, craft, mirror, websocket
from app.api.gcp_connect import router as gcp_connect_router
from app.services.mirrorops.sqs_worker import start_sqs_worker
from app.services.governance.drift_worker import start_drift_worker
from app.core.config import settings
from app.api.onboarding import router as onboarding_router
from app.api.drift import router as drift_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 서버 켜질 때 SQS 워커를 백그라운드 태스크로 실행
    worker_task = asyncio.create_task(start_sqs_worker())
    print("✅ MirrorOps SQS 워커 백그라운드 실행 시작")

    drift_task = asyncio.create_task(start_drift_worker())
    print("✅ Drift Worker 백그라운드 실행 시작")
    
    yield # API 서버 동작 중...
    
    # 서버 꺼질 때 워커 종료 처리
    worker_task.cancel()
    drift_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        print("🛑 MirrorOps SQS 워커 종료 완료")

    try:
        await drift_task
    except asyncio.CancelledError:
        print("🛑 Drift Worker 종료 완료")

app = FastAPI(
    title="AutoOps API",
    description="멀티클라우드 인프라 자동화 플랫폼",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    detail = exc.detail
    if isinstance(detail, dict):
        error = detail
    else:
        error = {"code": "INTERNAL_ERROR", "message": str(detail)}
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "error": error},
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    message = f"{errors[0]['loc'][-1]}:{errors[0]['msg']}" if errors else "입력값이 올바르지 않습니다."
    return JSONResponse(
        status_code=422,
        content={
            "success": False,
            "error": {"code": "VALIDATION_ERROR", "message": message},
        },
    )

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(accounts.router, prefix="/api/accounts", tags=["accounts"])
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(craft.router, prefix="/api/craft", tags=["craftops"])
app.include_router(mirror.router, prefix="/api/mirror", tags=["mirrorops"])
app.include_router(websocket.router, tags=["websocket"])
app.include_router(onboarding_router)
app.include_router(drift_router)
app.include_router(gcp_connect_router, prefix="/api/projects", tags=["gcp"])

@app.get("/health", tags=["health"])
def health_check():
    return {"status": "ok", "service": "autoops-backend"}