"""Waitlist for the closed beta + invites bound to one email.

Revision ID: waitlist2609
Revises: admpanel2609
Create Date: 2026-09-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "waitlist2609"
down_revision: str | None = "admpanel2609"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("invite_codes", sa.Column("email", sa.String(255), nullable=True))

    op.create_table(
        "waitlist_requests",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("name", sa.String(100), nullable=True),
        sa.Column("message", sa.String(280), nullable=True),
        sa.Column("locale", sa.String(8), nullable=False, server_default="es"),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "decided_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "invite_id",
            UUID(as_uuid=True),
            sa.ForeignKey("invite_codes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')", name="ck_waitlist_requests_status"
        ),
    )
    op.create_index("ix_waitlist_requests_status", "waitlist_requests", ["status"])


def downgrade() -> None:
    op.drop_index("ix_waitlist_requests_status", table_name="waitlist_requests")
    op.drop_table("waitlist_requests")
    op.drop_column("invite_codes", "email")
