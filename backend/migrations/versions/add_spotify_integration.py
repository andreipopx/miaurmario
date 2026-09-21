"""Add Spotify integration table.

Revision ID: sp0t1fyintg2609
Revises: p1n15intg2601
Create Date: 2026-09-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "sp0t1fyintg2609"
down_revision: str | None = "p1n15intg2601"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "spotify_connections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("spotify_user_id", sa.String(128), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=True),
        sa.Column("access_token_ct", sa.LargeBinary(), nullable=False),
        sa.Column("refresh_token_ct", sa.LargeBinary(), nullable=False),
        sa.Column("access_token_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("scopes", sa.String(255), nullable=False, server_default=""),
        sa.Column("use_for_mood", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "connected_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("last_refreshed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("spotify_connections")
