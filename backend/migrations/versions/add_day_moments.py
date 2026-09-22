"""Day moments: several looks per day (morning work, evening date...).

Extends `outfits` instead of adding a parallel table: every outfit of a day with
the same `moment_order` belongs to the same moment. Existing rows get order 0 and
no label, i.e. the single default moment, so history, feed and stats are unchanged.

Revision ID: daymoments2609
Revises: waitlist2609
Create Date: 2026-09-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "daymoments2609"
down_revision: str | None = "avatar2609"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "outfits",
        sa.Column("moment_order", sa.SmallInteger(), nullable=False, server_default="0"),
    )
    op.add_column("outfits", sa.Column("moment_label", sa.String(40), nullable=True))
    op.add_column("outfits", sa.Column("moment_time", sa.Time(), nullable=True))
    op.add_column(
        "outfits",
        sa.Column(
            "transition_from_outfit_id",
            UUID(as_uuid=True),
            sa.ForeignKey(
                "outfits.id",
                ondelete="SET NULL",
                name="fk_outfits_transition_from_outfit_id",
            ),
            nullable=True,
        ),
    )
    # The Today screen loads one user's day at a time.
    op.create_index(
        "ix_outfits_user_day_moment",
        "outfits",
        ["user_id", "scheduled_for", "moment_order"],
    )


def downgrade() -> None:
    op.drop_index("ix_outfits_user_day_moment", table_name="outfits")
    op.drop_constraint("fk_outfits_transition_from_outfit_id", "outfits", type_="foreignkey")
    op.drop_column("outfits", "transition_from_outfit_id")
    op.drop_column("outfits", "moment_time")
    op.drop_column("outfits", "moment_label")
    op.drop_column("outfits", "moment_order")
