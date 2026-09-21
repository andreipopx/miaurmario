"""Add Pinterest integration tables.

Revision ID: p1n15intg2601
Revises: b7f2a1c9d3e5
Create Date: 2026-08-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "p1n15intg2601"
down_revision: str | None = "b7f2a1c9d3e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "pinterest_connections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("pinterest_user_id", sa.String(64), nullable=False),
        sa.Column("access_token_ct", sa.LargeBinary(), nullable=False),
        sa.Column("refresh_token_ct", sa.LargeBinary(), nullable=False),
        sa.Column("access_token_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("refresh_token_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "scopes",
            sa.String(255),
            nullable=False,
            server_default="boards:read,pins:read",
        ),
        sa.Column(
            "connected_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("last_refreshed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_pinterest_connections_refresh_expiry",
        "pinterest_connections",
        ["refresh_token_expires_at"],
    )

    op.create_table(
        "pinterest_pins",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("pinterest_pin_id", sa.String(64), nullable=False),
        sa.Column("board_id", sa.String(64), nullable=False),
        sa.Column("board_name", sa.String(255), nullable=True),
        sa.Column("image_url", sa.String(1024), nullable=False),
        sa.Column("source_link", sa.String(1024), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("dominant_color", sa.String(9), nullable=True),
        sa.Column(
            "imported_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("user_id", "pinterest_pin_id", name="uq_pinterest_pins_user_pin"),
    )
    op.create_index("ix_pinterest_pins_user_id", "pinterest_pins", ["user_id"])
    op.create_index("ix_pinterest_pins_board_id", "pinterest_pins", ["board_id"])


def downgrade() -> None:
    op.drop_index("ix_pinterest_pins_board_id", table_name="pinterest_pins")
    op.drop_index("ix_pinterest_pins_user_id", table_name="pinterest_pins")
    op.drop_table("pinterest_pins")
    op.drop_index(
        "ix_pinterest_connections_refresh_expiry",
        table_name="pinterest_connections",
    )
    op.drop_table("pinterest_connections")
