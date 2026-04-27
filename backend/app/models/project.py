# backend/app/models/project.py
import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


class Project(Base):
    __tablename__ = "projects"

    project_id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.user_id"), nullable=False)
    account_id = Column(String(36), ForeignKey("aws_accounts.account_id"), nullable=False)
    name = Column(String(100), nullable=False)
    prefix = Column(String(20), nullable=False)        # 네이밍 규칙: {prefix}-{env}-{resource}
    environment = Column(String(20), nullable=False)   # prod / staging / dev
    region = Column(String(50), nullable=False)
    status = Column(String(20), nullable=False, default="created")      # created→deploying→completed/failed
    dr_status = Column(String(20), nullable=False, default="not_ready") # not_ready→syncing→ready
    last_deployed_at = Column(DateTime, nullable=True)
    last_synced_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="projects")
    aws_account = relationship("AWSAccount", back_populates="projects")
    deployments = relationship("Deployment", back_populates="project", lazy="select")
    aws_resources = relationship("AWSResource", back_populates="project", lazy="select")
    sync_history = relationship("SyncHistory", back_populates="project", lazy="select")
    failover_history = relationship("FailoverHistory", back_populates="project", lazy="select")