# ruff: noqa: F811  (fixtures imported from test_spotify_integration are re-bound as args)
"""Last.fm as a music source: client errors, history sync, dedupe, API, privacy."""

from datetime import UTC, datetime, timedelta

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from app.config import get_settings
from app.integrations.lastfm import client as lastfm_client
from app.models.lastfm import LastfmConnection
from app.models.music import ListeningEvent
from app.services import lastfm_history, music_overview, music_service
from app.services.listening_dedupe import drop_cross_source_duplicates, track_key_id
from app.services.listening_mood import is_low_mood, parse_ai_refinement, talks_about_person
from app.services.music_service import SongContext, format_song_context_for_prompt
from tests.test_spotify_integration import (  # noqa: F401 - pytest fixtures
    _json,
    mock_http,
    no_cache,
)


@pytest.fixture
def lastfm_env(monkeypatch, no_cache):  # noqa: F811
    """API key set; no Redis (token bucket, cooldown, caches) and no arq."""
    settings = get_settings()
    monkeypatch.setattr(settings, "lastfm_api_key", "k3y")
    monkeypatch.setattr(settings, "lastfm_api_secret", None)

    async def _noop(*args, **kwargs):
        return None

    async def _false(*args, **kwargs):
        return False

    monkeypatch.setattr(lastfm_client, "acquire_token", _noop)
    monkeypatch.setattr(lastfm_client, "in_cooldown", _false)
    monkeypatch.setattr(lastfm_client, "start_cooldown", _noop)
    monkeypatch.setattr(lastfm_history, "_cache_get", _noop)
    monkeypatch.setattr(lastfm_history, "_cache_set", _noop)
    monkeypatch.setattr(lastfm_history, "clear_cache", _noop)
    monkeypatch.setattr(music_overview, "_cache_get", _noop)
    monkeypatch.setattr(music_overview, "_cache_set", _noop)
    monkeypatch.setattr(music_overview, "clear_user_cache", _noop)

    from app.api.integrations import lastfm as lastfm_api

    monkeypatch.setattr(lastfm_api, "enqueue_first_sync", _noop)
    return settings


def _scrobble(artist: str, name: str, when: datetime | None, *, now_playing: bool = False):
    track = {
        "artist": {"name": artist, "mbid": ""},
        "name": name,
        "album": {"#text": "Album"},
        "image": [{"size": "extralarge", "#text": f"https://lastfm.freetls.fastly.net/{name}.jpg"}],
    }
    if now_playing:
        track["@attr"] = {"nowplaying": "true"}
    if when is not None:
        track["date"] = {"uts": str(int(when.timestamp()))}
    return track


def _lastfm_handler(tracks: list[dict], *, user: str = "Stinky", missing: bool = False):
    def handler(req: httpx.Request) -> httpx.Response:
        method = req.url.params.get("method")
        if missing:
            return _json({"error": 6, "message": "User not found"}, 404)
        if method == "user.getInfo":
            return _json({"user": {"name": user}})
        if method == "user.getRecentTracks":
            limit = int(req.url.params.get("limit", "200"))
            return _json(
                {
                    "recenttracks": {
                        "track": tracks[:limit],
                        "@attr": {"page": "1", "totalPages": "1", "total": str(len(tracks))},
                    }
                }
            )
        if method == "artist.getTopTags":
            return _json({"toptags": {"tag": [{"name": "indie folk", "count": 100}]}})
        if method in ("user.getTopArtists", "user.getTopTracks"):
            return _json({"topartists": {"artist": []}, "toptracks": {"track": []}})
        return _json({"error": 3, "message": "Invalid method"}, 400)

    return handler


# --- pure helpers -------------------------------------------------------------------------


