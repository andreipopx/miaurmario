"""Label every photo of a garment with the side it shows, and give it its own original.

"Delante y detrás": a garment's primary photo and each of its extra photos now
carry which side of the garment they show, so a look can be seen from behind.

``item_images.original_image_path`` comes along in the same revision: background
removal is per photo, so the untouched photo it sets aside has to be per photo too,
or undoing the eraser on a back photo would go looking at the garment's main one.

All three columns are nullable with no backfill, on purpose. A photo taken before
views existed genuinely has no view recorded, and everything that reads the
column treats a missing value as ``front`` (``models.item.normalize_image_view``)
— which is also what a garment with a single photo means. Guessing that every
existing second photo is a back would put a label on the user's data that the
user never gave us.

Revision ID: imgview2609
Revises: wearusage2509
Create Date: 2026-09-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "imgview2609"
down_revision: str | None = "wearusage2509"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "clothing_items",
        sa.Column("image_view", sa.String(length=10), nullable=True),
    )
    op.add_column(
        "item_images",
        sa.Column("image_view", sa.String(length=10), nullable=True),
    )
    op.add_column(
        "item_images",
        sa.Column("original_image_path", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("item_images", "original_image_path")
    op.drop_column("item_images", "image_view")
    op.drop_column("clothing_items", "image_view")
