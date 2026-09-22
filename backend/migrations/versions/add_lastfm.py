"""Last.fm as a music source + "contrast my music" stylist setting.

Revision ID: lastfm2109
Revises: waitlist2609
Create Date: 2026-09-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "lastfm2109"
down_revision: str | None = "waitlist2609"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "lastfm_connections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("username", sa.String(64), nullable=False),
        sa.Column("session_key_ct", sa.LargeBinary(), nullable=True),
        sa.Column("use_for_mood", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "connected_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("cursor_uts", sa.BigInteger(), nullable=True),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(32), nullable=True),
    )
    op.add_column(
        "user_preferences",
        sa.Column("music_contrast", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("user_preferences", "music_contrast")
    op.drop_table("lastfm_connections")
