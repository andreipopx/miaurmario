"""How garments arrive, and which days people come back.

``clothing_items.created_via`` says which way of adding clothes was used, and
``user_activity_days`` keeps one row per user per day of use. The days are
backfilled from what already shows activity (sign-up, last login, garments,
looks, chat), so the funnel has a history from the first deploy.

Revision ID: intake2210
Revises: trips1410
Create Date: 2026-10-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "intake2210"
down_revision: str | None = "trips1410"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("clothing_items", sa.Column("created_via", sa.String(20), nullable=True))
    op.create_table(
        "user_activity_days",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("day", sa.Date(), primary_key=True),
    )
    op.execute(
        """
        INSERT INTO user_activity_days (user_id, day)
        SELECT DISTINCT user_id, day FROM (
            SELECT id AS user_id, (created_at AT TIME ZONE 'UTC')::date AS day FROM users
            UNION SELECT id, (last_login_at AT TIME ZONE 'UTC')::date FROM users
                WHERE last_login_at IS NOT NULL
            UNION SELECT user_id, (created_at AT TIME ZONE 'UTC')::date FROM clothing_items
            UNION SELECT user_id, (created_at AT TIME ZONE 'UTC')::date FROM outfits
            UNION SELECT c.user_id, (m.created_at AT TIME ZONE 'UTC')::date
                FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id
                WHERE m.role = 'user'
        ) AS seen
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_table("user_activity_days")
    op.drop_column("clothing_items", "created_via")