class TestHelpers:
    def test_track_key_ignores_remaster_suffix_and_case(self):
        assert track_key_id("Mitski", "Nobody") == track_key_id(
            "MITSKI", "Nobody - Remastered 2020"
        )
        assert track_key_id("Mitski", "Nobody") != track_key_id("Mitski", "Somebody")

    def test_parse_scrobble_skips_now_playing(self):
        now = datetime(2026, 9, 21, 10, tzinfo=UTC)
        assert lastfm_history.parse_scrobble(_scrobble("A", "B", None, now_playing=True)) is None
        play = lastfm_history.parse_scrobble(_scrobble("A", "B", now))
        assert play["played_at"] == now and play["artist_name"] == "A"
        assert play["track_id"].startswith("lfm:")

    def test_error_reasons(self):
        assert lastfm_client.LastfmError("User not found", code=6).reason == "not_found"
        assert lastfm_client.LastfmError("Login", code=17).reason == "private"
        assert lastfm_client.LastfmRateLimited().rate_limited

    def test_person_talk_is_filtered(self):
        assert talks_about_person("Hoy estás triste, Stinky te acompaña")
        assert not talks_about_person("Tu música de hoy suena melancólica: capas suaves")
        parsed = parse_ai_refinement(
            '{"days": [{"date": "2026-09-20", "moods": ["melancólico"], "energy": 0.3,'
            ' "valence": 0.2, "one_liner": "Te noto con el ánimo bajo"}]}'
        )
        assert parsed["2026-09-20"]["one_liner"] is None

    def test_contrast_off_matches_the_music(self):
        ctx = SongContext(
            query="x", artist="A", track="B", listening="recently_played", source="lastfm"
        )
        ctx.day_sounds, ctx.day_energy, ctx.day_valence = ["melancólica"], 0.25, 0.2
        text = format_song_context_for_prompt(ctx)
        assert "vía Last.fm" in text
        assert "Su música de hoy suena melancólica" in text
        assert "CONTRASTE ACTIVADO" not in text
        assert "Acompaña el tono de la música" in text

    def test_contrast_on_low_music_allows_one_brighter_look(self):
        assert is_low_mood(0.25, 0.2) and not is_low_mood(0.8, 0.8)
        ctx = SongContext(query="x", listening="recently_played", contrast=True)
        ctx.day_sounds, ctx.day_energy, ctx.day_valence = ["melancólica"], 0.25, 0.2
        text = format_song_context_for_prompt(ctx)
        assert "CONTRASTE ACTIVADO" in text and "nunca como" in text
        # Upbeat music + contrast on: nothing to contrast.
        ctx.day_energy, ctx.day_valence = 0.9, 0.8
        assert "CONTRASTE ACTIVADO" not in format_song_context_for_prompt(ctx)


# --- sync + dedupe ------------------------------------------------------------------------


class TestLastfmSync:
    async def test_sync_is_idempotent_and_skips_now_playing(
        self, db_session, test_user, lastfm_env, mock_http
    ):
        now = datetime.now(UTC).replace(microsecond=0)
        tracks = [
            _scrobble("Mitski", "Nobody", None, now_playing=True),
            _scrobble("Mitski", "Nobody", now - timedelta(minutes=5)),
            _scrobble("Björk", "Hyperballad", now - timedelta(minutes=10)),
        ]
        mock_http(_lastfm_handler(tracks))
        connection = LastfmConnection(user_id=test_user.id, username="Stinky")
        db_session.add(connection)
        await db_session.commit()

        result = await lastfm_history.sync_lastfm_history(db_session, connection)
        assert result.inserted == 2
        assert connection.cursor_uts == int((now - timedelta(minutes=5)).timestamp())
        again = await lastfm_history.sync_lastfm_history(db_session, connection)
        assert again.inserted == 0

        rows = (
            (
                await db_session.execute(
                    select(ListeningEvent).where(ListeningEvent.user_id == test_user.id)
                )
            )
            .scalars()
            .all()
        )
        assert {r.source for r in rows} == {"lastfm"}
        assert all(r.genres == ["indie folk"] for r in rows)

    async def test_cross_source_duplicates_are_dropped_one_to_one(self, db_session, test_user):
        t0 = datetime(2026, 9, 20, 12, tzinfo=UTC)
        db_session.add(
            ListeningEvent(
                user_id=test_user.id,
                source="spotify",
                track_id="sp1",
                track_name="Nobody",
                artist_name="Mitski",
                played_at=t0 + timedelta(minutes=3),  # Spotify stamps the end
                genres=[],
            )
        )
        await db_session.commit()
        incoming = [
            {"artist_name": "Mitski", "track_name": "Nobody", "played_at": t0},
            {
                "artist_name": "Mitski",
                "track_name": "Nobody",
                "played_at": t0 + timedelta(minutes=4),
            },
        ]
        kept = await drop_cross_source_duplicates(db_session, test_user.id, incoming, "lastfm")
        assert len(kept) == 1


