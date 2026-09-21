"""Invite-only sign-up is enforced on every user-creation path."""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import auth as auth_module
from app.models.admin import AppSetting, InviteCode
from app.models.magic_link import MagicLinkToken
from app.models.user import User
from app.services import app_settings as app_cfg

REQUEST_URL = "/api/v1/auth/magic-link/request"
VERIFY_URL = "/api/v1/auth/magic-link/verify"


@pytest.fixture
def magic_link_enabled(monkeypatch):
    monkeypatch.setattr(auth_module.settings, "resend_api_key", "re_test_key")
    monkeypatch.setattr(auth_module.settings, "magic_link_base_url", "https://app.example.test")
    monkeypatch.setattr(auth_module.settings, "admin_emails", "")
    return auth_module.settings


@pytest_asyncio.fixture
async def invite_only(db_session: AsyncSession):
    await app_cfg.set_setting(db_session, app_cfg.KEY_SIGNUP_MODE, "invite_only", None)
    await db_session.commit()
    yield
    await db_session.rollback()
    await db_session.execute(delete(AppSetting))
    await db_session.commit()


async def _invite(db: AsyncSession, **kwargs) -> InviteCode:
    invite = InviteCode(id=uuid.uuid4(), code=f"INV{uuid.uuid4().hex[:8].upper()}", **kwargs)
    db.add(invite)
    await db.commit()
    return invite


async def _token(db: AsyncSession, email: str, invite_code: str | None = None) -> str:
    raw = secrets.token_urlsafe(32)
    db.add(
        MagicLinkToken(
            id=uuid.uuid4(),
            email=email,
            token_hash=hashlib.sha256(raw.encode()).hexdigest(),
            expires_at=datetime.now(UTC) + timedelta(minutes=15),
            invite_code=invite_code,
        )
    )
    await db.commit()
    return raw


def _email() -> str:
    return f"gate-{uuid.uuid4().hex[:12]}@example.com"


async def _user_exists(db: AsyncSession, email: str) -> bool:
    n = (await db.execute(select(func.count(User.id)).where(User.email == email))).scalar_one()
    return n > 0


async def _uses(db: AsyncSession, invite: InviteCode) -> int:
    await db.refresh(invite)
    return invite.uses


class TestMagicLinkRequest:
    async def test_open_mode_unchanged(self, client, magic_link_enabled):
        with patch.object(auth_module, "send_magic_link_email", new=AsyncMock()) as send:
            r = await client.post(REQUEST_URL, json={"email": _email()})
        assert r.status_code == 202
        send.assert_awaited_once()

    async def test_invite_only_unknown_email_without_invite(
        self, client, db_session, magic_link_enabled, invite_only, test_user
    ):
        """Same answer as for an existing account (no enumeration), but no link."""
        email = _email()
        with patch.object(auth_module, "send_magic_link_email", new=AsyncMock()) as send:
            r = await client.post(REQUEST_URL, json={"email": email})
            known = await client.post(REQUEST_URL, json={"email": test_user.email})
        assert r.status_code == known.status_code == 202
        assert r.json() == known.json()
        send.assert_awaited_once()  # only the existing account got a link
        rows = (
            await db_session.execute(
                select(func.count(MagicLinkToken.id)).where(MagicLinkToken.email == email)
            )
        ).scalar_one()
        assert rows == 0

    async def test_invite_only_existing_user_can_log_in(
        self, client, magic_link_enabled, invite_only, test_user
    ):
        with patch.object(auth_module, "send_magic_link_email", new=AsyncMock()) as send:
            r = await client.post(REQUEST_URL, json={"email": test_user.email})
        assert r.status_code == 202
        send.assert_awaited_once()

    async def test_invite_is_stored_on_token(
        self, client, db_session, magic_link_enabled, invite_only
    ):
        invite = await _invite(db_session)
        email = _email()
        with patch.object(auth_module, "send_magic_link_email", new=AsyncMock()):
            r = await client.post(REQUEST_URL, json={"email": email, "invite": invite.code.lower()})
        assert r.status_code == 202, r.text
        row = (
            await db_session.execute(select(MagicLinkToken).where(MagicLinkToken.email == email))
        ).scalar_one()
        assert row.invite_code == invite.code
        # Requesting does not consume the invite
        assert await _uses(db_session, invite) == 0

    @pytest.mark.parametrize(
        "state", ["revoked", "expired", "used_up", "unknown", "malformed", "other_email"]
    )
    async def test_unusable_invites_rejected(
        self, client, db_session, magic_link_enabled, invite_only, state
    ):
        now = datetime.now(UTC)
        code = "no/such code!" if state == "malformed" else "NOPE1234"
        if state == "revoked":
            code = (await _invite(db_session, revoked_at=now)).code
        elif state == "expired":
            code = (await _invite(db_session, expires_at=now - timedelta(hours=1))).code
        elif state == "used_up":
            code = (await _invite(db_session, max_uses=1, uses=1)).code
        elif state == "other_email":
            code = (await _invite(db_session, max_uses=1, email="someone@example.com")).code
        with patch.object(auth_module, "send_magic_link_email", new=AsyncMock()) as send:
            r = await client.post(REQUEST_URL, json={"email": _email(), "invite": code})
        assert r.status_code == 202
        send.assert_not_awaited()

    async def test_admin_email_bypasses_gate(
        self, client, magic_link_enabled, invite_only, monkeypatch
    ):
        email = _email()
        monkeypatch.setattr(auth_module.settings, "admin_emails", email)
        with patch.object(auth_module, "send_magic_link_email", new=AsyncMock()):
            r = await client.post(REQUEST_URL, json={"email": email})
        assert r.status_code == 202


