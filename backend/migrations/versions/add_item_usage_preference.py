"""Per-garment usage preference: "sácala más" / "normal" / "déjala tranquila".

The owner can tell the stylist what to do with one specific garment, and that
instruction outranks the automatic nudging in ``item_scorer._usage_score``:

* ``more``   — push it forward, whatever its wear count says.
* ``normal`` — the default; the median-based nudge decides.
* ``rest``   — stop nudging it in either direction. It is *not* an exclusion:
  the stylist may still pick it, it just stops being pushed.

The price a cost-per-use needs already lives in ``clothing_items.purchase_price``
(added with the shop-link intake), so nothing is added for it here.

Revision ID: wearusage2509
Revises: colorhex2509
Create Date: 2026-09-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "wearusage2509"
down_revision: str | None = "colorhex2509"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "clothing_items",
        sa.Column(
            "usage_preference",
            sa.String(length=10),
            nullable=False,
            server_default="normal",
        ),
    )


def downgrade() -> None:
    op.drop_column("clothing_items", "usage_preference")
