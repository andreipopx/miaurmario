import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import auth as auth_module
from app.models.magic_link import MagicLinkToken
from app.models.user import User

VERIFY_URL = "/api/v1/auth/magic-link/verify"


@pytest.fixture
def magic_link_enabled(monkeypatch):
    monkeypatch.setattr(auth_module.settings, "resend_api_key", "re_test_key")
    monkeypatch.setattr(auth_module.settings, "magic_link_base_url", "https://app.example.test")
    monkeypatch.setattr(auth_module.settings, "admin_emails", "")
    return auth_module.settings


async def _make_token(
    db: AsyncSession,
    email: str,
    *,
    expires_in: timedelta = timedelta(minutes=15),
    used: bool = False,
) -> str:
    raw = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    db.add(
        MagicLinkToken(
            id=uuid.uuid4(),
            email=email,
            token_hash=hashlib.sha256(raw.encode()).hexdigest(),
            expires_at=now + expires_in,
            used_at=now if used else None,
        )
    )
    await db.commit()
    return raw


def _email() -> str:
    return f"ml-{uuid.uuid4().hex[:12]}@example.com"


class TestMagicLinkVerify:
    async def test_verify_creates_new_user_and_returns_token(
        self, client: AsyncClient, db_session: AsyncSession, magic_link_enabled
    ):
        email = _email()
        token = await _make_token(db_session, email)

        resp = await client.post(VERIFY_URL, json={"token": token})

        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["email"] == email
        assert data["external_id"] == f"magic:{email}"
        assert data["is_new_user"] is True
        assert data["needs_username"] is True
        assert data["onboarding_completed"] is False
        assert data["access_token"]

        session = await client.get(
            "/api/v1/auth/session",
            headers={"Authorization": f"Bearer {data['access_token']}"},
        )
        assert session.status_code == 200
        assert session.json()["email"] == email

    async def test_verify_is_single_use(
        self, client: AsyncClient, db_session: AsyncSession, magic_link_enabled
    ):
        token = await _make_token(db_session, _email())

        first = await client.post(VERIFY_URL, json={"token": token})
        second = await client.post(VERIFY_URL, json={"token": token})

        assert first.status_code == 200
        assert second.status_code == 400
        assert second.json()["detail"] == "Invalid or expired link"

    async def test_verify_marks_token_used(
        self, client: AsyncClient, db_session: AsyncSession, magic_link_enabled
    ):
        token = await _make_token(db_session, _email())
        resp = await client.post(VERIFY_URL, json={"token": token})
        assert resp.status_code == 200

        token_hash = hashlib.sha256(token.encode()).hexdigest()
        db_session.expire_all()
        row = (
            await db_session.execute(
                select(MagicLinkToken).where(MagicLinkToken.token_hash == token_hash)
            )
        ).scalar_one()
        assert row.used_at is not None
        assert row.used_at.tzinfo is not None

    async def test_verify_rejects_expired_token(
        self, client: AsyncClient, db_session: AsyncSession, magic_link_enabled
    ):
        token = await _make_token(db_session, _email(), expires_in=timedelta(seconds=-1))
        resp = await client.post(VERIFY_URL, json={"token": token})
        assert resp.status_code == 400

    async def test_verify_rejects_already_used_token(
        self, client: AsyncClient, db_session: AsyncSession, magic_link_enabled
    ):
        token = await _make_token(db_session, _email(), used=True)
        resp = await client.post(VERIFY_URL, json={"token": token})
        assert resp.status_code == 400

    async def test_verify_rejects_unknown_token(self, client: AsyncClient, magic_link_enabled):
        resp = await client.post(VERIFY_URL, json={"token": secrets.token_urlsafe(32)})
        assert resp.status_code == 400

    async def test_verify_rejects_malformed_token(self, client: AsyncClient, magic_link_enabled):
        resp = await client.post(VERIFY_URL, json={"token": "short"})
        assert resp.status_code == 422

    async def test_verify_existing_user_keeps_identity(
        self, client: AsyncClient, db_session: AsyncSession, test_user: User, magic_link_enabled
    ):
        token = await _make_token(db_session, test_user.email)

        resp = await client.post(VERIFY_URL, json={"token": token})

        assert resp.status_code == 200
        data = resp.json()
        assert data["is_new_user"] is False
        assert data["id"] == str(test_user.id)
        assert data["external_id"] == test_user.external_id

    async def test_verify_promotes_admin_email(
        self, client: AsyncClient, db_session: AsyncSession, magic_link_enabled, monkeypatch
    ):
        email = _email()
        monkeypatch.setattr(magic_link_enabled, "admin_emails", f"other@example.com,{email}")
        token = await _make_token(db_session, email)

        resp = await client.post(VERIFY_URL, json={"token": token})
        assert resp.status_code == 200

        user = (await db_session.execute(select(User).where(User.email == email))).scalar_one()
        await db_session.refresh(user)
        assert user.role == "admin"

    async def test_verify_inactive_user_forbidden(
        self, client: AsyncClient, db_session: AsyncSession, test_user: User, magic_link_enabled
    ):
        test_user.is_active = False
        await db_session.commit()
        token = await _make_token(db_session, test_user.email)

        resp = await client.post(VERIFY_URL, json={"token": token})
        assert resp.status_code == 403

    async def test_verify_disabled_when_not_configured(self, client: AsyncClient, monkeypatch):
        monkeypatch.setattr(auth_module.settings, "resend_api_key", None)
        resp = await client.post(VERIFY_URL, json={"token": secrets.token_urlsafe(32)})
        assert resp.status_code == 503

    async def test_legacy_get_consume_removed(self, client: AsyncClient, magic_link_enabled):
        resp = await client.get("/api/v1/auth/magic-link/consume?token=abc")
        assert resp.status_code in (404, 405)


class TestMagicLinkRequestToVerify:
    async def test_request_forwards_ui_locale_to_email(
        self, client: AsyncClient, magic_link_enabled
    ):
        with patch.object(auth_module, "send_magic_link_email", new=AsyncMock()) as send:
            resp = await client.post(
                "/api/v1/auth/magic-link/request", json={"email": _email(), "locale": "en"}
            )
        assert resp.status_code == 202
        assert send.await_args.kwargs["locale"] == "en"

    async def test_request_rejects_unknown_locale(self, client: AsyncClient, magic_link_enabled):
        resp = await client.post(
            "/api/v1/auth/magic-link/request", json={"email": _email(), "locale": "xx"}
        )
        assert resp.status_code == 422

    async def test_request_emails_configured_origin_link_that_verifies(
        self, client: AsyncClient, magic_link_enabled
    ):
        email = _email()
        with patch.object(auth_module, "send_magic_link_email", new=AsyncMock()) as send:
            resp = await client.post(
                "/api/v1/auth/magic-link/request",
                json={"email": email},
                # A spoofed Host must not leak into the emailed link.
                headers={"Host": "evil.example", "X-Forwarded-Host": "evil.example"},
            )
        assert resp.status_code == 202
        send.assert_awaited_once()
        to, link = send.await_args.args
        assert to == email

        parsed = urlparse(link)
        assert f"{parsed.scheme}://{parsed.netloc}" == "https://app.example.test"
        assert parsed.path == "/auth/callback"
        token = parse_qs(parsed.query)["token"][0]

        verify = await client.post(VERIFY_URL, json={"token": token})
        assert verify.status_code == 200
        assert verify.json()["email"] == email
