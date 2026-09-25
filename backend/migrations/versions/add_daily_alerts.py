"""Daily alerts: «Tu look de la mañana» + «Movimiento de amigos».

Two more events on the per-user notification preferences, each with the local
clock time it goes out at. The morning look ships off (it needs a time first);
friend activity ships on for push and off for email.

Revision ID: dailyalerts2509
Revises: stnkymem2309
Create Date: 2026-09-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dailyalerts2509"
down_revision: str | None = "stnkymem2309"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_FLAGS = (
    ("email_morning_look", sa.false()),
    ("push_morning_look", sa.false()),
    ("email_friend_activity", sa.false()),
    ("push_friend_activity", sa.true()),
)
_TIMES = (
    ("morning_look_time", "07:30:00"),
    ("friend_activity_time", "20:00:00"),
)


def upgrade() -> None:
    for name, default in _FLAGS:
        op.add_column(
            "notification_preferences",
            sa.Column(name, sa.Boolean(), nullable=False, server_default=default),
        )
    for name, default in _TIMES:
        op.add_column(
            "notification_preferences",
            sa.Column(name, sa.Time(), nullable=False, server_default=sa.text(f"'{default}'")),
        )


def downgrade() -> None:
    for name, _ in _TIMES:
        op.drop_column("notification_preferences", name)
    for name, _ in _FLAGS:
        op.drop_column("notification_preferences", name)
