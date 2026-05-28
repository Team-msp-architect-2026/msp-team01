# backend/app/models/governance.py
import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Integer, Text, Boolean, JSON, Float, ARRAY
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class OnboardingScan(Base):
    __tablename__ = "onboarding_scans"

    id              = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id      = Column(String(36), nullable=False)
    account_id      = Column(String(20), nullable=False)
    scanned_regions = Column(JSON, nullable=True)       # ["us-west-2", "ap-northeast-2"]
    total_resources = Column(Integer, nullable=True)
    scan_result     = Column(JSON, nullable=True)
    # { "us-west-2/vpc-0abc123": { "vpc_id": "...", "resources": [...] }, ... }
    status          = Column(String(20), nullable=False, default="scanning")
    # scanning / pending_confirm / completed / failed
    scanned_at      = Column(DateTime, nullable=False, default=datetime.utcnow)
    confirmed_at    = Column(DateTime, nullable=True)


class ResourceBaseline(Base):
    __tablename__ = "resource_baselines"

    id              = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id      = Column(String(36), nullable=False)
    source          = Column(String(20), nullable=False)  # craftops_deploy | onboarding
    resource_type   = Column(String(100), nullable=False)
    resource_id_aws = Column(String(255), nullable=False)
    baseline_config = Column(JSON, nullable=False)
    created_at      = Column(DateTime, nullable=False, default=datetime.utcnow)


class DriftEvent(Base):
    __tablename__ = "drift_events"

    id              = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id      = Column(String(36), nullable=False)
    resource_id_aws = Column(String(255), nullable=False)
    resource_type   = Column(String(100), nullable=False)
    changed_by      = Column(String(500), nullable=True)
    diff_summary    = Column(Text, nullable=True)
    diff_detail     = Column(JSON, nullable=True)
    severity        = Column(String(10), nullable=False)
    # CRITICAL / HIGH / MEDIUM / LOW
    status          = Column(String(20), nullable=False, default="detected")
    # detected / accepted / guided
    detected_at     = Column(DateTime, nullable=False, default=datetime.utcnow)
    resolved_at     = Column(DateTime, nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id          = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id  = Column(String(36), nullable=True)
    user_id     = Column(String(36), nullable=True)
    # nullable: 레이어 2(AWS 변경), 레이어 3(Validation 차단)에서는 NULL
    layer       = Column(String(20), nullable=False)
    # platform / aws_change / validation_block
    action      = Column(String(100), nullable=True)
    actor       = Column(String(500), nullable=True)
    # 레이어 1: user_id 문자열
    # 레이어 2: AWS IAM ARN
    # 레이어 3: 'system'
    detail      = Column(JSON, nullable=True)
    created_at  = Column(DateTime, nullable=False, default=datetime.utcnow)


class ProjectDocument(Base):
    __tablename__ = "project_documents"

    id           = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id   = Column(String(36), nullable=False)
    source       = Column(String(20), nullable=False)  # craftops_deploy | onboarding
    mermaid_code = Column(Text, nullable=True)
    description  = Column(Text, nullable=True)
    generated_at = Column(DateTime, nullable=False, default=datetime.utcnow)