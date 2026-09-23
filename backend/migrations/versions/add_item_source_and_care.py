"""Easy intake: the shop link an item came from and its care-label data.

Revision ID: srccare2609
Revises: seentips2609
Create Date: 2026-09-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "srccare2609"
down_revision: str | None = "seentips2609"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("clothing_items", sa.Column("source_url", sa.String(length=2048), nullable=True))
    op.add_column("clothing_items", sa.Column("care", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("clothing_items", "care")
    op.drop_column("clothing_items", "source_url")
