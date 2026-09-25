"""Tests for the Spotify integration (OAuth, token refresh, mood signal, API)."""

import json
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from cryptography.fernet import Fernet
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.integrations import crypto
from app.integrations.crypto import decrypt_token, encrypt_token
from app.integrations.spotify import (
    SpotifyClient,
    build_authorize_url,
    create_state,
    exchange_code,
)
from app.models.spotify import SpotifyConnection
from app.models.user import User
from app.services import music_service, spotify_mood

_RealAsyncClient = httpx.AsyncClient

Handler = Callable[[httpx.Request], httpx.Response]


@pytest.fixture
def spotify_settings(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "spotify_client_id", "cid")
    monkeypatch.setattr(settings, "spotify_client_secret", "csecret")
    monkeypatch.setattr(
        settings,
        "spotify_redirect_uri",
        "https://miaurmario.example/api/v1/integrations/spotify/callback",
    )
    monkeypatch.setattr(
        settings, "integrations_token_encryption_key", Fernet.generate_key().decode()
    )
    monkeypatch.setattr(settings, "lastfm_api_key", None)
    crypto._fernet.cache_clear()
    yield settings
    crypto._fernet.cache_clear()


@pytest.fixture
def no_cache(monkeypatch):
    """Keep the Redis-backed music caches out of unit tests."""

    async def _get(key):
        return None

    async def _set(*args, **kwargs):
        return None

    monkeypatch.setattr(spotify_mood, "_cache_get", _get)
    monkeypatch.setattr(spotify_mood, "_cache_set", _set)
    monkeypatch.setattr(spotify_mood, "_cache_set_ttl", _set)


