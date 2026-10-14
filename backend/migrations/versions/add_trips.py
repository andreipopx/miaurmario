"""«Modo viaje»: trips and the plan Stinky made for them.

Revision ID: trips1410
Revises: tomorrowlook1410
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "trips1410"
down_revision: str | None = "tomorrowlook1410"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "trips",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("destination", sa.String(120), nullable=False),
        sa.Column("country", sa.String(80), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("plans", sa.Text(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="planning"),
        sa.Column("engine", sa.String(16), nullable=True),
        sa.Column("error", sa.String(64), nullable=True),
        sa.Column("days", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("packing", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("extras", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_trips_user_id", "trips", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_trips_user_id", table_name="trips")
    op.drop_table("trips")
