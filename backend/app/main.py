# backend/app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
# from app.api import auth, accounts, projects, craft, mirror, websocket

app = FastAPI(
    title="AutoOps API",
    description="멀티클라우드 인프라 자동화 플랫폼",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

#app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
#app.include_router(accounts.router, prefix="/api/accounts", tags=["accounts"])
#app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
#app.include_router(craft.router, prefix="/api/craft", tags=["craftops"])
#app.include_router(mirror.router, prefix="/api/mirror", tags=["mirrorops"])
#app.include_router(websocket.router, tags=["websocket"])


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "autoops-backend"}