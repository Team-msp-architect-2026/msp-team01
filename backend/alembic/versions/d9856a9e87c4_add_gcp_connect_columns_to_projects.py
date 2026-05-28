"""add_gcp_connect_columns_to_projects

Revision ID: d9856a9e87c4
Revises: d69c0a036a7b
Create Date: 2026-05-28 15:22:22.495891

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd9856a9e87c4'
down_revision: Union[str, None] = 'd69c0a036a7b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('gcp_project_id',   sa.String(length=100), nullable=True))
    op.add_column('projects', sa.Column('gcp_secret_arn',   sa.String(length=500), nullable=True))
    op.add_column('projects', sa.Column('gcp_sa_email',     sa.String(length=200), nullable=True))
    op.add_column('projects', sa.Column('gcp_connected_at', sa.DateTime(),          nullable=True))


def downgrade() -> None:
    op.drop_column('projects', 'gcp_connected_at')
    op.drop_column('projects', 'gcp_sa_email')
    op.drop_column('projects', 'gcp_secret_arn')
    op.drop_column('projects', 'gcp_project_id')
