"""«Tu look de mañana»: the evening-before alert, off until the user turns it on.

Revision ID: tomorrowlook1410
Revises: pinboards1310
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "tomorrowlook1410"
down_revision: str | None = "pinboards1310"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "notification_preferences",
        sa.Column("email_tomorrow_look", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "notification_preferences",
        sa.Column("push_tomorrow_look", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "notification_preferences",
        sa.Column(
            "tomorrow_look_time", sa.Time(), nullable=False, server_default=sa.text("'21:00'")
        ),
    )


def downgrade() -> None:
    op.drop_column("notification_preferences", "tomorrow_look_time")
    op.drop_column("notification_preferences", "push_tomorrow_look")
    op.drop_column("notification_preferences", "email_tomorrow_look")
