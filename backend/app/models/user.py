# backend/app/models/user.py
import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime
from sqlalchemy.orm import relationship
from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    user_id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String(255), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    cognito_sub = Column(String(255), unique=True, nullable=False)
    slack_webhook_url = Column(String(500), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    aws_accounts = relationship("AWSAccount", back_populates="user", lazy="select")
    projects = relationship("Project", back_populates="user", lazy="select")