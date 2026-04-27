# backend/app/models/gcp_mapping.py
import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


class GCPMapping(Base):
    __tablename__ = "gcp_mappings"

    mapping_id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    resource_id = Column(String(36), ForeignKey("aws_resources.resource_id"), nullable=False)
    project_id = Column(String(36), ForeignKey("projects.project_id"), nullable=False)
    sync_id = Column(String(36), ForeignKey("sync_history.sync_id"), nullable=False)
    gcp_resource_type = Column(String(100), nullable=False)   # 예: google_compute_network
    gcp_resource_name = Column(String(255), nullable=False)
    terraform_code = Column(Text, nullable=False)
    confidence = Column(String(20), nullable=False)           # auto / review / manual
    review_reason = Column(Text, nullable=True)
    user_confirmed = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Relationships
    aws_resource = relationship("AWSResource", back_populates="gcp_mappings")