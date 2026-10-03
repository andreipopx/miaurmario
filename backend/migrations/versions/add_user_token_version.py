"""Per-user token version, so a password change or "sign out everywhere" revokes API tokens.

Tokens carry the version as "tv"; ones issued before this column existed have
none and count as 0, which is every user's starting value, so nobody is signed
out by the upgrade itself.

Revision ID: tokenver0310
Revises: nativepush0210
Create Date: 2026-10-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "tokenver0310"
down_revision: str | None = "nativepush0210"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("users", "token_version")