class TestMagicLinkVerify:
    async def test_verify_with_invite_creates_user_and_counts_use(
        self, client, db_session, magic_link_enabled, invite_only
    ):
        invite = await _invite(db_session, max_uses=1)
        email = _email()
        token = await _token(db_session, email, invite.code)
        r = await client.post(VERIFY_URL, json={"token": token})
        assert r.status_code == 200, r.text
        assert r.json()["is_new_user"] is True
        assert await _uses(db_session, invite) == 1

        # The invite is now used up: a second new account cannot use it.
        other = _email()
        token2 = await _token(db_session, other, invite.code)
        r = await client.post(VERIFY_URL, json={"token": token2})
        assert r.status_code == 403
        assert r.json()["detail"]["code"] == "invite_invalid"
        assert not await _user_exists(db_session, other)

    async def test_email_bound_invite_only_works_for_that_email(
        self, client, db_session, magic_link_enabled, invite_only
    ):
        owner = _email()
        invite = await _invite(db_session, max_uses=1, email=owner)
        intruder = _email()
        r = await client.post(
            VERIFY_URL, json={"token": await _token(db_session, intruder, invite.code)}
        )
        assert r.status_code == 403
        assert r.json()["detail"]["code"] == "invite_invalid"
        assert not await _user_exists(db_session, intruder)
        assert await _uses(db_session, invite) == 0

        # The owner's email (any casing on the request side) still gets in.
        with patch.object(auth_module, "send_magic_link_email", new=AsyncMock()) as send:
            r = await client.post(REQUEST_URL, json={"email": owner.upper(), "invite": invite.code})
        assert r.status_code == 202
        send.assert_awaited_once()
        r = await client.post(
            VERIFY_URL, json={"token": await _token(db_session, owner, invite.code)}
        )
        assert r.status_code == 200, r.text
        assert r.json()["is_new_user"] is True
        assert await _uses(db_session, invite) == 1

    async def test_mode_switched_after_request_blocks_creation(
        self, client, db_session, magic_link_enabled, invite_only
    ):
        email = _email()
        token = await _token(db_session, email)  # requested while open, no invite
        r = await client.post(VERIFY_URL, json={"token": token})
        assert r.status_code == 403
        assert r.json()["detail"]["code"] == "invite_required"
        assert not await _user_exists(db_session, email)
        # token was consumed anyway (single use)
        r = await client.post(VERIFY_URL, json={"token": token})
        assert r.status_code == 400

    async def test_existing_user_verifies_in_invite_only(
        self, client, db_session, magic_link_enabled, invite_only, test_user
    ):
        token = await _token(db_session, test_user.email)
        r = await client.post(VERIFY_URL, json={"token": token})
        assert r.status_code == 200
        assert r.json()["is_new_user"] is False

    async def test_open_mode_counts_valid_invite_and_ignores_bad_one(
        self, client, db_session, magic_link_enabled
    ):
        invite = await _invite(db_session)
        r = await client.post(
            VERIFY_URL, json={"token": await _token(db_session, _email(), invite.code)}
        )
        assert r.status_code == 200
        assert await _uses(db_session, invite) == 1
        r = await client.post(
            VERIFY_URL, json={"token": await _token(db_session, _email(), "GONE0000")}
        )
        assert r.status_code == 200


class TestSync:
    """/auth/sync (dev mode here; the same code path serves OIDC)."""

    async def test_sync_new_user_blocked_in_invite_only(self, client, db_session, invite_only):
        email = _email()
        r = await client.post(
            "/api/v1/auth/sync",
            json={"external_id": f"dev-{uuid.uuid4()}", "email": email, "display_name": "X"},
        )
        assert r.status_code == 403
        assert r.json()["detail"]["code"] == "invite_required"
        assert not await _user_exists(db_session, email)

    async def test_sync_new_user_with_invite(self, client, db_session, invite_only):
        invite = await _invite(db_session)
        r = await client.post(
            "/api/v1/auth/sync",
            json={
                "external_id": f"dev-{uuid.uuid4()}",
                "email": _email(),
                "display_name": "X",
                "invite_code": invite.code,
            },
        )
        assert r.status_code == 200, r.text
        assert r.json()["is_new_user"] is True
        assert await _uses(db_session, invite) == 1

    async def test_sync_existing_user_allowed(self, client, invite_only, test_user):
        r = await client.post(
            "/api/v1/auth/sync",
            json={
                "external_id": test_user.external_id,
                "email": test_user.email,
                "display_name": "Test User",
            },
        )
        assert r.status_code == 200
