"""Pinterest boards the user shares with Stinky, with the style summary he read from them.

Revision ID: pinboards1310
Revises: stinkycoat0310
Create Date: 2026-10-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "pinboards1310"
down_revision: str | None = "stinkycoat0310"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "pinterest_boards",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("board_id", sa.String(64), nullable=False),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("privacy", sa.String(16), nullable=True),
        sa.Column("pin_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(16), nullable=False, server_default="importing"),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("is_fashion", sa.Boolean(), nullable=True),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("analyzed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("user_id", "board_id", name="uq_pinterest_boards_user_board"),
    )
    op.create_index("ix_pinterest_boards_user_id", "pinterest_boards", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_pinterest_boards_user_id", table_name="pinterest_boards")
    op.drop_table("pinterest_boards")
