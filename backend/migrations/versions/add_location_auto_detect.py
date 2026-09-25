"""Auto-detected timezone and the once-a-day travel prompt.

``timezone_source`` records who chose the zone: "auto" (detected from the
browser or from the chosen city) or "manual" (the user picked it). Detection
never overwrites a manual choice.

Backfill: existing rows still on the "UTC" default have never been touched, so
they are safe to detect into ("auto"). Anything else was set deliberately at
some point, so it is preserved as "manual".

``travel_prompt_at`` is when we last asked "¿Estás en Lisboa?", which caps that
prompt to once a day.

Revision ID: autoloc2509
Revises: stnkymem2309
Create Date: 2026-09-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "autoloc2509"
down_revision: str | None = "stnkymem2309"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "timezone_source",
            sa.String(length=10),
            nullable=False,
            server_default="auto",
        ),
    )
    op.execute(
        "UPDATE users SET timezone_source = 'manual' "
        "WHERE timezone IS NOT NULL AND timezone <> 'UTC'"
    )
    op.add_column(
        "users",
        sa.Column("travel_prompt_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "travel_prompt_at")
    op.drop_column("users", "timezone_source")
