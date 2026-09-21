"""Closed-beta waitlist: public join (no enumeration) + admin approve/reject."""

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest_asyncio
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import admin_panel as admin_panel_module
from app.api import auth as auth_module
from app.models.admin import AdminAuditLog, AppSetting, InviteCode, WaitlistRequest
from app.models.user import User
from app.services import app_settings as app_cfg
from app.utils.email_templates import render_waitlist_approved_email
from tests.test_admin_panel import ADMIN_PREFIX, headers_for, make_user

JOIN_URL = "/api/v1/waitlist"


def _email() -> str:
    return f"wl-{uuid.uuid4().hex[:12]}@example.com"


@pytest_asyncio.fixture
async def invite_only(db_session: AsyncSession):
    await app_cfg.set_setting(db_session, app_cfg.KEY_SIGNUP_MODE, "invite_only", None)
    await db_session.commit()
    yield
    await db_session.rollback()
    await db_session.execute(delete(AppSetting))
    await db_session.commit()


@pytest_asyncio.fixture
async def admin_user(db_session: AsyncSession, monkeypatch) -> User:
    uid = uuid.uuid4()
    email = f"admin-{uid}@example.com"
    monkeypatch.setattr(auth_module.settings, "admin_emails", email)
    return await make_user(db_session, id=uid, email=email, username=f"adm{uid.hex[:8]}")


async def _requests(db: AsyncSession, email: str) -> list[WaitlistRequest]:
    rows = await db.execute(
        select(WaitlistRequest)
        .where(WaitlistRequest.email == email)
        .execution_options(populate_existing=True)
    )
    return list(rows.scalars())


class TestJoin:
    async def test_same_answer_for_new_duplicate_and_existing_account(
        self, client, db_session, test_user
    ):
        email = _email()
        first = await client.post(
            JOIN_URL,
            json={
                "email": f"  {email.upper()} ",
                "name": " Ana ",
                "message": "Me encanta la moda",
                "locale": "en",
            },
        )
        again = await client.post(JOIN_URL, json={"email": email, "message": "otra vez"})
        existing = await client.post(JOIN_URL, json={"email": test_user.email})
        assert first.status_code == again.status_code == existing.status_code == 202
        assert first.json() == again.json() == existing.json() == {"status": "ok"}

        [row] = await _requests(db_session, email)  # normalised, no duplicate
        assert row.name == "Ana"
        assert row.message == "Me encanta la moda"  # first request wins
        assert row.locale == "en"
        assert row.status == "pending"
        # An existing account never gets a waitlist row.
        assert await _requests(db_session, test_user.email.lower()) == []

    async def test_message_is_capped(self, client):
        r = await client.post(JOIN_URL, json={"email": _email(), "message": "x" * 281})
        assert r.status_code == 422

    async def test_rate_limited_per_ip(self, client):
        codes = [
            (await client.post(JOIN_URL, json={"email": _email()})).status_code for _ in range(11)
        ]
        assert codes[:10] == [202] * 10
        assert codes[10] == 429

    async def test_auth_config_exposes_signup_mode(self, client, invite_only):
        r = await client.get("/api/v1/auth/config")
        assert r.json()["signup_mode"] == "invite_only"


