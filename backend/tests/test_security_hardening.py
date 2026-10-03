"""Fixes from the October 2026 security review: token revocation, outbound URLs, input limits."""

import uuid

import pytest
from httpx import AsyncClient
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import create_access_token
from app.models import User
from app.models.item import ClothingItem
from app.schemas.notification import MattermostConfig, NtfyConfig
from app.services.notification_providers import (
    BLOCKED_MESSAGE,
    MattermostMessage,
    MattermostProvider,
    NtfyNotification,
    NtfyProvider,
)
from app.utils.outbound import OutboundBlocked, guarded_post


def _bearer(user: User) -> dict[str, str]:
    token = create_access_token(user.external_id, token_version=user.token_version)
    return {"Authorization": f"Bearer {token}"}


class TestTokenRevocation:
    async def test_tokens_from_before_the_column_still_work(
        self, client: AsyncClient, auth_headers
    ):
        # auth_headers carries tv=0, the starting version of every account.
        resp = await client.get("/api/v1/users/me", headers=auth_headers)
        assert resp.status_code == 200

    async def test_logout_everywhere_revokes_every_token(
        self, client: AsyncClient, test_user: User
    ):
        headers = _bearer(test_user)
        resp = await client.post("/api/v1/auth/logout-everywhere", headers=headers)
        assert resp.status_code == 204
        resp = await client.get("/api/v1/users/me", headers=headers)
        assert resp.status_code == 401
        # And a refresh can't bring it back.
        resp = await client.post("/api/v1/auth/refresh", headers=headers)
        assert resp.status_code == 401

    async def test_password_change_signs_other_devices_out_but_not_this_one(
        self, client: AsyncClient, test_user: User
    ):
        old = _bearer(test_user)
        first = "gato esmoquin con botas 42"
        resp = await client.put(
            "/api/v1/users/me/password", headers=old, json={"new_password": first}
        )
        # Adding a first password signs nobody out.
        assert resp.status_code == 200, resp.text
        assert resp.json()["access_token"] is None
        assert (await client.get("/api/v1/users/me", headers=old)).status_code == 200

        resp = await client.put(
            "/api/v1/users/me/password",
            headers=old,
            json={"current_password": first, "new_password": "naranja atigrado se llama chan"},
        )
        assert resp.status_code == 200, resp.text
        fresh = resp.json()["access_token"]
        assert fresh
        assert (await client.get("/api/v1/users/me", headers=old)).status_code == 401
        resp = await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {fresh}"})
        assert resp.status_code == 200


class TestOutboundUrls:
    def test_ntfy_needs_https(self):
        with pytest.raises(ValidationError):
            NtfyConfig(server="http://wardrobe_redis:6379", topic="miau-topic")
        assert NtfyConfig(server="https://ntfy.sh/", topic="miau-topic").server == "https://ntfy.sh"

    @pytest.mark.parametrize(
        "url",
        [
            "https://127.0.0.1/x",
            "https://10.0.0.5/hooks/abc",
            "https://192.168.1.1/hooks/abc",
            "https://169.254.169.254/latest",
            "https://localhost/hooks/x",
            "http://example.com/hooks/x",
        ],
    )
    async def test_private_targets_are_refused(self, url: str):
        with pytest.raises(OutboundBlocked):
            await guarded_post(url, json={})

    async def test_providers_never_echo_the_target(self):
        ntfy = NtfyProvider(NtfyConfig(server="https://127.0.0.1", topic="miau-topic"))
        result = await ntfy.send(NtfyNotification(topic="miau-topic", title="t", message="m"))
        assert result == {"success": False, "error": BLOCKED_MESSAGE}

        mm = MattermostProvider(MattermostConfig(webhook_url="https://10.1.2.3/hooks/abc"))
        result = await mm.send(MattermostMessage(text="hola"))
        assert result == {"success": False, "error": BLOCKED_MESSAGE}


class TestInputLimits:
    async def test_display_name_is_capped(self, client: AsyncClient, auth_headers):
        resp = await client.patch(
            "/api/v1/users/me", headers=auth_headers, json={"display_name": "x" * 3000}
        )
        assert resp.status_code == 422

    async def test_cannot_exclude_someone_elses_item(
        self, client: AsyncClient, auth_headers, db_session: AsyncSession
    ):
        other_id = uuid.uuid4()
        other = User(
            id=other_id,
            external_id=f"other-{other_id}",
            email=f"other-{other_id}@example.com",
            display_name="Other",
            timezone="UTC",
            is_active=True,
        )
        db_session.add(other)
        await db_session.flush()
        item = ClothingItem(user_id=other.id, type="shirt", image_path=f"{other.id}/x.jpg")
        db_session.add(item)
        await db_session.commit()

        resp = await client.post(
            f"/api/v1/users/me/preferences/excluded-items/{item.id}", headers=auth_headers
        )
        assert resp.status_code == 404
