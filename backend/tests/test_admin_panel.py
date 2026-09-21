"""Admin panel: authz, audit log, overview/cost, settings, invites, system, announcement."""

import json
import re
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import create_access_token
from app.config import get_settings
from app.main import app
from app.models.admin import AdminAuditLog, AppSetting, InviteCode
from app.models.user import User
from app.models.user_ai_settings import UserAISettings
from app.services import app_settings as app_cfg
from app.services.ai_access import current_usage_month, make_usage_sink
from app.services.ai_service import AIProviderConfig, AIService
from app.services.app_settings import AIPricing, budget_level, estimate_cost

ADMIN_PREFIX = "/api/v1/admin"


async def make_user(db: AsyncSession, **kwargs) -> User:
    uid = uuid4()
    defaults = {
        "id": uid,
        "external_id": f"ext-{uid}",
        "email": f"u-{uid}@example.com",
        "display_name": "Someone",
        "timezone": "UTC",
        "is_active": True,
    }
    defaults.update(kwargs)
    user = User(**defaults)
    db.add(user)
    await db.commit()
    return user


def headers_for(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.external_id)}"}


@pytest_asyncio.fixture
async def admin_user(db_session: AsyncSession, monkeypatch) -> User:
    uid = uuid4()
    email = f"admin-{uid}@example.com"
    monkeypatch.setattr(get_settings(), "admin_emails", email)
    return await make_user(db_session, id=uid, email=email, username=f"adm{uid.hex[:8]}")


@pytest.fixture
def admin_headers(admin_user: User) -> dict[str, str]:
    return headers_for(admin_user)


@pytest_asyncio.fixture(autouse=True)
async def _reset_app_settings(db_session: AsyncSession):
    """app_settings is global state: start and end every test with defaults."""
    await db_session.execute(delete(AppSetting))
    await db_session.commit()
    app_cfg.invalidate_announcement_cache()
    yield
    await db_session.rollback()
    await db_session.execute(delete(AppSetting))
    await db_session.commit()
    app_cfg.invalidate_announcement_cache()


async def audit_rows(db: AsyncSession, admin: User, action: str) -> list[AdminAuditLog]:
    result = await db.execute(
        select(AdminAuditLog)
        .where(AdminAuditLog.admin_id == admin.id, AdminAuditLog.action == action)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars())


# --- Authorization -------------------------------------------------------------------------


def _admin_routes() -> list[tuple[str, str]]:
    # From the OpenAPI schema: newer FastAPI versions include routers lazily,
    # so app.routes does not list the individual endpoints.
    routes = []
    for path, operations in app.openapi()["paths"].items():
        if path.startswith(ADMIN_PREFIX):
            for method in operations:
                routes.append((method.upper(), path))
    return sorted(routes)


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", str(uuid4()), path)


def test_admin_routes_are_discovered():
    paths = {p for _, p in _admin_routes()}
    for expected in (
        "/api/v1/admin/users",
        "/api/v1/admin/users/{user_id}",
        "/api/v1/admin/users/{user_id}/password",
        "/api/v1/admin/users/{user_id}/delete",
        "/api/v1/admin/overview",
        "/api/v1/admin/settings/ai-pricing",
        "/api/v1/admin/signup",
        "/api/v1/admin/invites",
        "/api/v1/admin/invites/{invite_id}/revoke",
        "/api/v1/admin/feedback",
        "/api/v1/admin/feedback/{feedback_id}",
        "/api/v1/admin/feedback/{feedback_id}/screenshot",
        "/api/v1/admin/system",
        "/api/v1/admin/announcement",
        "/api/v1/admin/audit",
        "/api/v1/admin/badge",
        "/api/v1/admin/deletions",
    ):
        assert expected in paths


@pytest.mark.parametrize(("method", "path"), _admin_routes())
async def test_every_admin_endpoint_requires_site_admin(
    client: AsyncClient, db_session: AsyncSession, method: str, path: str, monkeypatch
):
    # A family admin (role="admin") is NOT a site admin.
    monkeypatch.setattr(get_settings(), "admin_emails", "someone-else@example.com")
    member = await make_user(db_session, role="admin")
    url = _concrete(path)
    body = {} if method in ("POST", "PUT", "PATCH") else None

    anon = await client.request(method, url, json=body)
    assert anon.status_code in (401, 403), (method, path, anon.status_code)

    resp = await client.request(method, url, json=body, headers=headers_for(member))
    assert resp.status_code == 403, (method, path, resp.status_code, resp.text)


