"""Each person's own Stinky: the name, coat and eye colour they give the stylist cat.

All NULL by default, which is Stinky the tuxedo, so nothing changes for
anyone until they pick something in Ajustes → Tu Stinky.

Revision ID: stinkycoat0310
Revises: dropnotifsettings0310
Create Date: 2026-10-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "stinkycoat0310"
down_revision: str | None = "dropnotifsettings0310"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("stinky_name", sa.String(20), nullable=True))
    op.add_column("users", sa.Column("stinky_coat", sa.String(32), nullable=True))
    op.add_column("users", sa.Column("stinky_eyes", sa.String(16), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "stinky_eyes")
    op.drop_column("users", "stinky_coat")
    op.drop_column("users", "stinky_name")
