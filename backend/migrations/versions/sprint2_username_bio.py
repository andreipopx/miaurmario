"""add username and bio to users

Revision ID: sprint2_username_bio
Revises: b7f2a1c9d3e5
Create Date: 2026-08-15

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "sprint2_username_bio"
down_revision: str | None = "b7f2a1c9d3e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("username", sa.String(20), nullable=True))
    op.add_column("users", sa.Column("bio", sa.Text(), nullable=True))
    op.create_index("ix_users_username", "users", ["username"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_username", table_name="users")
    op.drop_column("users", "bio")
    op.drop_column("users", "username")