# --- Audit log --------------------------------------------------------------------------------


class TestAuditLog:
    async def test_user_patch_is_audited(self, client, db_session, admin_user, admin_headers):
        target = await make_user(db_session)
        resp = await client.patch(
            f"{ADMIN_PREFIX}/users/{target.id}",
            json={"ai_access": "platform", "monthly_request_cap": 50},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        rows = await audit_rows(db_session, admin_user, "user.update")
        assert len(rows) == 1
        assert rows[0].target_user_id == target.id
        assert rows[0].details["ai_access"] == {"from": "none", "to": "platform"}
        assert rows[0].details["monthly_request_cap"] == {"from": None, "to": 50}

    async def test_noop_patch_is_not_audited(self, client, db_session, admin_user, admin_headers):
        target = await make_user(db_session)
        resp = await client.patch(
            f"{ADMIN_PREFIX}/users/{target.id}", json={"is_active": True}, headers=admin_headers
        )
        assert resp.status_code == 200
        assert await audit_rows(db_session, admin_user, "user.update") == []

    async def test_password_removal_is_audited(self, client, db_session, admin_user, admin_headers):
        target = await make_user(db_session, password_hash="$argon2id$fake")
        resp = await client.delete(
            f"{ADMIN_PREFIX}/users/{target.id}/password", headers=admin_headers
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["has_password"] is False
        await db_session.refresh(target)
        assert target.password_hash is None
        assert len(await audit_rows(db_session, admin_user, "user.password_removed")) == 1

    async def test_settings_invites_and_announcement_are_audited(
        self, client, db_session, admin_user, admin_headers
    ):
        r = await client.put(
            f"{ADMIN_PREFIX}/signup", json={"mode": "invite_only"}, headers=admin_headers
        )
        assert r.status_code == 200
        r = await client.put(
            f"{ADMIN_PREFIX}/settings/ai-pricing",
            json={
                "input_usd_per_m": 0.2,
                "output_usd_per_m": 0.8,
                "usd_eur_rate": 0.9,
                "monthly_budget_eur": 5,
            },
            headers=admin_headers,
        )
        assert r.status_code == 200
        r = await client.post(f"{ADMIN_PREFIX}/invites", json={}, headers=admin_headers)
        assert r.status_code == 201
        invite_id = r.json()["id"]
        r = await client.post(f"{ADMIN_PREFIX}/invites/{invite_id}/revoke", headers=admin_headers)
        assert r.status_code == 200
        r = await client.put(
            f"{ADMIN_PREFIX}/announcement", json={"text": "Hola"}, headers=admin_headers
        )
        assert r.status_code == 200
        r = await client.delete(f"{ADMIN_PREFIX}/announcement", headers=admin_headers)
        assert r.status_code == 200

        for action in (
            "settings.signup_mode",
            "settings.ai_pricing",
            "invite.create",
            "invite.revoke",
            "announcement.set",
            "announcement.clear",
        ):
            assert len(await audit_rows(db_session, admin_user, action)) == 1, action

        listing = await client.get(f"{ADMIN_PREFIX}/audit", headers=admin_headers)
        assert listing.status_code == 200
        assert {e["action"] for e in listing.json()} >= {"invite.create", "settings.signup_mode"}


# --- User detail ---------------------------------------------------------------------------------


async def test_user_detail_shows_counts_not_content(client, db_session, admin_headers):
    target = await make_user(db_session, username=f"u{uuid4().hex[:8]}", password_hash="x")
    resp = await client.get(f"{ADMIN_PREFIX}/users/{target.id}", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["has_password"] is True
    assert data["item_count"] == 0 and data["outfit_count"] == 0
    assert data["spotify_connected"] is False and data["pinterest_connected"] is False
    # friends feature not installed on this branch -> null, never an error
    assert "friend_count" in data
    assert "items" not in data and "outfits" not in data


async def test_user_detail_404(client, admin_headers):
    resp = await client.get(f"{ADMIN_PREFIX}/users/{uuid4()}", headers=admin_headers)
    assert resp.status_code == 404


# --- Cost estimate & token split ------------------------------------------------------------------


class TestCost:
    def test_estimate_cost_split(self):
        pricing = AIPricing(0.15, 0.60, 0.92, None)
        cost = estimate_cost(pricing, 1_000_000, 1_000_000, 2_000_000)
        assert cost.cost_usd == pytest.approx(0.75)
        assert cost.cost_eur == pytest.approx(0.69)
        assert cost.unsplit_tokens == 0

    def test_unsplit_tokens_priced_at_output_rate(self):
        pricing = AIPricing(0.15, 0.60, 1.0, None)
        # 1M tokens recorded before the split existed
        cost = estimate_cost(pricing, 0, 0, 1_000_000)
        assert cost.unsplit_tokens == 1_000_000
        assert cost.cost_usd == pytest.approx(0.60)

    def test_budget_levels(self):
        assert budget_level(1, None) == "ok"
        assert budget_level(7.9, 10) == "ok"
        assert budget_level(8, 10) == "warning"
        assert budget_level(10, 10) == "exceeded"

    async def test_env_defaults(self, db_session):
        pricing = await app_cfg.get_ai_pricing(db_session)
        assert pricing.input_usd_per_m == 0.15
        assert pricing.output_usd_per_m == 0.60
        assert pricing.usd_eur_rate == 0.92

    async def test_sink_records_prompt_and_completion(self, db_session, test_user):
        sink = make_usage_sink(db_session, test_user.id)
        await sink(1, 30, prompt_tokens=10, completion_tokens=20)
        await sink(1, 5)  # legacy two-arg call still works
        row = (
            await db_session.execute(
                select(UserAISettings)
                .where(UserAISettings.user_id == test_user.id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert (row.tokens_this_month, row.prompt_tokens_this_month) == (35, 10)
        assert row.completion_tokens_this_month == 20

    async def test_ai_service_reports_split(self, monkeypatch):
        calls = []

        async def sink(requests, tokens, prompt_tokens=0, completion_tokens=0):
            calls.append((requests, tokens, prompt_tokens, completion_tokens))

        monkeypatch.setattr(get_settings(), "ai_internal_enabled", True)
        service = AIService(
            config=AIProviderConfig(base_url="https://x.test", text_model="m"), usage_sink=sink
        )
        await service._record_usage(
            {"usage": {"prompt_tokens": 7, "completion_tokens": 3, "total_tokens": 10}}
        )
        assert calls == [(1, 10, 7, 3)]

    async def test_overview_cost_and_budget(self, client, db_session, admin_headers):
        heavy = await make_user(db_session, username=f"h{uuid4().hex[:8]}")
        db_session.add(
            UserAISettings(
                user_id=heavy.id,
                ai_access="platform",
                usage_month=current_usage_month(),
                requests_this_month=10,
                tokens_this_month=300_000_000,
                prompt_tokens_this_month=200_000_000,
                completion_tokens_this_month=100_000_000,
            )
        )
        await db_session.commit()
        r = await client.put(
            f"{ADMIN_PREFIX}/settings/ai-pricing",
            json={
                "input_usd_per_m": 0.15,
                "output_usd_per_m": 0.60,
                "usd_eur_rate": 1.0,
                "monthly_budget_eur": 1,
            },
            headers=admin_headers,
        )
        assert r.status_code == 200
        resp = await client.get(f"{ADMIN_PREFIX}/overview", headers=admin_headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        ai = data["ai"]
        # heavy alone: 200M*0.15 + 100M*0.60 = 30 + 60 = 90 USD (other test rows add more)
        assert ai["cost_eur"] >= 90
        assert ai["budget_level"] == "exceeded"
        assert any(u["id"] == str(heavy.id) for u in ai["top_users"])
        assert len(data["signups_by_day"]) == 14
        assert data["users_total"] >= 1
        assert 0 <= data["onboarding_pct"] <= 100


# --- Invites & sign-up mode ------------------------------------------------------------------------


class TestInvites:
    async def test_create_list_revoke(self, client, admin_headers, monkeypatch):
        monkeypatch.setattr(get_settings(), "magic_link_base_url", "https://app.example.test")
        expires = (datetime.now(UTC) + timedelta(days=3)).isoformat()
        r = await client.post(
            f"{ADMIN_PREFIX}/invites",
            json={"note": "amigos", "max_uses": 2, "expires_at": expires},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        invite = r.json()
        assert invite["status"] == "active"
        assert invite["link"] == f"https://app.example.test/login?invite={invite['code']}"

        listing = await client.get(f"{ADMIN_PREFIX}/invites", headers=admin_headers)
        assert any(i["id"] == invite["id"] for i in listing.json())

        r = await client.post(
            f"{ADMIN_PREFIX}/invites/{invite['id']}/revoke", headers=admin_headers
        )
        assert r.json()["status"] == "revoked"

    async def test_expiry_must_be_future(self, client, admin_headers):
        past = (datetime.now(UTC) - timedelta(days=1)).isoformat()
        r = await client.post(
            f"{ADMIN_PREFIX}/invites", json={"expires_at": past}, headers=admin_headers
        )
        assert r.status_code == 422

    async def test_signup_mode_default_open_and_persisted(self, client, admin_headers):
        r = await client.get(f"{ADMIN_PREFIX}/signup", headers=admin_headers)
        assert r.json() == {"mode": "open"}
        await client.put(
            f"{ADMIN_PREFIX}/signup", json={"mode": "invite_only"}, headers=admin_headers
        )
        r = await client.get(f"{ADMIN_PREFIX}/signup", headers=admin_headers)
        assert r.json() == {"mode": "invite_only"}
        bad = await client.put(
            f"{ADMIN_PREFIX}/signup", json={"mode": "closed"}, headers=admin_headers
        )
        assert bad.status_code == 422


# --- System -------------------------------------------------------------------------------------------


class TestSystem:
    async def test_backup_not_configured(self, client, admin_headers, monkeypatch):
        monkeypatch.setattr(get_settings(), "backup_status_path", None)
        r = await client.get(f"{ADMIN_PREFIX}/system", headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["backup"] == {"configured": False}
        assert data["database"]["bytes"] > 0
        assert "alive" in data["worker"]
        assert data["spotify"]["dev_mode_slots"] == 5
        assert isinstance(data["pinterest"]["configured"], bool)
        assert "bytes" in data["uploads"]

    async def test_backup_status_read(self, client, admin_headers, monkeypatch, tmp_path):
        path = tmp_path / "last-backup.json"
        path.write_text(json.dumps({"status": "ok", "finished_at": "2026-09-21T03:00:00Z"}))
        monkeypatch.setattr(get_settings(), "backup_status_path", str(path))
        monkeypatch.setattr(get_settings(), "app_version", "2.1.0")
        monkeypatch.setattr(get_settings(), "git_sha", "abc1234")
        r = await client.get(f"{ADMIN_PREFIX}/system", headers=admin_headers)
        data = r.json()
        assert data["backup"]["ok"] is True
        assert data["backup"]["data"]["status"] == "ok"
        assert data["version"] == {"app_version": "2.1.0", "git_sha": "abc1234"}

    async def test_backup_missing_file(self, client, admin_headers, monkeypatch, tmp_path):
        monkeypatch.setattr(get_settings(), "backup_status_path", str(tmp_path / "nope.json"))
        r = await client.get(f"{ADMIN_PREFIX}/system", headers=admin_headers)
        assert r.json()["backup"] == {"configured": True, "ok": False, "error": "not_found"}


# --- Announcement ---------------------------------------------------------------------------------


class TestAnnouncement:
    async def test_public_get_set_expire(self, client, admin_headers):
        r = await client.get("/api/v1/announcement")
        assert r.status_code == 200
        assert r.json() == {"announcement": None}

        r = await client.put(
            f"{ADMIN_PREFIX}/announcement",
            json={"text": "Mantenimiento esta noche", "level": "warning"},
            headers=admin_headers,
        )
        first_id = r.json()["announcement"]["id"]
        r = await client.get("/api/v1/announcement")
        data = r.json()["announcement"]
        assert data["text"] == "Mantenimiento esta noche"
        assert data["level"] == "warning"
        assert "max-age" in r.headers["cache-control"]

        past = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
        r = await client.put(
            f"{ADMIN_PREFIX}/announcement",
            json={"text": "Viejo", "expires_at": past},
            headers=admin_headers,
        )
        assert r.json()["announcement"]["id"] != first_id
        r = await client.get("/api/v1/announcement")
        assert r.json() == {"announcement": None}

    async def test_invalid_level_rejected(self, client, admin_headers):
        r = await client.put(
            f"{ADMIN_PREFIX}/announcement",
            json={"text": "x", "level": "danger"},
            headers=admin_headers,
        )
        assert r.status_code == 422


async def test_invite_code_uniqueness_column(db_session):
    code = f"T{uuid4().hex[:8].upper()}"
    db_session.add(InviteCode(id=uuid4(), code=code))
    await db_session.commit()
    found = (await db_session.execute(select(InviteCode).where(InviteCode.code == code))).scalar()
    assert found is not None and found.uses == 0
