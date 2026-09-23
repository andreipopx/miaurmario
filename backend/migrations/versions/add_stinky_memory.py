"""«Stinky recuerda»: per-user memory notes + inline chat notes.

Revision ID: stnkymem2309
Revises: srccare2609
Create Date: 2026-09-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "stnkymem2309"
down_revision: str | None = "srccare2609"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "stinky_memories",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("text", sa.String(200), nullable=False),
        sa.Column("source", sa.String(16), nullable=False, server_default="chat"),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="0.8"),
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_stinky_memories_user_kind", "stinky_memories", ["user_id", "kind"])
    op.create_index("ix_stinky_memories_user_updated", "stinky_memories", ["user_id", "updated_at"])

    # "Stinky ha tomado nota: ..." shown inline in the conversation.
    op.add_column("chat_messages", sa.Column("notes", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_messages", "notes")
    op.drop_index("ix_stinky_memories_user_updated", table_name="stinky_memories")
    op.drop_index("ix_stinky_memories_user_kind", table_name="stinky_memories")
    op.drop_table("stinky_memories")
