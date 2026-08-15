"""add scope column to family_outfit_ratings"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "s3_rating_scope"
down_revision: str | None = "s3_friendships"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

rating_scope = sa.Enum("family", "friend", "public", name="rating_scope")


def upgrade() -> None:
    rating_scope.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "family_outfit_ratings",
        sa.Column(
            "scope",
            rating_scope,
            nullable=False,
            server_default="family",
        ),
    )
    op.create_index(
        "ix_ratings_outfit_scope",
        "family_outfit_ratings",
        ["outfit_id", "scope"],
    )


def downgrade() -> None:
    op.drop_index("ix_ratings_outfit_scope", table_name="family_outfit_ratings")
    op.drop_column("family_outfit_ratings", "scope")
    rating_scope.drop(op.get_bind(), checkfirst=True)
