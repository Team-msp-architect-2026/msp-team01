# backend/app/models/aws_account.py
import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


class AWSAccount(Base):
    __tablename__ = "aws_accounts"

    account_id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.user_id"), nullable=False)
    role_arn = Column(String(500), nullable=False)
    aws_account_id = Column(String(20), nullable=False)
    account_alias = Column(String(100), nullable=True)
    status = Column(String(20), nullable=False, default="connected")  # connected / disconnected
    connected_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="aws_accounts")
    projects = relationship("Project", back_populates="aws_account", lazy="select")