@pytest.fixture
def mock_http(monkeypatch):
    """Route every httpx.AsyncClient created by app code through a handler."""
    calls: list[httpx.Request] = []
    state: dict[str, Handler] = {}

    def install(handler: Handler) -> list[httpx.Request]:
        state["handler"] = handler

        def _transport_handler(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            return state["handler"](request)

        def factory(*args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(_transport_handler)
            return _RealAsyncClient(*args, **kwargs)

        monkeypatch.setattr(httpx, "AsyncClient", factory)
        return calls

    return install


def _json(data, status: int = 200) -> httpx.Response:
    return httpx.Response(
        status, content=json.dumps(data).encode(), headers={"content-type": "application/json"}
    )


def _connection(user_id, *, expires_in: int = 3600, use_for_mood: bool = True) -> SpotifyConnection:
    return SpotifyConnection(
        user_id=user_id,
        spotify_user_id="spotty",
        display_name="Spotty",
        access_token_ct=encrypt_token("old-access"),
        refresh_token_ct=encrypt_token("old-refresh"),
        access_token_expires_at=datetime.now(UTC) + timedelta(seconds=expires_in),
        scopes="user-read-recently-played",
        use_for_mood=use_for_mood,
    )


TRACK = {
    "name": "Pink + White",
    "artists": [{"id": "artist1", "name": "Frank Ocean"}],
    "album": {"name": "Blonde", "release_date": "2016-08-20"},
}


class TestSpotifyOAuth:
    def test_authorize_url(self, spotify_settings):
        url = build_authorize_url("st4te")
        parsed = urlparse(url)
        assert parsed.netloc == "accounts.spotify.com"
        qs = parse_qs(parsed.query)
        assert qs["client_id"] == ["cid"]
        assert qs["state"] == ["st4te"]
        assert qs["response_type"] == ["code"]
        assert qs["redirect_uri"] == [spotify_settings.spotify_redirect_uri]
        scopes = set(qs["scope"][0].split())
        assert scopes == {
            "user-read-recently-played",
            "user-read-currently-playing",
            "user-top-read",
        }

    async def test_exchange_code_uses_basic_auth(self, spotify_settings, mock_http):
        calls = mock_http(
            lambda req: _json(
                {"access_token": "a", "refresh_token": "r", "expires_in": 3600, "scope": "x"}
            )
        )
        tokens = await exchange_code("the-code")
        assert tokens["access_token"] == "a"
        assert tokens["access_token_expires_at"] > datetime.now(UTC) + timedelta(minutes=59)
        req = calls[0]
        assert str(req.url) == "https://accounts.spotify.com/api/token"
        assert req.headers["authorization"].startswith("Basic ")
        form = parse_qs(req.content.decode())
        assert form["grant_type"] == ["authorization_code"]
        assert form["code"] == ["the-code"]
        assert form["redirect_uri"] == [spotify_settings.spotify_redirect_uri]


class TestSpotifyClient:
    async def test_fresh_token_used_without_refresh(self, spotify_settings, mock_http, test_user):
        calls = mock_http(lambda req: _json({"id": "me"}))
        conn = _connection(test_user.id)
        await SpotifyClient(conn, None).get_me()
        assert len(calls) == 1
        assert calls[0].headers["authorization"] == "Bearer old-access"

    async def test_refresh_persists_rotated_refresh_token(
        self, spotify_settings, mock_http, test_user
    ):
        def handler(req: httpx.Request) -> httpx.Response:
            if req.url.host == "accounts.spotify.com":
                form = parse_qs(req.content.decode())
                assert form["grant_type"] == ["refresh_token"]
                assert form["refresh_token"] == ["old-refresh"]
                return _json(
                    {
                        "access_token": "new-access",
                        "refresh_token": "new-refresh",
                        "expires_in": 3600,
                    }
                )
            assert req.headers["authorization"] == "Bearer new-access"
            return _json({"id": "me"})

        mock_http(handler)
        conn = _connection(test_user.id, expires_in=30)  # inside the refresh window
        await SpotifyClient(conn, None).get_me()
        assert decrypt_token(conn.access_token_ct) == "new-access"
        assert decrypt_token(conn.refresh_token_ct) == "new-refresh"
        assert conn.access_token_expires_at > datetime.now(UTC) + timedelta(minutes=59)
        assert conn.last_refreshed_at is not None

    async def test_refresh_keeps_refresh_token_when_not_rotated(
        self, spotify_settings, mock_http, test_user
    ):
        def handler(req: httpx.Request) -> httpx.Response:
            if req.url.host == "accounts.spotify.com":
                return _json({"access_token": "new-access", "expires_in": 3600})
            return _json({"id": "me"})

        mock_http(handler)
        conn = _connection(test_user.id, expires_in=-10)
        await SpotifyClient(conn, None).get_me()
        assert decrypt_token(conn.refresh_token_ct) == "old-refresh"

    async def test_401_forces_refresh_and_retry(self, spotify_settings, mock_http, test_user):
        def handler(req: httpx.Request) -> httpx.Response:
            if req.url.host == "accounts.spotify.com":
                return _json({"access_token": "new-access", "expires_in": 3600})
            if req.headers["authorization"] == "Bearer old-access":
                return _json({"error": {"status": 401}}, status=401)
            return _json({"id": "me"})

        calls = mock_http(handler)
        conn = _connection(test_user.id)
        me = await SpotifyClient(conn, None).get_me()
        assert me == {"id": "me"}
        assert len(calls) == 3

    async def test_currently_playing_204_is_none(self, spotify_settings, mock_http, test_user):
        mock_http(lambda req: httpx.Response(204))
        assert await SpotifyClient(_connection(test_user.id), None).get_currently_playing() is None


def _listening_handler(*, playing: bool) -> Handler:
    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path == "/v1/me/player/currently-playing":
            if not playing:
                return httpx.Response(204)
            return _json({"currently_playing_type": "track", "is_playing": True, "item": TRACK})
        if path == "/v1/me/player/recently-played":
            return _json({"items": [{"track": {**TRACK, "name": "Nights"}}]})
        if path == "/v1/me/top/artists":
            return _json(
                {
                    "items": [
                        {"name": "SZA", "genres": ["r&b", "pop"]},
                        {"name": "Frank Ocean", "genres": ["alternative r&b"]},
                    ]
                }
            )
        if path == "/v1/artists/artist1":
            return _json({"id": "artist1", "genres": ["alternative r&b", "neo soul"]})
        return httpx.Response(404)

    return handler


class TestListeningMood:
    async def test_now_playing(self, spotify_settings, mock_http, no_cache, test_user):
        mock_http(_listening_handler(playing=True))
        ctx = await spotify_mood.listening_mood(None, _connection(test_user.id))
        assert ctx is not None
        assert ctx.source == "spotify"
        assert ctx.listening == "now_playing"
        assert (ctx.artist, ctx.track, ctx.album, ctx.year) == (
            "Frank Ocean",
            "Pink + White",
            "Blonde",
            "2016",
        )
        # Track artist genres first, then top-artist genres, de-duplicated.
        assert ctx.genres == ["alternative r&b", "neo soul", "r&b", "pop"]
        assert ctx.top_artists == ["SZA", "Frank Ocean"]
        prompt = music_service.format_song_context_for_prompt(ctx)
        assert "Sonando ahora (vía Spotify): Frank Ocean — Pink + White" in prompt
        assert "alternative r&b" in prompt

    async def test_falls_back_to_recently_played(
        self, spotify_settings, mock_http, no_cache, test_user
    ):
        mock_http(_listening_handler(playing=False))
        ctx = await spotify_mood.listening_mood(None, _connection(test_user.id))
        assert ctx is not None
        assert ctx.listening == "recently_played"
        assert ctx.track == "Nights"

    async def test_api_failure_returns_none(self, spotify_settings, mock_http, no_cache, test_user):
        mock_http(lambda req: _json({"error": "boom"}, status=500))
        assert await spotify_mood.listening_mood(None, _connection(test_user.id)) is None

    async def test_resolve_query_track_url(self, spotify_settings, mock_http, no_cache, test_user):
        def handler(req: httpx.Request) -> httpx.Response:
            if req.url.path == "/v1/tracks/abc123":
                return _json(TRACK)
            if req.url.path == "/v1/artists/artist1":
                return _json({"genres": ["neo soul"]})
            return httpx.Response(404)

        mock_http(handler)
        ctx = await spotify_mood.resolve_query(
            None, _connection(test_user.id), "https://open.spotify.com/track/abc123?si=x"
        )
        assert ctx is not None
        assert ctx.source == "spotify"
        assert ctx.listening is None
        assert ctx.track == "Pink + White"
        assert ctx.genres == ["neo soul"]


class TestResolveMusicContext:
    """Spotify preferred when connected; Last.fm path otherwise (unchanged)."""

    @pytest.fixture
    def fake_enrich(self, monkeypatch):
        seen: list[str] = []

        async def _enrich(query):
            seen.append(query)
            return music_service.SongContext(query=query, source="lastfm")

        monkeypatch.setattr(music_service, "enrich_song", _enrich)
        return seen

    async def test_not_connected_no_query_is_none(
        self, db_session: AsyncSession, test_user: User, fake_enrich
    ):
        assert await music_service.resolve_music_context(db_session, test_user, None) is None
        assert fake_enrich == []

    async def test_not_connected_query_uses_lastfm(
        self, db_session: AsyncSession, test_user: User, fake_enrich
    ):
        ctx = await music_service.resolve_music_context(
            db_session, test_user, "Frank Ocean - Nights"
        )
        assert ctx is not None and ctx.source == "lastfm"
        assert fake_enrich == ["Frank Ocean - Nights"]

    async def test_connected_no_query_uses_listening(
        self, db_session, test_user, spotify_settings, mock_http, no_cache, fake_enrich
    ):
        db_session.add(_connection(test_user.id))
        await db_session.commit()
        mock_http(_listening_handler(playing=True))
        ctx = await music_service.resolve_music_context(db_session, test_user, None)
        assert ctx is not None and ctx.source == "spotify"
        assert fake_enrich == []

    async def test_connected_but_mood_disabled(
        self, db_session, test_user, spotify_settings, mock_http, no_cache, fake_enrich
    ):
        db_session.add(_connection(test_user.id, use_for_mood=False))
        await db_session.commit()
        calls = mock_http(_listening_handler(playing=True))
        assert await music_service.resolve_music_context(db_session, test_user, None) is None
        assert calls == []

    async def test_connected_query_falls_back_to_lastfm_on_spotify_error(
        self, db_session, test_user, spotify_settings, mock_http, no_cache, fake_enrich
    ):
        db_session.add(_connection(test_user.id))
        await db_session.commit()
        mock_http(lambda req: _json({"error": "down"}, status=503))
        ctx = await music_service.resolve_music_context(db_session, test_user, "some song")
        assert ctx is not None and ctx.source == "lastfm"
        assert fake_enrich == ["some song"]


class TestSpotifyAPI:
    async def test_status_not_connected(self, client: AsyncClient, auth_headers, spotify_settings):
        resp = await client.get("/api/v1/integrations/spotify/status", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["configured"] is True
        assert data["connected"] is False

    async def test_connect_unconfigured_returns_503(
        self, client: AsyncClient, auth_headers, monkeypatch
    ):
        monkeypatch.setattr(get_settings(), "spotify_client_id", None)
        resp = await client.get("/api/v1/integrations/spotify/connect", headers=auth_headers)
        assert resp.status_code == 503

    async def test_connect_returns_authorize_url(
        self, client: AsyncClient, auth_headers, spotify_settings
    ):
        resp = await client.get("/api/v1/integrations/spotify/connect", headers=auth_headers)
        assert resp.status_code == 200
        qs = parse_qs(urlparse(resp.json()["authorize_url"]).query)
        assert qs["state"][0]

    async def test_callback_invalid_state_redirects_without_host(
        self, client: AsyncClient, spotify_settings
    ):
        resp = await client.get(
            "/api/v1/integrations/spotify/callback",
            params={"code": "c", "state": "bogus"},
            headers={"Host": "miaurmario.home"},
        )
        assert resp.status_code == 302
        location = resp.headers["location"]
        assert "miaurmario.home" not in location
        assert location.endswith("/dashboard/settings/integrations/spotify?error=invalid_state")

    async def test_callback_user_denied(self, client: AsyncClient, spotify_settings, test_user):
        state = await create_state(str(test_user.id))
        resp = await client.get(
            "/api/v1/integrations/spotify/callback",
            params={"error": "access_denied", "state": state},
        )
        assert resp.status_code == 302
        assert "error=access_denied" in resp.headers["location"]

    async def test_callback_success_persists_encrypted_tokens(
        self, client: AsyncClient, db_session, spotify_settings, mock_http, test_user
    ):
        def handler(req: httpx.Request) -> httpx.Response:
            if req.url.host == "accounts.spotify.com":
                return _json(
                    {
                        "access_token": "acc",
                        "refresh_token": "ref",
                        "expires_in": 3600,
                        "scope": "user-top-read user-read-recently-played",
                    }
                )
            if req.url.path == "/v1/me":
                return _json({"id": "spotty", "display_name": "Spotty"})
            return httpx.Response(404)

        state = await create_state(str(test_user.id))
        mock_http(handler)
        resp = await client.get(
            "/api/v1/integrations/spotify/callback", params={"code": "c", "state": state}
        )
        assert resp.status_code == 302
        assert resp.headers["location"].endswith(
            "/dashboard/settings/integrations/spotify?connected=1"
        )
        row = (
            await db_session.execute(
                select(SpotifyConnection).where(SpotifyConnection.user_id == test_user.id)
            )
        ).scalar_one()
        assert row.spotify_user_id == "spotty"
        assert row.display_name == "Spotty"
        assert row.use_for_mood is True
        assert b"acc" not in row.access_token_ct
        assert decrypt_token(row.access_token_ct) == "acc"
        assert decrypt_token(row.refresh_token_ct) == "ref"

        # State is single-use.
        replay = await client.get(
            "/api/v1/integrations/spotify/callback", params={"code": "c", "state": state}
        )
        assert "error=invalid_state" in replay.headers["location"]

    async def test_callback_not_allowlisted(
        self, client: AsyncClient, db_session, spotify_settings, mock_http, test_user
    ):
        def handler(req: httpx.Request) -> httpx.Response:
            if req.url.host == "accounts.spotify.com":
                return _json({"access_token": "acc", "refresh_token": "ref", "expires_in": 3600})
            return httpx.Response(403, text="User not registered in the Developer Dashboard")

        state = await create_state(str(test_user.id))
        mock_http(handler)
        resp = await client.get(
            "/api/v1/integrations/spotify/callback", params={"code": "c", "state": state}
        )
        assert "error=not_allowlisted" in resp.headers["location"]
        rows = (
            await db_session.execute(
                select(SpotifyConnection).where(SpotifyConnection.user_id == test_user.id)
            )
        ).all()
        assert rows == []

    async def test_settings_mood_and_disconnect(
        self, client: AsyncClient, auth_headers, db_session, spotify_settings, test_user
    ):
        db_session.add(_connection(test_user.id))
        await db_session.commit()

        status_resp = await client.get("/api/v1/integrations/spotify/status", headers=auth_headers)
        assert status_resp.json()["connected"] is True
        assert status_resp.json()["display_name"] == "Spotty"

        resp = await client.patch(
            "/api/v1/integrations/spotify/settings",
            json={"use_for_mood": False},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["use_for_mood"] is False

        mood = await client.get("/api/v1/integrations/spotify/mood", headers=auth_headers)
        assert mood.json()["source"] == "manual"
        assert mood.json()["reason"] == "disabled"

        resp = await client.delete("/api/v1/integrations/spotify", headers=auth_headers)
        assert resp.status_code == 204
        status_resp = await client.get("/api/v1/integrations/spotify/status", headers=auth_headers)
        assert status_resp.json()["connected"] is False

    async def test_requires_auth(self, client: AsyncClient):
        resp = await client.get("/api/v1/integrations/spotify/status")
        assert resp.status_code == 401


SEAT_URL = "/api/v1/integrations/spotify/seat-request"


class TestSeatRequest:
    """Pedir plaza de Spotify: Development Mode means a human has to allowlist the
    account, so the ask goes to ADMIN_EMAILS."""

    async def test_queues_one_admin_alert_and_leaks_nothing(
        self, client: AsyncClient, auth_headers, enqueued_spotify_seat_requests, test_user: User
    ):
        resp = await client.post(
            SEAT_URL, json={"email": " Fan@Spotify.example "}, headers=auth_headers
        )
        assert resp.status_code == 202
        assert resp.json() == {"status": "ok"}
        # No address, no admin, no queue state in the answer.
        assert "@" not in resp.text
        # Pydantic trims the input and lower-cases the domain before we hand it on.
        assert enqueued_spotify_seat_requests == [(test_user.id, "Fan@spotify.example")]

    async def test_requires_auth(self, client: AsyncClient):
        resp = await client.post(SEAT_URL, json={"email": "fan@spotify.example"})
        assert resp.status_code == 401

    async def test_rejects_a_non_email(self, client: AsyncClient, auth_headers):
        resp = await client.post(SEAT_URL, json={"email": "not-an-email"}, headers=auth_headers)
        assert resp.status_code == 422

    async def test_rate_limited_per_user(
        self, client: AsyncClient, auth_headers, enqueued_spotify_seat_requests
    ):
        codes = [
            (
                await client.post(
                    SEAT_URL, json={"email": f"fan{i}@spotify.example"}, headers=auth_headers
                )
            ).status_code
            for i in range(4)
        ]
        assert codes == [202, 202, 202, 429]
        assert len(enqueued_spotify_seat_requests) == 3

    async def test_emails_every_admin_address(self, db_session: AsyncSession, monkeypatch):
        from unittest.mock import AsyncMock

        from app.services import event_notifications as ev

        user = User(
            external_id=f"seat-{uuid.uuid4()}",
            email=f"asker-{uuid.uuid4()}@example.com",
            display_name="Lucía",
            timezone="UTC",
            is_active=True,
        )
        db_session.add(user)
        await db_session.flush()
        monkeypatch.setattr(ev.get_settings(), "admin_emails", "boss@example.com, hola@example.com")
        send = AsyncMock()
        monkeypatch.setattr(ev, "send_email", send)

        result = await ev.notify_admins_of_spotify_seat_request(
            db_session, user.id, "fan@spotify.example"
        )

        assert result["status"] == "sent"
        assert sorted(c.args[0] for c in send.await_args_list) == [
            "boss@example.com",
            "hola@example.com",
        ]
        rendered = send.await_args_list[0].args[1]
        assert rendered.subject == "Lucía pide plaza de Spotify"
        assert "fan@spotify.example" in rendered.text
        assert "User Management" in rendered.text
        assert "developer.spotify.com/dashboard" in rendered.text

    async def test_no_admins_configured_sends_nothing(
        self, db_session: AsyncSession, test_user: User, monkeypatch
    ):
        from unittest.mock import AsyncMock

        from app.services import event_notifications as ev

        monkeypatch.setattr(ev.get_settings(), "admin_emails", "")
        send = AsyncMock()
        monkeypatch.setattr(ev, "send_email", send)

        result = await ev.notify_admins_of_spotify_seat_request(
            db_session, test_user.id, "fan@spotify.example"
        )

        assert result == {"status": "skipped", "reason": "no_admins"}
        send.assert_not_awaited()


class TestPublicAppUrl:
    def test_relative_when_not_configured(self):
        assert Settings(_env_file=None).public_app_url() == ""

    def test_uses_magic_link_base_url_when_set(self):
        s = Settings(_env_file=None, magic_link_base_url="https://miaurmario.example/")
        assert s.public_app_url() == "https://miaurmario.example"
