"""Per-user AI access: resolution (none/platform/byok/admin), BYOK encryption,
SSRF validation, /users/me/ai endpoints, admin endpoints and graceful degradation
for users without AI."""

import json
from io import BytesIO
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
import pytest
from cryptography.fernet import Fernet
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import create_access_token
from app.config import get_settings
from app.integrations import crypto
from app.models.item import ClothingItem, ItemStatus, TaggingStatus
from app.models.user import User
from app.models.user_ai_settings import UserAISettings
from app.services import ai_access
from app.services.ai_access import (
    AINotEnabledError,
    AIQuotaExceededError,
    ProviderURLError,
    current_usage_month,
    get_ai_access,
    make_usage_sink,
    normalize_provider_url,
    require_ai_client,
    validate_provider_url,
)
from app.services.ai_service import AIProviderConfig, AIResponseError, AIService

PUBLIC_IP = "104.18.0.1"


@pytest.fixture
def ai_env(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(
        settings, "integrations_token_encryption_key", Fernet.generate_key().decode()
    )
    monkeypatch.setattr(settings, "ai_base_url", "https://platform.example.test/v1")
    monkeypatch.setattr(settings, "ai_api_key", "platform-secret-key")
    monkeypatch.setattr(settings, "ai_vision_model", "platform-vision")
    monkeypatch.setattr(settings, "ai_text_model", "platform-text")
    monkeypatch.setattr(settings, "admin_emails", "")
    crypto._fernet.cache_clear()

    async def _public(host, port):
        return [PUBLIC_IP]

    monkeypatch.setattr(ai_access, "_resolve_host", _public)
    yield settings
    crypto._fernet.cache_clear()


def _make_admin(monkeypatch, user: User) -> None:
    monkeypatch.setattr(get_settings(), "admin_emails", f"someone@else.test,{user.email.upper()}")


async def _make_user(db: AsyncSession, **kwargs) -> User:
    uid = uuid4()
    user = User(
        id=uid,
        external_id=f"ext-{uid}",
        email=f"u-{uid}@example.com",
        display_name="Other",
        timezone="UTC",
        is_active=True,
        **kwargs,
    )
    db.add(user)
    await db.commit()
    return user


async def _set_access(db: AsyncSession, user: User, **fields) -> UserAISettings:
    row = UserAISettings(user_id=user.id, **fields)
    db.add(row)
    await db.commit()
    return row


def _completion(content, finish_reason="stop", usage=None) -> dict:
    data = {
        "model": "m",
        "choices": [{"message": {"content": content}, "finish_reason": finish_reason}],
    }
    if usage is not None:
        data["usage"] = usage
    return data


def _patch_post(monkeypatch, handler):
    """Stub outbound provider calls; the in-process test client keeps working."""
    original = httpx.AsyncClient.post

    async def _post(self, url, **kwargs):
        if not str(url).startswith("https://"):
            return await original(self, url, **kwargs)
        status_code, body = handler(url, kwargs.get("headers") or {}, kwargs.get("json") or {})
        return httpx.Response(
            status_code,
            content=json.dumps(body).encode(),
            headers={"content-type": "application/json"},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", _post)


# --- Resolution -----------------------------------------------------------------


class TestResolution:
    async def test_new_user_has_no_ai(self, db_session, test_user, ai_env):
        access = await get_ai_access(db_session, test_user)
        assert access.effective_access == "none"
        assert not access.supports("text")
        assert not access.supports("vision")
        with pytest.raises(AINotEnabledError):
            await require_ai_client(db_session, test_user, "text")
        assert await ai_access.resolve_ai_client(db_session, test_user, "text") is None

    async def test_platform_uses_global_config(self, db_session, test_user, ai_env):
        await _set_access(db_session, test_user, ai_access="platform")
        service = await require_ai_client(db_session, test_user, "vision")
        assert service.base_url == "https://platform.example.test/v1"
        assert service.api_key == "platform-secret-key"
        assert service.vision_model == "platform-vision"

    async def test_platform_cap_enforced(self, db_session, test_user, ai_env):
        await _set_access(
            db_session,
            test_user,
            ai_access="platform",
            monthly_request_cap=2,
            usage_month=current_usage_month(),
            requests_this_month=2,
        )
        with pytest.raises(AIQuotaExceededError):
            await require_ai_client(db_session, test_user, "text")

    async def test_platform_cap_resets_next_month(self, db_session, test_user, ai_env):
        await _set_access(
            db_session,
            test_user,
            ai_access="platform",
            monthly_request_cap=2,
            usage_month="2000-01",
            requests_this_month=99,
        )
        assert await require_ai_client(db_session, test_user, "text") is not None

    async def test_byok_uses_decrypted_user_config(self, db_session, test_user, ai_env):
        await _set_access(
            db_session,
            test_user,
            ai_access="byok",
            byok_provider="deepseek",
            byok_base_url="https://api.deepseek.com",
            byok_api_key_ct=crypto.encrypt_token("sk-user-own-key-1234"),
            byok_api_key_last4="1234",
            byok_text_model="deepseek-flash",
        )
        service = await require_ai_client(db_session, test_user, "text")
        assert service.base_url == "https://api.deepseek.com"
        assert service.api_key == "sk-user-own-key-1234"
        assert service.text_model == "deepseek-flash"
        assert service.config.follow_redirects is False
        assert "sk-user" not in repr(service.config)
        # No vision model configured -> vision unavailable, text fine.
        access = await get_ai_access(db_session, test_user)
        assert access.supports("text") and not access.supports("vision")

    async def test_byok_rechecks_host_at_call_time(
        self, db_session, test_user, ai_env, monkeypatch
    ):
        await _set_access(
            db_session,
            test_user,
            ai_access="byok",
            byok_base_url="https://rebind.example.test",
            byok_api_key_ct=crypto.encrypt_token("sk-xxxxxxxxxxxx"),
            byok_text_model="m",
        )

        async def _private(host, port):
            return ["192.168.1.20"]

        monkeypatch.setattr(ai_access, "_resolve_host", _private)
        with pytest.raises(ai_access.AIProviderBlockedError):
            await require_ai_client(db_session, test_user, "text")

    async def test_byok_key_unreadable_after_rotation(self, db_session, test_user, ai_env):
        await _set_access(
            db_session,
            test_user,
            ai_access="byok",
            byok_base_url="https://api.deepseek.com",
            byok_api_key_ct=Fernet(Fernet.generate_key()).encrypt(b"sk-other-key"),
            byok_text_model="m",
        )
        with pytest.raises(ai_access.AIKeyUnreadableError):
            await require_ai_client(db_session, test_user, "text")

    async def test_admin_is_platform_without_row(self, db_session, test_user, ai_env, monkeypatch):
        _make_admin(monkeypatch, test_user)
        access = await get_ai_access(db_session, test_user)
        assert access.is_admin
        assert access.effective_access == "platform"
        assert access.supports("vision") and access.supports("text")

    async def test_admin_ignores_cap(self, db_session, test_user, ai_env, monkeypatch):
        _make_admin(monkeypatch, test_user)
        await _set_access(
            db_session,
            test_user,
            ai_access="none",
            monthly_request_cap=0,
            usage_month=current_usage_month(),
            requests_this_month=5,
        )
        assert await require_ai_client(db_session, test_user, "text") is not None

    async def test_family_admin_role_is_not_site_admin(self, db_session, ai_env):
        user = await _make_user(db_session, role="admin")
        access = await get_ai_access(db_session, user)
        assert not access.is_admin
        assert access.effective_access == "none"

    async def test_kill_switch_still_wins(self, db_session, test_user, ai_env, monkeypatch):
        from app.services.ai_service import AIDisabledError

        await _set_access(db_session, test_user, ai_access="platform")
        monkeypatch.setattr(get_settings(), "ai_text_enabled", False)
        with pytest.raises(AIDisabledError) as exc:
            await require_ai_client(db_session, test_user, "text")
        assert not isinstance(exc.value, ai_access.AIAccessError)


# --- Usage accounting & response handling ---------------------------------------------


class TestUsageAndResponses:
    async def test_usage_recorded_from_response(self, db_session, test_user, ai_env, monkeypatch):
        await _set_access(db_session, test_user, ai_access="platform")
        _patch_post(
            monkeypatch,
            lambda url, headers, body: (200, _completion("hola", usage={"total_tokens": 42})),
        )
        service = await require_ai_client(db_session, test_user, "text")
        assert await service.generate_text("hi") == "hola"
        assert await service.generate_text("hi") == "hola"

        row = await ai_access.load_ai_settings(db_session, test_user.id)
        assert row.usage_month == current_usage_month()
        assert row.requests_this_month == 2
        assert row.tokens_this_month == 84
        assert row.last_used_at is not None

    async def test_usage_sink_creates_row_and_resets_month(self, db_session, test_user, ai_env):
        await _set_access(
            db_session, test_user, usage_month="2000-01", requests_this_month=7, tokens_this_month=9
        )
        sink = make_usage_sink(db_session, test_user.id)
        await sink(1, 10)
        row = await ai_access.load_ai_settings(db_session, test_user.id)
        assert (row.requests_this_month, row.tokens_this_month) == (1, 10)

        other = await _make_user(db_session)
        await make_usage_sink(db_session, other.id)(1, 3)
        row2 = await ai_access.load_ai_settings(db_session, other.id)
        assert row2.ai_access == "none" and row2.requests_this_month == 1

    async def test_truncated_reasoning_output_is_clear_error(self, ai_env, monkeypatch):
        _patch_post(
            monkeypatch,
            lambda url, headers, body: (200, _completion(None, finish_reason="length")),
        )
        service = AIService(config=AIProviderConfig(base_url="https://x.test", text_model="m"))
        with pytest.raises(AIResponseError) as exc:
            await service.generate_text("hi")
        assert exc.value.reason == "truncated"
        assert "finish_reason=length" in str(exc.value)

    async def test_empty_content_is_clear_error_in_vision(self, ai_env, monkeypatch, tmp_path):
        calls = {"n": 0}

        def _handler(url, headers, body):
            calls["n"] += 1
            return 200, _completion("", finish_reason="stop")

        _patch_post(monkeypatch, _handler)
        img = tmp_path / "a.jpg"
        Image.new("RGB", (10, 10)).save(img)
        service = AIService(config=AIProviderConfig(base_url="https://x.test", vision_model="v"))
        with pytest.raises(AIResponseError):
            await service.analyze_image(img)
        assert calls["n"] == 2  # no retries on a deterministic empty answer

    async def test_byok_key_sent_only_to_byok_host(self, ai_env, monkeypatch):
        seen = {}

        def _handler(url, headers, body):
            seen["url"] = url
            seen["auth"] = headers.get("Authorization")
            return 200, _completion("ok")

        _patch_post(monkeypatch, _handler)
        service = AIService(
            config=AIProviderConfig(
                base_url="https://api.deepseek.com/", api_key="sk-mine", text_model="m"
            )
        )
        await service.generate_text("hi")
        assert seen["url"] == "https://api.deepseek.com/chat/completions"
        assert seen["auth"] == "Bearer sk-mine"


# --- SSRF validation -------------------------------------------------------------------


class TestProviderURLValidation:
    @pytest.mark.parametrize(
        "url,reason",
        [
            ("http://api.openai.com/v1", "https_required"),
            ("ftp://api.openai.com", "https_required"),
            ("https://localhost/v1", "private_address"),
            ("https://127.0.0.1/v1", "private_address"),
            ("https://10.0.0.5/v1", "private_address"),
            ("https://192.168.1.1", "private_address"),
            ("https://169.254.169.254/latest", "private_address"),
            ("https://[::1]/v1", "private_address"),
            ("https://[::ffff:127.0.0.1]/v1", "private_address"),
            ("https://100.64.0.1/v1", "private_address"),
            ("https://printer.local/v1", "private_address"),
            ("https://user:pw@api.openai.com/v1", "invalid_url"),
            ("https://api.openai.com/v1?x=1", "invalid_url"),
            ("https:///v1", "invalid_url"),
        ],
    )
    def test_rejected_syntactically(self, url, reason):
        with pytest.raises(ProviderURLError) as exc:
            normalize_provider_url(url)
        assert exc.value.reason == reason

    def test_normalizes_trailing_slash(self):
        assert normalize_provider_url("https://api.openai.com/v1/")[0] == (
            "https://api.openai.com/v1"
        )

    async def test_rejects_hostname_resolving_to_private_ip(self, monkeypatch):
        async def _resolve(host, port):
            return [PUBLIC_IP, "10.1.2.3"]

        monkeypatch.setattr(ai_access, "_resolve_host", _resolve)
        with pytest.raises(ProviderURLError) as exc:
            await validate_provider_url("https://evil.example.test/v1")
        assert exc.value.reason == "private_address"

    async def test_rejects_unresolvable(self, monkeypatch):
        async def _resolve(host, port):
            raise OSError("nxdomain")

        monkeypatch.setattr(ai_access, "_resolve_host", _resolve)
        with pytest.raises(ProviderURLError) as exc:
            await validate_provider_url("https://nope.example.test/v1")
        assert exc.value.reason == "unresolvable"

    async def test_accepts_public_host(self, monkeypatch):
        async def _resolve(host, port):
            return [PUBLIC_IP, "2606:4700::6810:1"]

        monkeypatch.setattr(ai_access, "_resolve_host", _resolve)
        assert await validate_provider_url("https://api.deepseek.com") == (
            "https://api.deepseek.com"
        )


# --- /users/me/ai ---------------------------------------------------------------------------

BYOK_BODY = {
    "provider": "deepseek",
    "base_url": "https://api.deepseek.com",
    "api_key": "sk-test-secret-abcd",
    "vision_model": "deepseek-flash",
    "text_model": "deepseek-flash",
}


class TestMeAIEndpoints:
    async def test_get_default_none(self, client: AsyncClient, auth_headers, ai_env):
        resp = await client.get("/api/v1/users/me/ai", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["access"] == "none"
        assert data["is_admin"] is False
        assert data["byok"] is None
        assert data["capabilities"] == {"vision": False, "text": False}
        assert data["usage"]["requests"] == 0

    async def test_put_get_delete_roundtrip(
        self, client: AsyncClient, auth_headers, db_session, test_user, ai_env
    ):
        resp = await client.put("/api/v1/users/me/ai", json=BYOK_BODY, headers=auth_headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["access"] == "byok"
        assert data["byok"]["key_last4"] == "abcd"
        assert data["byok"]["provider"] == "deepseek"
        assert data["capabilities"] == {"vision": True, "text": True}
        assert "sk-test-secret" not in resp.text

        row = await ai_access.load_ai_settings(db_session, test_user.id)
        assert row.byok_api_key_ct and b"sk-test-secret" not in row.byok_api_key_ct
        assert crypto.decrypt_token(row.byok_api_key_ct) == "sk-test-secret-abcd"

        resp = await client.get("/api/v1/users/me/ai", headers=auth_headers)
        assert "sk-test-secret" not in resp.text
        assert resp.json()["byok"]["key_last4"] == "abcd"

        # Editing models without re-sending the key keeps the key.
        body = {**BYOK_BODY, "api_key": None, "vision_model": ""}
        resp = await client.put("/api/v1/users/me/ai", json=body, headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["byok"]["key_last4"] == "abcd"
        assert resp.json()["capabilities"] == {"vision": False, "text": True}

        resp = await client.delete("/api/v1/users/me/ai", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["access"] == "none"
        assert resp.json()["byok"] is None
        row = await ai_access.load_ai_settings(db_session, test_user.id)
        assert row.byok_api_key_ct is None

    async def test_put_rejects_http_and_private(self, client: AsyncClient, auth_headers, ai_env):
        resp = await client.put(
            "/api/v1/users/me/ai",
            json={**BYOK_BODY, "base_url": "http://api.deepseek.com"},
            headers=auth_headers,
        )
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "ai_url_https_required"

        resp = await client.put(
            "/api/v1/users/me/ai",
            json={**BYOK_BODY, "base_url": "https://192.168.1.10/v1"},
            headers=auth_headers,
        )
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "ai_url_private_address"

    async def test_put_requires_key_first_time(self, client: AsyncClient, auth_headers, ai_env):
        resp = await client.put(
            "/api/v1/users/me/ai", json={**BYOK_BODY, "api_key": None}, headers=auth_headers
        )
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "ai_key_required"

    async def test_put_without_encryption_key(
        self, client: AsyncClient, auth_headers, ai_env, monkeypatch
    ):
        monkeypatch.setattr(get_settings(), "integrations_token_encryption_key", None)
        monkeypatch.setattr(get_settings(), "pinterest_token_encryption_key", None)
        crypto._fernet.cache_clear()
        resp = await client.put("/api/v1/users/me/ai", json=BYOK_BODY, headers=auth_headers)
        assert resp.status_code == 503
        assert resp.json()["detail"]["code"] == "ai_encryption_unavailable"

    async def test_connection_test_ok(self, client: AsyncClient, auth_headers, ai_env, monkeypatch):
        bodies = []

        def _handler(url, headers, body):
            bodies.append(body)
            assert headers["Authorization"] == "Bearer sk-test-secret-abcd"
            return 200, _completion("OK", usage={"total_tokens": 5})

        _patch_post(monkeypatch, _handler)
        resp = await client.post("/api/v1/users/me/ai/test", json=BYOK_BODY, headers=auth_headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["ok"] is True
        assert data["text"]["ok"] and data["vision"]["ok"]
        # The vision probe really sends an image.
        vision_msg = bodies[1]["messages"][0]["content"]
        assert any(part.get("type") == "image_url" for part in vision_msg)

    async def test_connection_test_uses_saved_key(
        self, client: AsyncClient, auth_headers, ai_env, monkeypatch
    ):
        await client.put("/api/v1/users/me/ai", json=BYOK_BODY, headers=auth_headers)
        seen = []

        def _handler(url, headers, body):
            seen.append(headers["Authorization"])
            return 200, _completion("OK")

        _patch_post(monkeypatch, _handler)
        resp = await client.post("/api/v1/users/me/ai/test", headers=auth_headers)
        assert resp.json()["ok"] is True
        assert seen and all(a == "Bearer sk-test-secret-abcd" for a in seen)

    async def test_connection_test_reports_bad_key(
        self, client: AsyncClient, auth_headers, ai_env, monkeypatch
    ):
        _patch_post(monkeypatch, lambda url, headers, body: (401, {"error": "bad key"}))
        resp = await client.post(
            "/api/v1/users/me/ai/test",
            json={**BYOK_BODY, "vision_model": ""},
            headers=auth_headers,
        )
        data = resp.json()
        assert data["ok"] is False
        assert data["text"]["error_code"] == "ai_test_auth"
        assert data["vision"] is None
        assert "sk-test" not in resp.text

    async def test_connection_test_blocks_private_url(
        self, client: AsyncClient, auth_headers, ai_env
    ):
        resp = await client.post(
            "/api/v1/users/me/ai/test",
            json={**BYOK_BODY, "base_url": "https://10.0.0.1/v1"},
            headers=auth_headers,
        )
        assert resp.json()["ok"] is False
        assert resp.json()["error_code"] == "ai_url_private_address"


# --- Admin ------------------------------------------------------------------------------------


class TestAdminEndpoints:
    async def test_non_admin_forbidden(self, client: AsyncClient, auth_headers, ai_env):
        resp = await client.get("/api/v1/admin/users", headers=auth_headers)
        assert resp.status_code == 403
        resp = await client.patch(
            f"/api/v1/admin/users/{uuid4()}", json={"ai_access": "platform"}, headers=auth_headers
        )
        assert resp.status_code == 403

    async def test_family_admin_role_forbidden(self, client: AsyncClient, db_session, ai_env):
        fam_admin = await _make_user(db_session, role="admin")
        headers = {"Authorization": f"Bearer {create_access_token(fam_admin.external_id)}"}
        resp = await client.get("/api/v1/admin/users", headers=headers)
        assert resp.status_code == 403

    async def test_list_and_grant(
        self, client: AsyncClient, auth_headers, db_session, test_user, ai_env, monkeypatch
    ):
        _make_admin(monkeypatch, test_user)
        uname = f"otra{uuid4().hex[:10]}"
        other = await _make_user(db_session, username=uname)
        db_session.add(ClothingItem(user_id=other.id, type="shirt", image_path="x/1.jpg"))
        db_session.add(ClothingItem(user_id=other.id, type="pants", image_path="x/2.jpg"))
        await db_session.commit()

        resp = await client.get(
            "/api/v1/admin/users", params={"search": uname}, headers=auth_headers
        )
        assert resp.status_code == 200, resp.text
        users = resp.json()["users"]
        assert len(users) == 1
        assert users[0]["item_count"] == 2
        assert users[0]["ai_access"] == "none"
        assert users[0]["username"] == uname

        resp = await client.patch(
            f"/api/v1/admin/users/{other.id}",
            json={"ai_access": "platform", "monthly_request_cap": 50},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["ai_access"] == "platform"
        assert resp.json()["monthly_request_cap"] == 50
        access = await get_ai_access(db_session, other)
        assert access.effective_access == "platform"

        # Clearing the cap with explicit null.
        resp = await client.patch(
            f"/api/v1/admin/users/{other.id}",
            json={"monthly_request_cap": None},
            headers=auth_headers,
        )
        assert resp.json()["monthly_request_cap"] is None
        assert resp.json()["ai_access"] == "platform"

        resp = await client.patch(
            f"/api/v1/admin/users/{other.id}", json={"ai_access": "none"}, headers=auth_headers
        )
        assert resp.json()["ai_access"] == "none"

        me = next(
            u
            for u in (await client.get("/api/v1/admin/users", headers=auth_headers)).json()["users"]
            if u["id"] == str(test_user.id)
        )
        assert me["is_admin"] and me["effective_ai_access"] == "platform"

    async def test_admin_cannot_deactivate_self(
        self, client: AsyncClient, auth_headers, test_user, ai_env, monkeypatch
    ):
        _make_admin(monkeypatch, test_user)
        resp = await client.patch(
            f"/api/v1/admin/users/{test_user.id}", json={"is_active": False}, headers=auth_headers
        )
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "cannot_deactivate_admin"

    async def test_admin_can_deactivate_member(
        self, client: AsyncClient, auth_headers, db_session, test_user, ai_env, monkeypatch
    ):
        _make_admin(monkeypatch, test_user)
        other = await _make_user(db_session)
        resp = await client.patch(
            f"/api/v1/admin/users/{other.id}", json={"is_active": False}, headers=auth_headers
        )
        assert resp.status_code == 200
        assert resp.json()["is_active"] is False

    async def test_cannot_revoke_own_key_user(
        self, client: AsyncClient, auth_headers, db_session, test_user, ai_env, monkeypatch
    ):
        _make_admin(monkeypatch, test_user)
        other = await _make_user(db_session)
        await _set_access(db_session, other, ai_access="byok")
        resp = await client.patch(
            f"/api/v1/admin/users/{other.id}", json={"ai_access": "none"}, headers=auth_headers
        )
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "user_uses_own_key"


# --- Users without AI keep working ------------------------------------------------------------


def _jpeg() -> bytes:
    buf = BytesIO()
    Image.new("RGB", (40, 40), (10, 120, 200)).save(buf, format="JPEG")
    return buf.getvalue()


class TestNoAIUser:
    async def test_upload_works_without_ai(
        self, client: AsyncClient, auth_headers, db_session, ai_env
    ):
        with patch("app.api.items.create_pool", new_callable=AsyncMock) as mock_create_pool:
            response = await client.post(
                "/api/v1/items",
                files={"image": ("shirt.jpg", _jpeg(), "image/jpeg")},
                headers=auth_headers,
            )
        assert response.status_code == 201, response.text
        data = response.json()
        assert data["status"] == "ready"
        assert data["tagging_status"] == "pending"
        mock_create_pool.assert_not_called()

    async def test_bulk_upload_works_without_ai(
        self, client: AsyncClient, auth_headers, db_session, ai_env
    ):
        with patch("app.api.items.create_pool", new_callable=AsyncMock) as mock_create_pool:
            response = await client.post(
                "/api/v1/items/bulk",
                files=[("images", ("a.jpg", _jpeg(), "image/jpeg"))],
                headers=auth_headers,
            )
        assert response.status_code == 201, response.text
        assert response.json()["successful"] == 1
        mock_create_pool.assert_not_called()

    async def test_analyze_is_deferred(
        self, client: AsyncClient, auth_headers, db_session, test_user, ai_env
    ):
        item = ClothingItem(user_id=test_user.id, type="shirt", image_path="x/a.jpg")
        db_session.add(item)
        await db_session.commit()
        resp = await client.post(f"/api/v1/items/{item.id}/analyze", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == {"status": "deferred", "reason": "ai_not_enabled"}

    async def test_suggest_returns_ai_not_enabled(self, client: AsyncClient, auth_headers, ai_env):
        resp = await client.post(
            "/api/v1/outfits/suggest", json={"occasion": "casual"}, headers=auth_headers
        )
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "ai_not_enabled"

    async def test_pairings_returns_ai_not_enabled(self, client: AsyncClient, auth_headers, ai_env):
        resp = await client.post(
            f"/api/v1/pairings/generate/{uuid4()}",
            json={"num_pairings": 3},
            headers=auth_headers,
        )
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "ai_not_enabled"

    async def test_quota_exceeded_code(
        self, client: AsyncClient, auth_headers, db_session, test_user, ai_env
    ):
        await _set_access(
            db_session,
            test_user,
            ai_access="platform",
            monthly_request_cap=1,
            usage_month=current_usage_month(),
            requests_this_month=1,
        )
        resp = await client.post(
            "/api/v1/outfits/suggest", json={"occasion": "casual"}, headers=auth_headers
        )
        assert resp.status_code == 429
        assert resp.json()["detail"]["code"] == "ai_quota_exceeded"

    async def test_worker_skips_tagging_for_no_ai_user(self, db_session, test_user, ai_env):
        from app.workers import tagging

        item = ClothingItem(
            user_id=test_user.id,
            type="unknown",
            image_path="x/w.jpg",
            status=ItemStatus.processing,
        )
        db_session.add(item)
        await db_session.commit()

        def _boom(*a, **k):
            raise AssertionError("AIService built for a user without AI")

        with (
            patch.object(tagging, "AIService", _boom),
            patch("app.workers.tagging.get_db_session", return_value=db_session),
            patch.object(db_session, "close", new_callable=AsyncMock),
        ):
            result = await tagging.tag_item_image({}, str(item.id), __file__)

        assert result["status"] == "skipped"
        assert result["reason"] == "ai_not_enabled"
        refreshed = (
            await db_session.execute(
                select(ClothingItem)
                .where(ClothingItem.id == item.id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert refreshed.status == ItemStatus.ready
        assert refreshed.tagging_status == TaggingStatus.pending

    async def test_scheduled_notification_skips_no_ai_user(self, db_session, test_user, ai_env):
        from app.services.recommendation_service import RecommendationService

        with pytest.raises(AINotEnabledError):
            await RecommendationService(db_session).generate_recommendation(
                user=test_user, occasion="casual"
            )
