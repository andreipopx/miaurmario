"""Stinky eats looks: what he wears and the weekly goal of the streak.

Meals, levels and streaks are derived from the looks already logged
(user_feedback.worn_at, item_history), so only the two choices are stored.

Revision ID: habit2210
Revises: voice2210
Create Date: 2026-10-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "habit2210"
down_revision: str | None = "voice2210"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("stinky_accessory", sa.String(20), nullable=True))
    op.add_column("users", sa.Column("weekly_goal", sa.SmallInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "weekly_goal")
    op.drop_column("users", "stinky_accessory")
