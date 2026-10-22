"""«¿Cuál me pongo?»: look polls, their options and friends' votes.

Revision ID: polls2210
Revises: habit2210
Create Date: 2026-10-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "polls2210"
down_revision: str | None = "habit2210"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "look_polls",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question", sa.String(140), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("closes_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_look_polls_user_id", "look_polls", ["user_id"])
    op.create_table(
        "look_poll_options",
        sa.Column(
            "poll_id", UUID, sa.ForeignKey("look_polls.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column(
            "outfit_id", UUID, sa.ForeignKey("outfits.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("position", sa.SmallInteger(), nullable=False, server_default="0"),
    )
    op.create_table(
        "look_poll_votes",
        sa.Column(
            "poll_id", UUID, sa.ForeignKey("look_polls.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column(
            "voter_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column(
            "outfit_id", UUID, sa.ForeignKey("outfits.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("look_poll_votes")
    op.drop_table("look_poll_options")
    op.drop_index("ix_look_polls_user_id", table_name="look_polls")
    op.drop_table("look_polls")
