"""Uploaded profile photo on users (512px WebP + 128px thumb paths).

Revision ID: avatar2609
Revises: waitlist2609
Create Date: 2026-09-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "avatar2609"
down_revision: str | None = "waitlist2609"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_path", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("avatar_thumb_path", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_thumb_path")
    op.drop_column("users", "avatar_path")
