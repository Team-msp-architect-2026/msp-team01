# backend/app/models/deployment.py
import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Integer, Text, JSON, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


class Deployment(Base):
    __tablename__ = "deployments"

    deployment_id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String(36), ForeignKey("projects.project_id"), nullable=False)
    prefix = Column(String(20), nullable=False)
    environment = Column(String(20), nullable=False)
    terraform_code = Column(Text, nullable=False)
    config_snapshot = Column(JSON, nullable=False)
    validation_result = Column(JSON, nullable=True)
    status = Column(String(20), nullable=False, default="deploying")
    # status: deploying / completed / failed / partial_failed
    error_message = Column(Text, nullable=True)
    completed_resources = Column(Integer, nullable=True)
    total_resources = Column(Integer, nullable=True)
    ecs_task_id = Column(String(255), nullable=True)
    started_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    # Relationships
    project = relationship("Project", back_populates="deployments")
    resources = relationship("DeploymentResource", back_populates="deployment", lazy="select")


class DeploymentResource(Base):
    __tablename__ = "deployment_resources"

    resource_id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    deployment_id = Column(String(36), ForeignKey("deployments.deployment_id"), nullable=False)
    project_id = Column(String(36), ForeignKey("projects.project_id"), nullable=False)
    resource_type = Column(String(100), nullable=False)   # 예: aws_vpc
    resource_name = Column(String(255), nullable=False)   # 예: DD-prod-vpc
    resource_arn = Column(String(500), nullable=True)
    status = Column(String(20), nullable=False)           # created / failed
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Relationships
    deployment = relationship("Deployment", back_populates="resources")