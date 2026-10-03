"""AI for new accounts: capped platform grant at sign-up, switchable from the admin panel."""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import auth as auth_module
from app.api.auth import create_access_token
from app.config import get_settings
from app.models.admin import AdminAuditLog, AppSetting
from app.models.magic_link import MagicLinkToken
from app.models.user import User
from app.models.user_ai_settings import UserAISettings
from app.schemas.user import UserSyncRequest
from app.services import app_settings as app_cfg
from app.services.ai_access import grant_new_user_ai
from app.services.user_service import UserService

VERIFY_URL = "/api/v1/auth/magic-link/verify"
SETTINGS_URL = "/api/v1/admin/settings/new-user-ai"


@pytest_asyncio.fixture(autouse=True)
async def _reset_app_settings(db_session: AsyncSession):
    """app_settings is global state: start and end every test with defaults."""
    await db_session.execute(delete(AppSetting))
    await db_session.commit()
    yield
    await db_session.rollback()
    await db_session.execute(delete(AppSetting))
    await db_session.commit()


@pytest.fixture
def magic_link_enabled(monkeypatch):
    monkeypatch.setattr(auth_module.settings, "resend_api_key", "re_test_key")
    monkeypatch.setattr(auth_module.settings, "magic_link_base_url", "https://app.example.test")
    monkeypatch.setattr(auth_module.settings, "admin_emails", "")
    return auth_module.settings


async def _set(db: AsyncSession, key: str, value) -> None:
    await app_cfg.set_setting(db, key, value, None)
    await db.commit()


async def _token(db: AsyncSession, email: str) -> str:
    raw = secrets.token_urlsafe(32)
    db.add(
        MagicLinkToken(
            id=uuid.uuid4(),
            email=email,
            token_hash=hashlib.sha256(raw.encode()).hexdigest(),
            expires_at=datetime.now(UTC) + timedelta(minutes=15),
        )
    )
    await db.commit()
    return raw


def _email() -> str:
    return f"newai-{uuid.uuid4().hex[:12]}@example.com"