class TestAdmin:
    async def _pending(self, db: AsyncSession, n: int, locale: str = "es") -> list[WaitlistRequest]:
        rows = [
            WaitlistRequest(email=_email(), name=f"P{i}", message="hola", locale=locale)
            for i in range(n)
        ]
        db.add_all(rows)
        await db.commit()
        return rows

    async def test_requires_site_admin(self, client, db_session, test_user):
        r = await client.get(f"{ADMIN_PREFIX}/waitlist", headers=headers_for(test_user))
        assert r.status_code == 403
        r = await client.post(
            f"{ADMIN_PREFIX}/waitlist/decide",
            json={"ids": [str(uuid.uuid4())], "action": "approve"},
            headers=headers_for(test_user),
        )
        assert r.status_code == 403

    async def test_list_and_badge(self, client, db_session, admin_user):
        rows = await self._pending(db_session, 2)
        headers = headers_for(admin_user)
        r = await client.get(f"{ADMIN_PREFIX}/waitlist", headers=headers)
        assert r.status_code == 200
        body = r.json()
        ids = {i["id"] for i in body["items"]}
        assert {str(w.id) for w in rows} <= ids
        assert body["pending_count"] >= 2
        badge = (await client.get(f"{ADMIN_PREFIX}/badge", headers=headers)).json()
        assert badge["waitlist_pending"] == body["pending_count"]

    async def test_bulk_approve_creates_bound_single_use_invites_and_emails(
        self, client, db_session, admin_user
    ):
        rows = await self._pending(db_session, 2, locale="en")
        ids = [str(w.id) for w in rows]
        emails = {w.email for w in rows}
        with patch.object(
            admin_panel_module, "send_waitlist_approved_email", new=AsyncMock()
        ) as send:
            r = await client.post(
                f"{ADMIN_PREFIX}/waitlist/decide",
                json={"ids": ids, "action": "approve"},
                headers=headers_for(admin_user),
            )
        assert r.status_code == 200, r.text
        assert r.json() == {"approved": 2, "rejected": 0, "skipped": 0, "emails_failed": 0}
        assert send.await_count == 2
        for call in send.await_args_list:
            to, url = call.args
            assert to in emails
            assert "/login?invite=" in url
            assert call.kwargs["locale"] == "en"

        for w in rows:
            [req] = await _requests(db_session, w.email)
            assert req.status == "approved"
            assert req.decided_by == admin_user.id
            assert req.decided_at is not None
            invite = await db_session.get(InviteCode, req.invite_id, populate_existing=True)
            assert invite.email == w.email
            assert invite.max_uses == 1
            assert invite.uses == 0
            delta = invite.expires_at - datetime.now(UTC)
            assert timedelta(days=13) < delta <= timedelta(days=14)

        actions = (
            await db_session.execute(
                select(func.count(AdminAuditLog.id)).where(
                    AdminAuditLog.admin_id == admin_user.id,
                    AdminAuditLog.action == "waitlist.approve",
                )
            )
        ).scalar_one()
        assert actions == 2

        # Deciding again is a no-op (skipped), no second invite or email.
        with patch.object(
            admin_panel_module, "send_waitlist_approved_email", new=AsyncMock()
        ) as send:
            r = await client.post(
                f"{ADMIN_PREFIX}/waitlist/decide",
                json={"ids": ids, "action": "reject"},
                headers=headers_for(admin_user),
            )
        assert r.json()["skipped"] == 2
        send.assert_not_awaited()

    async def test_reject_sends_no_email(self, client, db_session, admin_user):
        [row] = await self._pending(db_session, 1)
        with patch.object(
            admin_panel_module, "send_waitlist_approved_email", new=AsyncMock()
        ) as send:
            r = await client.post(
                f"{ADMIN_PREFIX}/waitlist/decide",
                json={"ids": [str(row.id)], "action": "reject"},
                headers=headers_for(admin_user),
            )
        assert r.json()["rejected"] == 1
        send.assert_not_awaited()
        [req] = await _requests(db_session, row.email)
        assert req.status == "rejected"
        assert req.invite_id is None

    async def test_email_failure_keeps_the_approval(self, client, db_session, admin_user):
        [row] = await self._pending(db_session, 1)
        with patch.object(
            admin_panel_module,
            "send_waitlist_approved_email",
            new=AsyncMock(side_effect=RuntimeError("resend down")),
        ):
            r = await client.post(
                f"{ADMIN_PREFIX}/waitlist/decide",
                json={"ids": [str(row.id)], "action": "approve"},
                headers=headers_for(admin_user),
            )
        assert r.json()["approved"] == 1
        assert r.json()["emails_failed"] == 1
        [req] = await _requests(db_session, row.email)
        assert req.status == "approved"


def test_approved_email_template_es_and_en():
    es = render_waitlist_approved_email(
        invite_url="https://x.test/login?invite=ABC", name="Ana", locale="es"
    )
    assert "¡Estás dentro! Stinky te abre la puerta" in es.html
    assert "https://x.test/login?invite=ABC" in es.text
    assert "Ana" in es.text
    en = render_waitlist_approved_email(invite_url="https://x.test/login?invite=ABC", locale="en")
    assert "You're in" in en.subject
    assert "14 days" in en.text
