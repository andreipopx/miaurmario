"""Add per-user AI access settings (none / platform / byok).

Revision ID: a1accessbyok2609
Revises: sp0t1fyintg2609
Create Date: 2026-09-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "a1accessbyok2609"
down_revision: str | None = "sp0t1fyintg2609"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_ai_settings",
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("ai_access", sa.String(16), nullable=False, server_default="none"),
        sa.Column("byok_provider", sa.String(50), nullable=True),
        sa.Column("byok_base_url", sa.String(500), nullable=True),
        sa.Column("byok_api_key_ct", sa.LargeBinary(), nullable=True),
        sa.Column("byok_api_key_last4", sa.String(4), nullable=True),
        sa.Column("byok_vision_model", sa.String(100), nullable=True),
        sa.Column("byok_text_model", sa.String(100), nullable=True),
        sa.Column("byok_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("monthly_request_cap", sa.Integer(), nullable=True),
        sa.Column("usage_month", sa.String(7), nullable=True),
        sa.Column("requests_this_month", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tokens_this_month", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "ai_access IN ('none', 'platform', 'byok')", name="ck_user_ai_settings_ai_access"
        ),
    )
    # Existing admins keep the AI they have today (the platform key).
    op.execute(
        "INSERT INTO user_ai_settings (user_id, ai_access) "
        "SELECT id, 'platform' FROM users WHERE role = 'admin'"
    )


def downgrade() -> None:
    op.drop_table("user_ai_settings")
