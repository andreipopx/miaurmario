"""Admin panel: audit log, app settings, invites, feedback inbox, deletion tombstones.

Also splits AI token usage into prompt/completion counters and lets a
magic-link token carry the invite code it was requested with.

Revision ID: admpanel2609
Revises: social2609
Create Date: 2026-09-21

NOTE: chained after ``usrpwd2609`` (origin/main head when written). Other
feature branches may also chain there; re-chain at integration.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "admpanel2609"
down_revision: str | None = "social2609"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _ts(name: str, nullable: bool = False, default: bool = True) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        server_default=sa.func.now() if default else None,
        nullable=nullable,
    )


def upgrade() -> None:
    op.create_table(
        "admin_audit_log",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "admin_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("target_user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("details", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        _ts("created_at"),
    )
    op.create_index("ix_admin_audit_log_admin_id", "admin_audit_log", ["admin_id"])
    op.create_index("ix_admin_audit_log_action", "admin_audit_log", ["action"])
    op.create_index("ix_admin_audit_log_created_at", "admin_audit_log", ["created_at"])

    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", JSONB, nullable=True),
        sa.Column(
            "updated_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        _ts("updated_at"),
    )

    op.create_table(
        "invite_codes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(32), nullable=False, unique=True),
        sa.Column("note", sa.String(200), nullable=True),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column("uses", sa.Integer(), nullable=False, server_default="0"),
        _ts("expires_at", nullable=True, default=False),
        _ts("revoked_at", nullable=True, default=False),
        sa.Column(
            "created_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        _ts("created_at"),
        sa.CheckConstraint("max_uses IS NULL OR max_uses > 0", name="ck_invite_codes_max_uses"),
    )

    op.create_table(
        "feedback_reports",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("screenshot_path", sa.String(300), nullable=True),
        sa.Column("page_url", sa.String(500), nullable=True),
        sa.Column("build_id", sa.String(100), nullable=True),
        sa.Column("user_agent", sa.String(500), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="new"),
        sa.Column("admin_note", sa.Text(), nullable=True),
        _ts("created_at"),
        _ts("updated_at"),
        sa.CheckConstraint(
            "kind IN ('suggestion', 'bug', 'other')", name="ck_feedback_reports_kind"
        ),
        sa.CheckConstraint("status IN ('new', 'seen', 'done')", name="ck_feedback_reports_status"),
    )
    op.create_index("ix_feedback_reports_user_id", "feedback_reports", ["user_id"])
    op.create_index("ix_feedback_reports_status", "feedback_reports", ["status"])

    op.create_table(
        "account_deletions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("username", sa.String(20), nullable=True),
        sa.Column("email_sha256", sa.String(64), nullable=False),
        sa.Column(
            "requested_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("summary", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        _ts("requested_at"),
        _ts("completed_at", nullable=True, default=False),
    )
    op.create_index("ix_account_deletions_user_id", "account_deletions", ["user_id"])

    op.add_column("magic_link_tokens", sa.Column("invite_code", sa.String(32), nullable=True))
    op.add_column(
        "user_ai_settings",
        sa.Column("prompt_tokens_this_month", sa.BigInteger(), nullable=False, server_default="0"),
    )
    op.add_column(
        "user_ai_settings",
        sa.Column(
            "completion_tokens_this_month", sa.BigInteger(), nullable=False, server_default="0"
        ),
    )


def downgrade() -> None:
    op.drop_column("user_ai_settings", "completion_tokens_this_month")
    op.drop_column("user_ai_settings", "prompt_tokens_this_month")
    op.drop_column("magic_link_tokens", "invite_code")
    op.drop_index("ix_account_deletions_user_id", table_name="account_deletions")
    op.drop_table("account_deletions")
    op.drop_index("ix_feedback_reports_status", table_name="feedback_reports")
    op.drop_index("ix_feedback_reports_user_id", table_name="feedback_reports")
    op.drop_table("feedback_reports")
    op.drop_table("invite_codes")
    op.drop_table("app_settings")
    op.drop_index("ix_admin_audit_log_created_at", table_name="admin_audit_log")
    op.drop_index("ix_admin_audit_log_action", table_name="admin_audit_log")
    op.drop_index("ix_admin_audit_log_admin_id", table_name="admin_audit_log")
    op.drop_table("admin_audit_log")
