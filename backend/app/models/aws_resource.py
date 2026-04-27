# backend/app/models/aws_resource.py
import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, JSON, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


class AWSResource(Base):
    __tablename__ = "aws_resources"

    resource_id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String(36), ForeignKey("projects.project_id"), nullable=False)
    resource_type = Column(String(100), nullable=False)
    resource_name = Column(String(255), nullable=False)
    resource_id_aws = Column(String(500), nullable=False)   # AWS 리소스 ID
    config_json = Column(JSON, nullable=False)              # 리소스 상세 설정값
    detected_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    project = relationship("Project", back_populates="aws_resources")
    gcp_mappings = relationship("GCPMapping", back_populates="aws_resource", lazy="select")