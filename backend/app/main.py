# backend/app/main.py
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from app.api import auth, accounts, projects, craft, mirror, websocket
from app.services.mirrorops.sqs_worker import start_sqs_worker


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(start_sqs_worker())
    yield
    task.cancel()


app = FastAPI(
    title="AutoOps API",
    description="멀티클라우드 인프라 자동화 플랫폼",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
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

@app.get("/health", tags=["health"])
def health_check():
    return {"status": "ok", "service": "autoops-backend"}