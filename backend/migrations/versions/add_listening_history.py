"""Add listening history (listening_events, listening_moods) + Spotify sync cursor.

Revision ID: music2609
Revises: usrpwd2609
Create Date: 2026-09-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "music2609"
down_revision: str | None = "usrpwd2609"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("spotify_connections", sa.Column("history_cursor_ms", sa.BigInteger()))
    op.add_column(
        "spotify_connections",
        sa.Column("last_history_sync_at", sa.DateTime(timezone=True)),
    )

    op.create_table(
        "listening_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("played_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("track_id", sa.String(64), nullable=False),
        sa.Column("track_name", sa.String(300), nullable=False),
        sa.Column("artist_id", sa.String(64)),
        sa.Column("artist_name", sa.String(300)),
        sa.Column("artists", JSONB(), nullable=False, server_default="[]"),
        sa.Column("album", sa.String(300)),
        sa.Column("release_year", sa.Integer()),
        sa.Column("image_url", sa.String(500)),
        sa.Column("duration_ms", sa.Integer()),
        sa.Column("source", sa.String(16), nullable=False, server_default="spotify"),
        sa.Column("genres", JSONB(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "track_id", "played_at", name="uq_listening_events_play"),
    )
    op.create_index("ix_listening_events_user_played", "listening_events", ["user_id", "played_at"])

    op.create_table(
        "listening_moods",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("moods", JSONB(), nullable=False, server_default="[]"),
        sa.Column("energy", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("valence", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("top_genres", JSONB(), nullable=False, server_default="[]"),
        sa.Column("genre_counts", JSONB(), nullable=False, server_default="{}"),
        sa.Column("track_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("listened_ms", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("dominant_artists", JSONB(), nullable=False, server_default="[]"),
        sa.Column("one_liner", sa.String(280)),
        sa.Column("method", sa.String(16), nullable=False, server_default="heuristic"),
        sa.Column("signature", sa.String(64)),
        sa.Column(
            "computed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("user_id", "day", name="uq_listening_moods_day"),
    )


def downgrade() -> None:
    op.drop_table("listening_moods")
    op.drop_index("ix_listening_events_user_played", table_name="listening_events")
    op.drop_table("listening_events")
    op.drop_column("spotify_connections", "last_history_sync_at")
    op.drop_column("spotify_connections", "history_cursor_ms")
