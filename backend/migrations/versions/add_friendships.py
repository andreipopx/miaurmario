"""add friendships table"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "s3_friendships"
down_revision: str | None = "b7f2a1c9d3e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

friendship_status = sa.Enum(
    "pending", "accepted", "blocked", name="friendship_status"
)


def upgrade() -> None:
    friendship_status.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "friendships",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "requester_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "addressee_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "status",
            friendship_status,
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("requester_id", "addressee_id", name="uq_friendships_pair"),
        sa.CheckConstraint("requester_id <> addressee_id", name="ck_friendships_no_self"),
    )
    op.create_index(
        "ix_friendships_addressee_status", "friendships", ["addressee_id", "status"]
    )
    op.create_index(
        "ix_friendships_requester_status", "friendships", ["requester_id", "status"]
    )


def downgrade() -> None:
    op.drop_index("ix_friendships_requester_status", table_name="friendships")
    op.drop_index("ix_friendships_addressee_status", table_name="friendships")
    op.drop_table("friendships")
    friendship_status.drop(op.get_bind(), checkfirst=True)
