"""Tests for the Pinterest integration API and the Alembic chain it extends."""

import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from cryptography.fernet import Fernet
from httpx import AsyncClient
from sqlalchemy import select

from app.config import get_settings
from app.integrations import crypto
from app.integrations.crypto import decrypt_token
from app.integrations.pinterest import build_authorize_url, create_state
from app.models.pinterest import PinterestConnection

_RealAsyncClient = httpx.AsyncClient
BACKEND_DIR = Path(__file__).resolve().parent.parent


@pytest.fixture
def pinterest_settings(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "pinterest_client_id", "pid")
    monkeypatch.setattr(settings, "pinterest_client_secret", "psecret")
    monkeypatch.setattr(
        settings, "integrations_token_encryption_key", Fernet.generate_key().decode()
    )
    crypto._fernet.cache_clear()
    yield settings
    crypto._fernet.cache_clear()


def _json(data, status: int = 200) -> httpx.Response:
    return httpx.Response(
        status, content=json.dumps(data).encode(), headers={"content-type": "application/json"}
    )


def test_alembic_single_head_chain():
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["notif2609"]
    assert script.get_revision("notif2609").down_revision == "waitlist2609"
    assert script.get_revision("waitlist2609").down_revision == "admpanel2609"
    assert script.get_revision("admpanel2609").down_revision == "social2609"
    assert script.get_revision("social2609").down_revision == "stinkychat2609"
    assert script.get_revision("stinkychat2609").down_revision == "music2609"
    assert script.get_revision("music2609").down_revision == "usrpwd2609"
    assert script.get_revision("usrpwd2609").down_revision == "a1accessbyok2609"
    assert script.get_revision("a1accessbyok2609").down_revision == "sp0t1fyintg2609"
    assert script.get_revision("sp0t1fyintg2609").down_revision == "p1n15intg2601"
    assert script.get_revision("p1n15intg2601").down_revision == "sprint2_magic_link_tokens"


def test_authorize_url(pinterest_settings):
    qs = parse_qs(urlparse(build_authorize_url("s")).query)
    assert qs["client_id"] == ["pid"]
    assert qs["scope"] == ["boards:read,pins:read"]
    assert qs["state"] == ["s"]


class TestPinterestAPI:
    async def test_status_not_connected(
        self, client: AsyncClient, auth_headers, pinterest_settings
    ):
        resp = await client.get("/api/v1/integrations/pinterest/status", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == {
            "configured": True,
            "connected": False,
            "pinterest_user_id": None,
            "connected_at": None,
            "scopes": None,
            "pin_count": 0,
        }

    async def test_connect_unconfigured(self, client: AsyncClient, auth_headers, monkeypatch):
        monkeypatch.setattr(get_settings(), "pinterest_client_id", None)
        resp = await client.get("/api/v1/integrations/pinterest/connect", headers=auth_headers)
        assert resp.status_code == 503

    async def test_boards_not_connected(self, client: AsyncClient, auth_headers):
        resp = await client.get("/api/v1/integrations/pinterest/boards", headers=auth_headers)
        assert resp.status_code == 404

    async def test_callback_invalid_state(self, client: AsyncClient, pinterest_settings):
        resp = await client.get(
            "/api/v1/integrations/pinterest/callback",
            params={"code": "c", "state": "nope"},
            headers={"Host": "miaurmario.home"},
        )
        assert resp.status_code == 302
        assert "miaurmario.home" not in resp.headers["location"]
        assert resp.headers["location"].endswith(
            "/dashboard/settings/integrations/pinterest?error=invalid_state"
        )

    async def test_callback_denied_without_code(
        self, client: AsyncClient, pinterest_settings, test_user
    ):
        state = await create_state(str(test_user.id))
        resp = await client.get(
            "/api/v1/integrations/pinterest/callback",
            params={"state": state, "error": "access_denied"},
        )
        assert resp.status_code == 302
        assert "error=access_denied" in resp.headers["location"]

    async def test_callback_success(
        self, client: AsyncClient, db_session, pinterest_settings, test_user, monkeypatch
    ):
        def handler(req: httpx.Request) -> httpx.Response:
            if req.url.path == "/v5/oauth/token":
                return _json(
                    {
                        "access_token": "pacc",
                        "refresh_token": "pref",
                        "expires_in": 2592000,
                        "scope": "boards:read,pins:read",
                    }
                )
            if req.url.path == "/v5/user_account":
                return _json({"username": "pinner", "id": "42"})
            return httpx.Response(404)

        def factory(*args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(handler)
            return _RealAsyncClient(*args, **kwargs)

        state = await create_state(str(test_user.id))
        monkeypatch.setattr(httpx, "AsyncClient", factory)
        resp = await client.get(
            "/api/v1/integrations/pinterest/callback", params={"code": "c", "state": state}
        )
        assert resp.status_code == 302
        assert resp.headers["location"].endswith("?connected=1")
        row = (
            await db_session.execute(
                select(PinterestConnection).where(PinterestConnection.user_id == test_user.id)
            )
        ).scalar_one()
        assert row.pinterest_user_id == "42"
        assert decrypt_token(row.access_token_ct) == "pacc"
        assert decrypt_token(row.refresh_token_ct) == "pref"

    async def test_disconnect_is_idempotent(self, client: AsyncClient, auth_headers):
        resp = await client.delete("/api/v1/integrations/pinterest", headers=auth_headers)
        assert resp.status_code == 204

    async def test_pins_empty(self, client: AsyncClient, auth_headers):
        resp = await client.get("/api/v1/pins", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["items"] == []
