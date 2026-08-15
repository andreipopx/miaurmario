"""add visibility column to outfits"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "s3_outfit_visibility"
down_revision: str | None = "s3_rating_scope"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

outfit_visibility = sa.Enum("private", "friends", "public", name="outfit_visibility")


def upgrade() -> None:
    outfit_visibility.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "outfits",
        sa.Column(
            "visibility",
            outfit_visibility,
            nullable=False,
            server_default="private",
        ),
    )
    op.create_index(
        "ix_outfits_feed",
        "outfits",
        ["scheduled_for", "visibility"],
    )


def downgrade() -> None:
    op.drop_index("ix_outfits_feed", table_name="outfits")
    op.drop_column("outfits", "visibility")
    outfit_visibility.drop(op.get_bind(), checkfirst=True)
