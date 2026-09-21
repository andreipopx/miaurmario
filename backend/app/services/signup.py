"""Sign-up gate: open registration vs. invite-only (closed beta).

Every path that can create a ``users`` row calls ``authorize_signup`` first
(magic-link request + verify, OIDC/dev ``/auth/sync``). Existing users are never
affected: the gate only runs when no account exists for the email.

ADMIN_EMAILS always get through, so the owner can never lock themselves out.
"""

from __future__ import annotations

import re
import secrets
from datetime import UTC, datetime

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.admin import InviteCode
from app.services.app_settings import get_signup_mode

INVITE_CODE_RE = re.compile(r"^[A-Za-z0-9_-]{4,32}$")
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I


class SignupBlockedError(Exception):
    """Account creation refused. ``code`` is stable for the frontend."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def detail(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}


def generate_invite_code(length: int = 10) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def normalize_invite_code(code: str | None) -> str | None:
    if code is None:
        return None
    code = code.strip()
    if not code:
        return None
    if not INVITE_CODE_RE.match(code):
        raise SignupBlockedError("invite_invalid", "This invitation is not valid.")
    return code.upper()


def _usable_clause(now: datetime, email: str | None):
    # Invites bound to an email (waitlist approvals) only work for that email.
    email_l = (email or "").strip().lower()
    return (
        InviteCode.revoked_at.is_(None),
        or_(InviteCode.expires_at.is_(None), InviteCode.expires_at > now),
        or_(InviteCode.max_uses.is_(None), InviteCode.uses < InviteCode.max_uses),
        or_(InviteCode.email.is_(None), InviteCode.email == email_l),
    )


async def find_usable_invite(
    db: AsyncSession, code: str, email: str | None = None
) -> InviteCode | None:
    now = datetime.now(UTC)
    result = await db.execute(
        select(InviteCode).where(InviteCode.code == code, *_usable_clause(now, email))
    )
    return result.scalar_one_or_none()


async def redeem_invite(db: AsyncSession, code: str, email: str | None = None) -> bool:
    """Atomically consume one use. False when the code is unknown/used up/expired/revoked
    or bound to a different email."""
    now = datetime.now(UTC)
    result = await db.execute(
        update(InviteCode)
        .where(InviteCode.code == code, *_usable_clause(now, email))
        .values(uses=InviteCode.uses + 1)
        .returning(InviteCode.id)
        .execution_options(synchronize_session=False)
    )
    return result.scalar_one_or_none() is not None


def _is_admin_email(email: str) -> bool:
    return email.strip().lower() in get_settings().admin_email_set()


async def check_signup_allowed(db: AsyncSession, email: str, invite_code: str | None) -> None:
    """Read-only check used before sending a magic link (does not consume the invite).

    Raises SignupBlockedError when a new account for ``email`` would be refused.
    """
    if _is_admin_email(email) or await get_signup_mode(db) == "open":
        return
    code = normalize_invite_code(invite_code)
    if code is None:
        raise SignupBlockedError(
            "invite_required", "Miaurmario is in closed beta: an invitation is required."
        )
    if await find_usable_invite(db, code, email) is None:
        raise SignupBlockedError("invite_invalid", "This invitation is not valid anymore.")


async def authorize_signup(db: AsyncSession, email: str, invite_code: str | None) -> None:
    """Gate + redeem, called right before a new user row is created.

    In ``open`` mode a (valid) invite is still counted; an invalid one is
    ignored so a stale link never blocks an open sign-up.
    """
    mode = await get_signup_mode(db)
    admin = _is_admin_email(email)
    try:
        code = normalize_invite_code(invite_code)
    except SignupBlockedError:
        if mode == "open" or admin:
            return
        raise
    if code is not None:
        redeemed = await redeem_invite(db, code, email)
        if redeemed or admin or mode == "open":
            return
        raise SignupBlockedError("invite_invalid", "This invitation is not valid anymore.")
    if mode == "invite_only" and not admin:
        raise SignupBlockedError(
            "invite_required", "Miaurmario is in closed beta: an invitation is required."
        )
