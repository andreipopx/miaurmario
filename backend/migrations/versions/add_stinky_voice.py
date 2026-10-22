"""How Stinky talks: users.stinky_voice (NULL = "gato", the shipped voice).

Revision ID: voice2210
Revises: intake2210
Create Date: 2026-10-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "voice2210"
down_revision: str | None = "intake2210"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("stinky_voice", sa.String(16), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "stinky_voice")
