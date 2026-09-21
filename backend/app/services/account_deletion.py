"""GDPR account deletion (runs in the arq worker, never inline in a request).

The admin endpoint only validates the request and writes an
``account_deletions`` tombstone (status "pending"); ``delete_user_account``
then removes, in one transaction:

* every row that references the user through a foreign key. Tables whose FK is
  ``ON DELETE CASCADE`` / ``SET NULL`` are handled by Postgres; FKs without an
  action (families.created_by, family_invites.invited_by, and anything a future
  feature adds) are discovered from ``pg_constraint`` at run time, so new
  tables (friends, listening history, chat ...) are covered without code changes;
* magic-link tokens requested for the user's email before the account existed,
  their waitlist request and the address on email-bound invites;
* the ``users`` row itself;

and afterwards the upload directory ``STORAGE_PATH/<user_id>`` (item photos,
feedback screenshots). The tombstone keeps the username, a SHA-256 of the email
and per-table counts, never the data.
"""

from __future__ import annotations

import hashlib
import logging
import shutil
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.admin import AccountDeletion, InviteCode, WaitlistRequest
from app.models.family import Family
from app.models.magic_link import MagicLinkToken
from app.models.user import User

logger = logging.getLogger(__name__)

# FKs pointing at users.id, with the referencing table/column and ON DELETE action
# (confdeltype: a = no action, r = restrict, c = cascade, n = set null, d = set default).
_USER_FKS_SQL = text(
    """
    SELECT cl.relname AS table_name, att.attname AS column_name,
           con.confdeltype::text AS on_delete, att.attnotnull AS not_null
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND con.confrelid = 'users'::regclass
      AND array_length(con.conkey, 1) = 1
      AND ns.nspname = current_schema()
    """
)