# --- API ----------------------------------------------------------------------------------


class TestLastfmAPI:
    async def test_connect_unknown_user(
        self, client: AsyncClient, auth_headers, lastfm_env, mock_http
    ):
        mock_http(_lastfm_handler([], missing=True))
        resp = await client.post(
            "/api/v1/integrations/lastfm/connect", json={"username": "nobody"}, headers=auth_headers
        )
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "lastfm_user_not_found"

    async def test_connect_rejects_bad_username(
        self, client: AsyncClient, auth_headers, lastfm_env
    ):
        resp = await client.post(
            "/api/v1/integrations/lastfm/connect", json={"username": "a b"}, headers=auth_headers
        )
        assert resp.status_code == 422

    async def test_connect_sync_overview_and_disconnect(
        self, client: AsyncClient, auth_headers, db_session, test_user, lastfm_env, mock_http
    ):
        now = datetime.now(UTC).replace(microsecond=0)
        mock_http(_lastfm_handler([_scrobble("Mitski", "Nobody", now - timedelta(minutes=5))]))

        resp = await client.post(
            "/api/v1/integrations/lastfm/connect", json={"username": "stinky"}, headers=auth_headers
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["connected"] is True
        assert resp.json()["username"] == "Stinky"  # canonical name from user.getInfo

        resp = await client.post("/api/v1/music/sync", headers=auth_headers)
        assert resp.json()["inserted"] == 1

        data = (await client.get("/api/v1/music/overview", headers=auth_headers)).json()
        assert data["connected"] is True
        assert data["source"] == "lastfm"
        assert data["sources"] == {"spotify": False, "lastfm": True}
        assert data["recent"][0]["url"].startswith("https://www.last.fm/music/")

        resp = await client.delete(
            "/api/v1/integrations/lastfm?keep_history=false", headers=auth_headers
        )
        assert resp.status_code == 204
        count = (
            await db_session.execute(
                select(func.count(ListeningEvent.id)).where(ListeningEvent.user_id == test_user.id)
            )
        ).scalar_one()
        assert count == 0
        status = (
            await client.get("/api/v1/integrations/lastfm/status", headers=auth_headers)
        ).json()
        assert status["connected"] is False

    async def test_music_settings_contrast_and_history_delete(
        self, client: AsyncClient, auth_headers, db_session, test_user, lastfm_env
    ):
        data = (await client.get("/api/v1/music/settings", headers=auth_headers)).json()
        assert data["contrast"] is False  # off by default
        data = (
            await client.patch(
                "/api/v1/music/settings", json={"contrast": True}, headers=auth_headers
            )
        ).json()
        assert data["contrast"] is True

        db_session.add(
            ListeningEvent(
                user_id=test_user.id,
                source="lastfm",
                track_id="lfm:x",
                track_name="Nobody",
                artist_name="Mitski",
                played_at=datetime.now(UTC),
                genres=[],
            )
        )
        await db_session.commit()
        resp = await client.delete("/api/v1/music/history", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["deleted"]["events"] == 1


async def test_song_context_carries_contrast_preference(db_session, test_user, monkeypatch):
    async def _enrich(query):
        return SongContext(query=query, artist="Mitski", track="Nobody")

    monkeypatch.setattr(music_service, "enrich_song", _enrich)
    from app.services.preference_service import PreferenceService

    prefs = await PreferenceService(db_session).get_or_create_preferences(test_user.id)
    prefs.music_contrast = True
    await db_session.commit()
    ctx = await music_service.resolve_music_context(db_session, test_user, "Mitski — Nobody")
    assert ctx is not None and ctx.contrast is True
