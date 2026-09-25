"""Keep the garment's real shade next to its colour family.

``clothing_items.primary_color_hex`` is the sampled "#rrggbb" of the garment —
what the user's eye actually sees — while ``primary_color`` stays the named
family the tagger, the scorer, the filters and the stylist all reason on. Two
different browns therefore both remain "marrón" everywhere it matters, and the
card, the detail sheet and the review grid can still show the real one.

Nullable with no backfill on purpose: every existing item simply has no sample
yet, and the UI falls back to the named colour's canonical hex.

Revision ID: colorhex2509
Revises: autoloc2509
Create Date: 2026-09-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "colorhex2509"
down_revision: str | None = "autoloc2509"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "clothing_items",
        sa.Column("primary_color_hex", sa.String(length=7), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("clothing_items", "primary_color_hex")
