"""Social layer: friendships, outfit visibility + shared_at, rating scope.

Ported from sprint-3-social (s3_friendships / s3_rating_scope / s3_outfit_visibility,
which chained after b7f2a1c9d3e5) into one migration after usrpwd2609.

Revision ID: social2609
Revises: usrpwd2609
Create Date: 2026-09-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "social2609"
down_revision: str | None = "usrpwd2609"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

friendship_status = postgresql.ENUM(
    "pending", "accepted", "blocked", name="friendship_status", create_type=False
)
outfit_visibility = postgresql.ENUM(
    "private", "friends", "public", name="outfit_visibility", create_type=False
)
rating_scope = postgresql.ENUM("family", "friend", "public", name="rating_scope", create_type=False)


def upgrade() -> None:
    bind = op.get_bind()
    friendship_status.create(bind, checkfirst=True)
    outfit_visibility.create(bind, checkfirst=True)
    rating_scope.create(bind, checkfirst=True)

    # -- friendships ---------------------------------------------------------
    op.create_table(
        "friendships",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "requester_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "addressee_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", friendship_status, nullable=False, server_default="pending"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("requester_id <> addressee_id", name="ck_friendships_no_self"),
    )
    # One row per unordered pair.
    op.execute(
        "CREATE UNIQUE INDEX uq_friendships_pair ON friendships "
        "(LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id))"
    )
    op.create_index("ix_friendships_addressee_status", "friendships", ["addressee_id", "status"])
    op.create_index("ix_friendships_requester_status", "friendships", ["requester_id", "status"])

    # -- outfits: visibility + outfit del día ---------------------------------
    op.add_column(
        "outfits",
        sa.Column("visibility", outfit_visibility, nullable=False, server_default="private"),
    )
    # Several outfits per user and day can be shared (the feed groups them per day).
    op.add_column("outfits", sa.Column("shared_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(
        "ix_outfits_user_shared",
        "outfits",
        ["user_id", "shared_at"],
        postgresql_where=sa.text("visibility <> 'private'"),
    )

    # -- ratings: scope (existing rows are family ratings) ---------------------
    op.add_column(
        "family_outfit_ratings",
        sa.Column("scope", rating_scope, nullable=False, server_default="family"),
    )
    op.create_index(
        "ix_family_outfit_ratings_outfit_scope", "family_outfit_ratings", ["outfit_id", "scope"]
    )

    # -- users: last time the social activity was seen (in-app badge) ---------
    op.add_column("users", sa.Column("social_seen_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "social_seen_at")

    op.drop_index("ix_family_outfit_ratings_outfit_scope", table_name="family_outfit_ratings")
    op.drop_column("family_outfit_ratings", "scope")

    op.drop_index("ix_outfits_user_shared", table_name="outfits")
    op.drop_column("outfits", "shared_at")
    op.drop_column("outfits", "visibility")

    op.drop_index("ix_friendships_requester_status", table_name="friendships")
    op.drop_index("ix_friendships_addressee_status", table_name="friendships")
    op.execute("DROP INDEX IF EXISTS uq_friendships_pair")
    op.drop_table("friendships")

    bind = op.get_bind()
    rating_scope.drop(bind, checkfirst=True)
    outfit_visibility.drop(bind, checkfirst=True)
    friendship_status.drop(bind, checkfirst=True)
