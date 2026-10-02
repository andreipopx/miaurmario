"""Devices of the native app, so Stinky can reach them through FCM and APNs.

The Android/iOS app is a Capacitor shell around the site. Its WebView can't use
Web Push, so the shell hands the server the token its OS issued instead, and
those live here, beside (not inside) the browser subscriptions.

Revision ID: nativepush0210
Revises: imgview2609
Create Date: 2026-10-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "nativepush0210"
down_revision: str | None = "imgview2609"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "native_push_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("platform", sa.String(length=10), nullable=False),
        sa.Column("token", sa.Text(), nullable=False, unique=True),
        sa.Column("app_version", sa.String(length=40), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_native_push_tokens_user_id", "native_push_tokens", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_native_push_tokens_user_id", table_name="native_push_tokens")
    op.drop_table("native_push_tokens")
