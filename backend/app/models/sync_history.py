# backend/app/models/sync_history.py
import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Integer, Text, JSON, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


class SyncHistory(Base):
    __tablename__ = "sync_history"

    sync_id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String(36), ForeignKey("projects.project_id"), nullable=False)
    trigger_type = Column(String(50), nullable=False)
    # trigger_type: deployment_completed / infra_changed / manual
    status = Column(String(20), nullable=False, default="running")
    # status: running / completed / failed
    snapshot_status = Column(String(20), nullable=False, default="pending")
    # snapshot_status: pending / exporting / ready / failed
    aws_resources_detected = Column(Integer, nullable=True)
    gcp_resources_mapped = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)  # Phase 1 완료 기준

    # Relationships
    project = relationship("Project", back_populates="sync_history")
    dr_package = relationship("DRPackage", back_populates="sync_history", uselist=False)
    gcp_mappings = relationship("GCPMapping", foreign_keys="GCPMapping.sync_id",
                                primaryjoin="SyncHistory.sync_id == GCPMapping.sync_id",
                                lazy="select")


class DRPackage(Base):
    __tablename__ = "dr_packages"

    package_id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String(36), ForeignKey("projects.project_id"), nullable=False)
    sync_id = Column(String(36), ForeignKey("sync_history.sync_id"), nullable=False)
    s3_path = Column(String(500), nullable=False)
    terraform_code_path = Column(String(500), nullable=False)
    image_ref_path = Column(String(500), nullable=True)
    gcr_image_uri = Column(String(500), nullable=True)
    snapshot_ref_path = Column(String(500), nullable=True)
    snapshot_export_s3_path = Column(String(500), nullable=True)
    snapshot_status = Column(String(20), nullable=False, default="pending")
    # snapshot_status: pending / exporting / ready / failed
    rto_minutes = Column(Integer, nullable=False, default=12)
    rpo_minutes = Column(Integer, nullable=False, default=3)
    confidence_auto = Column(Integer, nullable=False, default=0)
    confidence_review = Column(Integer, nullable=False, default=0)
    confidence_manual = Column(Integer, nullable=False, default=0)
    checklist = Column(JSON, nullable=False, default=list)
    is_latest = Column(Boolean, nullable=False, default=True)
    status = Column(String(20), nullable=False, default="preparing")
    # status: preparing / ready / failed
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Relationships
    sync_history = relationship("SyncHistory", back_populates="dr_package")
    failover_history = relationship("FailoverHistory", back_populates="dr_package", lazy="select")