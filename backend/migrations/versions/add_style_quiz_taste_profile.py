"""«Tu estilo con Stinky»: the swipe-deck answers on the user's preferences.

Revision ID: stylequiz2309
Revises: seentips2609
Create Date: 2026-09-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "stylequiz2309"
down_revision: str | None = "seentips2609"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_preferences",
        sa.Column(
            "taste_profile",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("user_preferences", "taste_profile")
