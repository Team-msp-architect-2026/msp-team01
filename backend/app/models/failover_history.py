# backend/app/models/failover_history.py  (sync_history.py에 추가하거나 별도 파일로 생성)
import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Integer, Text, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


class FailoverHistory(Base):
    __tablename__ = "failover_history"

    failover_id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String(36), ForeignKey("projects.project_id"), nullable=False)
    package_id = Column(String(36), ForeignKey("dr_packages.package_id"), nullable=False)
    mode = Column(String(20), nullable=False)           # simulation / actual
    gcp_region = Column(String(50), nullable=False)
    status = Column(String(20), nullable=False, default="running")
    # status: running / completed / failed
    gcp_resources_created = Column(Integer, nullable=True)
    actual_rto_seconds = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    # Relationships
    project = relationship("Project", back_populates="failover_history")
    dr_package = relationship("DRPackage", back_populates="failover_history")