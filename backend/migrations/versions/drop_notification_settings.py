"""Drop the per-user notification channels table (ntfy, Mattermost, email, Expo push).

Notifications now go only through the default channels: the account email, Web
Push and the native app's push. Nobody had a legacy channel configured.

downgrade() recreates the table empty, exactly as 001_initial_schema made it
(columns, constraints, index and the updated_at trigger).

Revision ID: dropnotifsettings0310
Revises: tokenver0310
Create Date: 2026-10-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "dropnotifsettings0310"
down_revision: str | None = "tokenver0310"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("idx_notification_settings_user_id", table_name="notification_settings")
    op.drop_table("notification_settings")


def downgrade() -> None:
    op.create_table(
        "notification_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("channel", sa.String(20), nullable=False),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("priority", sa.Integer, nullable=False, server_default="1"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "channel"),
    )
    op.create_index("idx_notification_settings_user_id", "notification_settings", ["user_id"])
    # 001 also hung the shared updated_at trigger on it (dropped with the table).
    op.execute("""
        CREATE TRIGGER update_notification_settings_updated_at
        BEFORE UPDATE ON notification_settings
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    """)