async def _ai_row(db: AsyncSession, email: str) -> UserAISettings | None:
    result = await db.execute(
        select(UserAISettings)
        .join(User, User.id == UserAISettings.user_id)
        .where(User.email == email)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def _make_user(db: AsyncSession, **kwargs) -> User:
    uid = uuid.uuid4()
    fields = {
        "id": uid,
        "external_id": f"ext-{uid}",
        "email": f"u-{uid}@example.com",
        "display_name": "Someone",
        "timezone": "UTC",
        "is_active": True,
    }
    user = User(**{**fields, **kwargs})
    db.add(user)
    await db.commit()
    return user


# --- Settings ----------------------------------------------------------------------


class TestSettingsDefaults:
    async def test_missing_keys_mean_platform_with_150(self, db_session):
        assert await app_cfg.get_new_user_ai_access(db_session) == "platform"
        assert await app_cfg.get_new_user_ai_monthly_cap(db_session) == 150

    async def test_garbage_stored_values_fall_back_to_defaults(self, db_session):
        await _set(db_session, app_cfg.KEY_NEW_USER_AI_ACCESS, "byok")
        await _set(db_session, app_cfg.KEY_NEW_USER_AI_MONTHLY_CAP, 0)
        assert await app_cfg.get_new_user_ai_access(db_session) == "platform"
        assert await app_cfg.get_new_user_ai_monthly_cap(db_session) == 150
        await _set(db_session, app_cfg.KEY_NEW_USER_AI_MONTHLY_CAP, None)
        assert await app_cfg.get_new_user_ai_monthly_cap(db_session) == 150


# --- Creation paths ---------------------------------------------------------------------


class TestGrantOnSignup:
    async def test_magic_link_new_user_gets_capped_platform(
        self, client, db_session, magic_link_enabled
    ):
        email = _email()
        r = await client.post(VERIFY_URL, json={"token": await _token(db_session, email)})
        assert r.status_code == 200, r.text
        assert r.json()["is_new_user"] is True
        row = await _ai_row(db_session, email)
        assert row is not None
        assert row.ai_access == "platform"
        assert row.monthly_request_cap == 150

    async def test_magic_link_uses_configured_cap(self, client, db_session, magic_link_enabled):
        await _set(db_session, app_cfg.KEY_NEW_USER_AI_ACCESS, "platform")
        await _set(db_session, app_cfg.KEY_NEW_USER_AI_MONTHLY_CAP, 40)
        email = _email()
        r = await client.post(VERIFY_URL, json={"token": await _token(db_session, email)})
        assert r.status_code == 200, r.text
        row = await _ai_row(db_session, email)
        assert row is not None
        assert (row.ai_access, row.monthly_request_cap) == ("platform", 40)

    async def test_none_setting_creates_no_row(self, client, db_session, magic_link_enabled):
        await _set(db_session, app_cfg.KEY_NEW_USER_AI_ACCESS, "none")
        email = _email()
        r = await client.post(VERIFY_URL, json={"token": await _token(db_session, email)})
        assert r.status_code == 200, r.text
        assert await _ai_row(db_session, email) is None

    async def test_existing_user_login_is_not_granted(self, client, db_session, magic_link_enabled):
        user = await _make_user(db_session)
        r = await client.post(VERIFY_URL, json={"token": await _token(db_session, user.email)})
        assert r.status_code == 200, r.text
        assert r.json()["is_new_user"] is False
        assert await _ai_row(db_session, user.email) is None

    async def test_auth_sync_new_user_gets_grant(self, client, db_session):
        email = _email()
        r = await client.post(
            "/api/v1/auth/sync",
            json={"external_id": f"sync-{uuid.uuid4()}", "email": email, "display_name": "N"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["is_new_user"] is True
        row = await _ai_row(db_session, email)
        assert row is not None
        assert (row.ai_access, row.monthly_request_cap) == ("platform", 150)

    async def test_oidc_sync_respects_none(self, db_session):
        await _set(db_session, app_cfg.KEY_NEW_USER_AI_ACCESS, "none")
        email = _email()
        _, is_new = await UserService(db_session).sync_from_oidc(
            UserSyncRequest(external_id=f"oidc-{uuid.uuid4()}", email=email, display_name="N")
        )
        await db_session.commit()
        assert is_new is True
        assert await _ai_row(db_session, email) is None

    async def test_existing_row_is_never_overwritten(self, db_session):
        user = await _make_user(db_session)
        db_session.add(
            UserAISettings(user_id=user.id, ai_access="byok", byok_base_url="https://x.test")
        )
        await db_session.commit()

        await grant_new_user_ai(db_session, user.id)
        await db_session.commit()

        row = await _ai_row(db_session, user.email)
        assert row is not None
        assert row.ai_access == "byok"
        assert row.monthly_request_cap is None
        assert row.byok_base_url == "https://x.test"


# --- Admin API ----------------------------------------------------------------------------


@pytest_asyncio.fixture
async def admin_user(db_session: AsyncSession, monkeypatch) -> User:
    uid = uuid.uuid4()
    email = f"admin-{uid}@example.com"
    monkeypatch.setattr(get_settings(), "admin_emails", email)
    return await _make_user(db_session, email=email, username=f"adm{uid.hex[:8]}")


@pytest.fixture
def admin_headers(admin_user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(admin_user.external_id)}"}


class TestAdminSettings:
    async def test_get_defaults(self, client, admin_headers):
        r = await client.get(SETTINGS_URL, headers=admin_headers)
        assert r.status_code == 200
        assert r.json() == {"access": "platform", "monthly_cap": 150}

    async def test_update_persists_and_is_audited(
        self, client, db_session, admin_user, admin_headers
    ):
        r = await client.put(
            SETTINGS_URL, json={"access": "none", "monthly_cap": 300}, headers=admin_headers
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"access": "none", "monthly_cap": 300}
        r = await client.get(SETTINGS_URL, headers=admin_headers)
        assert r.json() == {"access": "none", "monthly_cap": 300}
        assert await app_cfg.get_new_user_ai_access(db_session) == "none"
        assert await app_cfg.get_new_user_ai_monthly_cap(db_session) == 300

        rows = (
            await db_session.execute(
                select(AdminAuditLog).where(
                    AdminAuditLog.admin_id == admin_user.id,
                    AdminAuditLog.action == "settings.new_user_ai",
                )
            )
        ).scalars()
        (entry,) = list(rows)
        assert entry.details["before"] == {"access": "platform", "monthly_cap": 150}
        assert entry.details["after"] == {"access": "none", "monthly_cap": 300}

    @pytest.mark.parametrize(
        "body",
        [
            {"access": "platform", "monthly_cap": 0},
            {"access": "platform", "monthly_cap": 9},
            {"access": "platform", "monthly_cap": 5001},
            {"access": "platform", "monthly_cap": None},
            {"access": "platform"},
            {"access": "byok", "monthly_cap": 150},
            {"access": None, "monthly_cap": 150},
        ],
    )
    async def test_validation_rejects_bad_values(self, client, db_session, admin_headers, body):
        r = await client.put(SETTINGS_URL, json=body, headers=admin_headers)
        assert r.status_code == 422, r.text
        assert await app_cfg.get_setting(db_session, app_cfg.KEY_NEW_USER_AI_MONTHLY_CAP) is None

    async def test_bounds_are_accepted(self, client, admin_headers):
        for cap in (10, 5000):
            r = await client.put(
                SETTINGS_URL, json={"access": "platform", "monthly_cap": cap}, headers=admin_headers
            )
            assert r.status_code == 200, r.text
            assert r.json()["monthly_cap"] == cap

    async def test_requires_site_admin(self, client, db_session, monkeypatch):
        monkeypatch.setattr(get_settings(), "admin_emails", "someone-else@example.com")
        member = await _make_user(db_session, role="admin")
        headers = {"Authorization": f"Bearer {create_access_token(member.external_id)}"}
        assert (await client.get(SETTINGS_URL, headers=headers)).status_code == 403
        r = await client.put(
            SETTINGS_URL, json={"access": "none", "monthly_cap": 150}, headers=headers
        )
        assert r.status_code == 403