class AccountDeletionRefused(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def email_sha256(email: str) -> str:
    return hashlib.sha256(email.strip().lower().encode()).hexdigest()


def user_storage_dir(user_id: uuid.UUID, storage_path: str | None = None) -> Path:
    base = Path(storage_path or get_settings().storage_path).resolve()
    target = (base / str(user_id)).resolve()
    if target.parent != base:  # defensive: never escape STORAGE_PATH
        raise ValueError("Refusing to touch a path outside STORAGE_PATH")
    return target


def _quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


async def _count(db: AsyncSession, table: str, column: str, user_id: uuid.UUID) -> int:
    result = await db.execute(
        text(f"SELECT count(*) FROM {_quote_ident(table)} WHERE {_quote_ident(column)} = :uid"),
        {"uid": user_id},
    )
    return int(result.scalar_one())


async def _reassign_or_delete_families(db: AsyncSession, user_id: uuid.UUID) -> dict[str, int]:
    """families.created_by has no ON DELETE: hand the family to another member,
    or delete it when the user was the only one left."""
    summary = {"families_reassigned": 0, "families_deleted": 0}
    families = (await db.execute(select(Family).where(Family.created_by == user_id))).scalars()
    for family in list(families):
        heir = (
            await db.execute(
                select(User.id)
                .where(User.family_id == family.id, User.id != user_id)
                .order_by(User.created_at)
                .limit(1)
            )
        ).scalar_one_or_none()
        if heir is not None:
            family.created_by = heir
            await db.execute(update(User).where(User.id == heir).values(role="admin"))
            summary["families_reassigned"] += 1
        else:
            await db.execute(update(User).where(User.family_id == family.id).values(family_id=None))
            await db.delete(family)
            summary["families_deleted"] += 1
    await db.flush()
    return summary


async def delete_user_rows(db: AsyncSession, user: User) -> dict[str, Any]:
    """Delete every DB row belonging to ``user`` (caller commits)."""
    summary: dict[str, Any] = {"tables": {}}
    fks = (await db.execute(_USER_FKS_SQL)).mappings().all()

    # Counts first (for the tombstone), then clear FKs that would block the delete.
    for fk in fks:
        count = await _count(db, fk["table_name"], fk["column_name"], user.id)
        if count:
            key = f"{fk['table_name']}.{fk['column_name']}"
            summary["tables"][key] = count

    summary.update(await _reassign_or_delete_families(db, user.id))

    for fk in fks:
        if fk["on_delete"] not in ("a", "r"):
            continue  # CASCADE / SET NULL / SET DEFAULT: Postgres handles it
        table, column = _quote_ident(fk["table_name"]), _quote_ident(fk["column_name"])
        if fk["table_name"] == "users":
            await db.execute(
                text(f"UPDATE {table} SET {column} = NULL WHERE {column} = :uid"), {"uid": user.id}
            )
        elif fk["not_null"]:
            await db.execute(text(f"DELETE FROM {table} WHERE {column} = :uid"), {"uid": user.id})
        else:
            await db.execute(
                text(f"UPDATE {table} SET {column} = NULL WHERE {column} = :uid"), {"uid": user.id}
            )

    # Pre-signup magic-link tokens are keyed by email only (user_id NULL).
    result = await db.execute(delete(MagicLinkToken).where(MagicLinkToken.email == user.email))
    summary["magic_link_tokens_by_email"] = result.rowcount or 0

    # Waitlist request and email-bound invites are keyed by email too. The invite
    # row stays for the admin's history, revoked and without the address.
    email_l = (user.email or "").strip().lower()
    result = await db.execute(delete(WaitlistRequest).where(WaitlistRequest.email == email_l))
    summary["waitlist_requests_by_email"] = result.rowcount or 0
    result = await db.execute(
        update(InviteCode)
        .where(InviteCode.email == email_l)
        .values(email=None, revoked_at=func.coalesce(InviteCode.revoked_at, func.now()))
    )
    summary["invites_unbound"] = result.rowcount or 0

    await db.execute(delete(User).where(User.id == user.id))
    await db.flush()
    remaining = (await db.execute(select(func.count()).where(User.id == user.id))).scalar_one()
    if remaining:
        raise RuntimeError("User row still present after delete")
    return summary


def delete_user_files(user_id: uuid.UUID, storage_path: str | None = None) -> dict[str, int]:
    target = user_storage_dir(user_id, storage_path)
    if not target.exists():
        return {"files_deleted": 0, "bytes_deleted": 0}
    files = 0
    size = 0
    for path in target.rglob("*"):
        if path.is_file() and not path.is_symlink():
            files += 1
            try:
                size += path.stat().st_size
            except OSError:
                pass
    shutil.rmtree(target)
    return {"files_deleted": files, "bytes_deleted": size}


async def run_account_deletion(
    db: AsyncSession, deletion_id: uuid.UUID, storage_path: str | None = None
) -> AccountDeletion | None:
    """Execute a pending deletion. Idempotent: a finished tombstone is left alone."""
    deletion = await db.get(AccountDeletion, deletion_id)
    if deletion is None or deletion.status == "done":
        return deletion
    deletion.status = "running"
    await db.commit()

    try:
        user = await db.get(User, deletion.user_id)
        summary: dict[str, Any] = {}
        if user is not None:
            from app.services.ai_access import is_site_admin

            if is_site_admin(user):
                raise AccountDeletionRefused("cannot_delete_admin", "Site admins cannot be deleted")
            summary = await delete_user_rows(db, user)
        await db.commit()
    except Exception as exc:
        await db.rollback()
        deletion = await db.get(AccountDeletion, deletion_id)
        if deletion is not None:
            deletion.status = "failed"
            deletion.error = f"{type(exc).__name__}: {exc}"[:1000]
            deletion.completed_at = datetime.now(UTC)
            await db.commit()
        logger.exception("Account deletion %s failed", deletion_id)
        return deletion

    # Files after the DB commit: a DB failure must not leave a user without photos.
    try:
        summary.update(delete_user_files(deletion.user_id, storage_path))
        error = None
    except Exception as exc:  # the rows are gone; record and let an admin retry
        logger.exception("Account deletion %s: file cleanup failed", deletion_id)
        error = f"files: {type(exc).__name__}: {exc}"[:1000]

    deletion = await db.get(AccountDeletion, deletion_id)
    assert deletion is not None
    deletion.summary = summary
    deletion.status = "failed" if error else "done"
    deletion.error = error
    deletion.completed_at = datetime.now(UTC)
    await db.commit()
    return deletion
