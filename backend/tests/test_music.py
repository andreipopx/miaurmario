# ruff: noqa: F811  (fixtures imported from test_spotify_integration are re-bound as args)
"""Tests for the Música tab: history sync, daily mood heuristic, API, search."""

import json
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.music import ListeningEvent, ListeningMood
from app.models.outfit import Outfit, OutfitStatus
from app.models.user import User
from app.services import listening_history, music_overview, music_service
from app.services import spotify_mood as spotify_mood_service
from app.services.listening_history import maybe_sync, parse_play, sync_listening_history
from app.services.listening_mood import (
    compute_day_mood,
    mood_key,
    parse_ai_refinement,
    play_signal,
    refine_moods_with_ai,
    user_zone,
)
from tests.test_spotify_integration import (  # noqa: F401 - pytest fixtures
    _connection,
    _json,
    mock_http,
    no_cache,
    spotify_settings,
)


@pytest.fixture
def no_music_cache(monkeypatch, no_cache):  # noqa: F811
    """Keep every Redis-backed music cache out of the tests."""

    async def _none(*args, **kwargs):
        return None

    monkeypatch.setattr(music_overview, "_cache_get", _none)
    monkeypatch.setattr(music_overview, "_cache_set", _none)
    monkeypatch.setattr(listening_history, "_cached_genres", _none)
    monkeypatch.setattr(listening_history, "_store_genres", _none)


def _track(tid: str, name: str, artist_id: str = "a1", artist: str = "Frank Ocean", **kw):
    return {
        "id": tid,
        "name": name,
        "duration_ms": kw.get("duration_ms", 200_000),
        "artists": [{"id": artist_id, "name": artist}],
        "album": {
            "name": kw.get("album", "Blonde"),
            "release_date": kw.get("release_date", "2016-08-20"),
            "images": [
                {"url": f"https://i.scdn.co/{tid}-640", "width": 640},
                {"url": f"https://i.scdn.co/{tid}-300", "width": 300},
                {"url": f"https://i.scdn.co/{tid}-64", "width": 64},
            ],
        },
    }


def _play(track: dict, played_at: datetime) -> dict:
    return {"track": track, "played_at": played_at.isoformat().replace("+00:00", "Z")}


def _event(**kw) -> SimpleNamespace:
    base = {
        "track_id": "t",
        "track_name": "Song",
        "artist_name": "Artist",
        "album": None,
        "release_year": 2020,
        "genres": [],
        "duration_ms": 180_000,
        "played_at": datetime(2026, 9, 20, 12, tzinfo=UTC),
    }
    base.update(kw)
    return SimpleNamespace(**base)


# --- Heuristic ------------------------------------------------------------------------------


class TestMoodHeuristic:
    def test_genre_rules_specific_before_broad(self):
        sig = play_signal(["dancehall"], "x")
        assert sig.votes.most_common(1)[0][0] == "euphoric"
        sig = play_signal(["classic rock"], "x")
        assert sig.votes.most_common(1)[0][0] == "nostalgic"
        sig = play_signal(["death metal"], "x")
        assert sig.votes.most_common(1)[0][0] == "intense"

    def test_no_signal_without_genres_or_keywords(self):
        sig = play_signal([], "Untitled 7")
        assert not sig.has_signal

    def test_title_keywords_give_signal_without_genres(self):
        sig = play_signal([], "Lágrimas de noche")
        assert sig.has_signal
        assert sig.votes["melancholic"] > 0 and sig.votes["dreamy"] > 0

    def test_sad_day_is_melancholic(self):
        plays = [
            _event(track_id=f"t{i}", track_name="Cry alone", genres=["sad indie", "emo"])
            for i in range(4)
        ]
        mood = compute_day_mood(plays)
        assert mood.moods[0] == "melancólico"
        assert mood.valence < 0.35
        assert mood.primary.color == "sky"

    def test_party_day_is_euphoric_or_electric(self):
        plays = [
            _event(
                track_id=f"t{i}", track_name="Fiesta", artist_name="Bad Bunny", genres=["reggaeton"]
            )
            for i in range(5)
        ]
        mood = compute_day_mood(plays)
        assert mood.moods[0] in {"eufórico", "eléctrico"}
        assert mood.energy > 0.7
        assert mood.dominant_artists == ["Bad Bunny"]
        assert "Bad Bunny" in mood.one_liner

    def test_calm_day(self):
        plays = [_event(track_id=f"t{i}", genres=["ambient", "lo-fi beats"]) for i in range(3)]
        assert compute_day_mood(plays).moods[0] == "calmado"

    def test_old_releases_vote_nostalgic(self):
        plays = [
            _event(track_id=f"t{i}", release_year=1978, genres=["soft rock", "yacht rock"])
            for i in range(3)
        ]
        assert "nostálgico" in compute_day_mood(plays).moods

    def test_eclectic_when_nothing_known(self):
        mood = compute_day_mood([_event(track_id="a", track_name="Xyz"), _event(track_id="b")])
        assert mood.moods == ["ecléctico"]
        assert (mood.energy, mood.valence) == (0.5, 0.5)
        assert mood.track_count == 2
        assert mood.listened_ms == 360_000

    def test_deterministic_and_signature_order_independent(self):
        plays = [
            _event(track_id="a", genres=["pop"], played_at=datetime(2026, 9, 20, 10, tzinfo=UTC)),
            _event(track_id="b", genres=["rock"], played_at=datetime(2026, 9, 20, 11, tzinfo=UTC)),
        ]
        m1 = compute_day_mood(plays)
        m2 = compute_day_mood(list(reversed(plays)))
        assert m1.signature == m2.signature
        assert m1.moods == m2.moods
        assert m1.top_genres == ["pop", "rock"]

    def test_mood_key_mapping(self):
        assert mood_key("melancólico") == "melancholic"
        assert mood_key("unknown") == "eclectic"

    def test_parse_ai_refinement_filters_labels(self):
        text = (
            'Claro: {"days": [{"date": "2026-09-20", "moods": ["nostálgico", "feliz"], '
            '"energy": 1.4, "valence": 0.3, "one_liner": "Miau."}, '
            '{"date": "2026-09-19", "moods": ["triste"], "energy": 0.1, "valence": 0.1}]}'
        )
        parsed = parse_ai_refinement(text)
        assert list(parsed) == ["2026-09-20"]
        assert parsed["2026-09-20"]["moods"] == ["nostálgico"]
        assert parsed["2026-09-20"]["energy"] == 1.0
        assert parse_ai_refinement("no json") == {}


# --- Sync -------------------------------------------------------------------------------------


def _history_handler(pages: list[list[dict]], artists: dict[str, list[str]] | None = None):
    """Serve recently-played pages in order; record artist lookups."""
    state = {"i": 0, "artist_calls": []}

    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path == "/v1/me/player/recently-played":
            page = pages[min(state["i"], len(pages) - 1)] if pages else []
            state["i"] += 1
            return _json({"items": page, "cursors": None})
        if path.startswith("/v1/artists/"):
            aid = path.rsplit("/", 1)[-1]
            state["artist_calls"].append(aid)
            return _json({"id": aid, "genres": (artists or {}).get(aid, [])})
        return httpx.Response(404)

    return handler, state


class TestHistorySync:
    def test_parse_play_skips_local_files(self):
        assert (
            parse_play({"track": {"id": None, "name": "x"}, "played_at": "2026-09-20T10:00:00Z"})
            is None
        )
        play = parse_play(_play(_track("t1", "Nights"), datetime(2026, 9, 20, 10, tzinfo=UTC)))
        assert play["image_url"].endswith("t1-300")
        assert play["release_year"] == 2016
        assert play["artists"] == ["Frank Ocean"]

    async def test_upsert_is_idempotent_and_cursor_advances(
        self, db_session: AsyncSession, test_user: User, spotify_settings, mock_http, no_music_cache
    ):
        t0 = datetime.now(UTC).replace(microsecond=0) - timedelta(hours=2)
        page = [
            _play(_track("t2", "Nights"), t0 + timedelta(minutes=5)),
            _play(_track("t1", "Pink + White"), t0),
        ]
        handler, state = _history_handler([page, page], {"a1": ["alternative r&b"]})
        calls = mock_http(handler)
        conn = _connection(test_user.id)
        db_session.add(conn)
        await db_session.commit()

        first = await sync_listening_history(db_session, conn, tz_name="Europe/Madrid")
        assert (first.fetched, first.inserted) == (2, 2)
        assert conn.history_cursor_ms == int((t0 + timedelta(minutes=5)).timestamp() * 1000)
        assert conn.last_history_sync_at is not None
        # One artist lookup for the two plays of the same artist.
        assert state["artist_calls"] == ["a1"]

        # Spotify returns the same window again: nothing new is inserted.
        second = await sync_listening_history(db_session, conn, tz_name="Europe/Madrid")
        assert second.inserted == 0
        recent_calls = [c for c in calls if c.url.path.endswith("recently-played")]
        assert "after" not in parse_qs(recent_calls[0].url.query.decode())
        assert parse_qs(recent_calls[1].url.query.decode())["after"] == [
            str(conn.history_cursor_ms)
        ]

        count = await db_session.scalar(
            select(func.count())
            .select_from(ListeningEvent)
            .where(ListeningEvent.user_id == test_user.id)
        )
        assert count == 2
        ev = (
            await db_session.execute(
                select(ListeningEvent).where(
                    ListeningEvent.track_id == "t1", ListeningEvent.user_id == test_user.id
                )
            )
        ).scalar_one()
        assert ev.genres == ["alternative r&b"]
        # A daily mood row was computed for the affected local day.
        moods = (
            (
                await db_session.execute(
                    select(ListeningMood).where(ListeningMood.user_id == test_user.id)
                )
            )
            .scalars()
            .all()
        )
        assert sum(m.track_count for m in moods) == 2
        assert all(m.method == "heuristic" and m.moods for m in moods)

    async def test_full_page_with_cursor_pages_forward(
        self, db_session, test_user, spotify_settings, mock_http, no_music_cache
    ):
        base = datetime.now(UTC).replace(microsecond=0) - timedelta(days=1)
        page1 = [
            _play(_track(f"p{i}", f"Song {i}"), base + timedelta(minutes=i)) for i in range(50)
        ]
        page2 = [_play(_track("late", "Late"), base + timedelta(hours=5))]
        handler, state = _history_handler([page1, page2])
        mock_http(handler)
        conn = _connection(test_user.id)
        conn.history_cursor_ms = int((base - timedelta(minutes=1)).timestamp() * 1000)
        db_session.add(conn)
        await db_session.commit()

        result = await sync_listening_history(db_session, conn, tz_name="UTC")
        assert result.inserted == 51
        assert state["i"] == 2
        assert conn.history_cursor_ms == int((base + timedelta(hours=5)).timestamp() * 1000)

    async def test_maybe_sync_is_throttled(
        self, db_session, test_user, spotify_settings, mock_http, no_music_cache
    ):
        calls = mock_http(_history_handler([[]])[0])
        conn = _connection(test_user.id)
        conn.last_history_sync_at = datetime.now(UTC) - timedelta(seconds=30)
        db_session.add(conn)
        await db_session.commit()
        result = await maybe_sync(db_session, conn, test_user)
        assert result.skipped is True
        assert calls == []

    async def test_artist_lookup_stops_on_429(
        self, db_session, test_user, spotify_settings, mock_http, no_music_cache, monkeypatch
    ):
        from app.integrations.spotify import client as client_mod

        async def _no_sleep(_):
            return None

        monkeypatch.setattr(client_mod.asyncio, "sleep", _no_sleep)
        t0 = datetime.now(UTC).replace(microsecond=0) - timedelta(hours=1)
        page = [
            _play(_track("x1", "A", artist_id="r1"), t0),
            _play(_track("x2", "B", artist_id="r2"), t0 + timedelta(minutes=4)),
        ]
        artist_calls: list[str] = []

        def handler(req: httpx.Request) -> httpx.Response:
            if req.url.path.endswith("recently-played"):
                return _json({"items": page})
            artist_calls.append(req.url.path)
            return httpx.Response(429, headers={"Retry-After": "1"})

        mock_http(handler)
        conn = _connection(test_user.id)
        db_session.add(conn)
        await db_session.commit()
        result = await sync_listening_history(db_session, conn, tz_name="UTC")
        assert result.inserted == 2
        # First artist: request + one Retry-After retry, then we stop asking.
        assert len(artist_calls) == 2


# --- AI refinement is optional ---------------------------------------------------------------


class TestAIRefinement:
    async def test_no_ai_access_is_a_noop(self, db_session, test_user, mock_http, monkeypatch):
        db_session.add(
            ListeningMood(
                user_id=test_user.id,
                day=date.today() - timedelta(days=2),
                moods=["calmado"],
                track_count=5,
                method="heuristic",
            )
        )
        await db_session.commit()

        class _Redis:
            async def set(self, *a, **kw):
                return True

        async def _get_redis():
            return _Redis()

        monkeypatch.setattr("app.utils.redis_lock.get_redis", _get_redis)
        calls = mock_http(lambda req: _json({}))
        refined = await refine_moods_with_ai(db_session, test_user, user_zone("UTC"))
        assert refined == 0
        assert calls == []
        row = (
            await db_session.execute(
                select(ListeningMood).where(ListeningMood.user_id == test_user.id)
            )
        ).scalar_one()
        assert row.method == "heuristic"

    async def test_ai_refines_finished_days(self, db_session, platform_ai_user, monkeypatch):
        day = date.today() - timedelta(days=1)
        db_session.add(
            ListeningMood(
                user_id=platform_ai_user.id,
                day=day,
                moods=["ecléctico"],
                track_count=4,
                method="heuristic",
            )
        )
        await db_session.commit()

        class _Redis:
            async def set(self, *a, **kw):
                return True

        async def _get_redis():
            return _Redis()

        class _FakeAI:
            async def generate_text(self, prompt, system_prompt=None):
                assert day.isoformat() in prompt
                entry = {
                    "date": day.isoformat(),
                    "moods": ["soñador"],
                    "energy": 0.3,
                    "valence": 0.6,
                    "one_liner": "Stinky mira la luna.",
                }
                return json.dumps({"days": [entry]})

        async def _resolve(db, user, capability):
            return _FakeAI()

        monkeypatch.setattr("app.utils.redis_lock.get_redis", _get_redis)
        monkeypatch.setattr("app.services.ai_access.resolve_ai_client", _resolve)
        refined = await refine_moods_with_ai(db_session, platform_ai_user, user_zone("UTC"))
        assert refined == 1
        row = (
            await db_session.execute(
                select(ListeningMood).where(ListeningMood.user_id == platform_ai_user.id)
            )
        ).scalar_one()
        assert row.method == "ai"
        assert row.moods == ["soñador"]
        assert row.one_liner == "Stinky mira la luna."


# --- API ----------------------------------------------------------------------------------------


def _spotify_api_handler(now_playing: bool = True):
    t0 = datetime.now(UTC).replace(microsecond=0) - timedelta(minutes=30)

    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path == "/v1/me/player/currently-playing":
            if not now_playing:
                return httpx.Response(204)
            return _json(
                {
                    "currently_playing_type": "track",
                    "is_playing": True,
                    "progress_ms": 1000,
                    "item": _track("np1", "Ivy"),
                }
            )
        if path == "/v1/me/player/recently-played":
            return _json(
                {
                    "items": [
                        _play(_track("r1", "Self Control"), t0),
                        _play(
                            _track("r2", "Solo", artist_id="a2", artist="Frank"),
                            t0 + timedelta(minutes=4),
                        ),
                    ]
                }
            )
        if path == "/v1/me/top/artists":
            return _json(
                {"items": [{"id": "a1", "name": "Frank Ocean", "genres": ["r&b"], "images": []}]}
            )
        if path == "/v1/me/top/tracks":
            return _json({"items": [_track("tt1", "Nikes")]})
        if path.startswith("/v1/artists/"):
            return _json({"genres": ["neo soul"]})
        if path == "/v1/search":
            q = parse_qs(req.url.query.decode())
            assert q["type"] == ["track"] and q["limit"] == ["8"]
            return _json({"tracks": {"items": [_track("s1", "Nights"), _track("s2", "Nikes")]}})
        if path.startswith("/v1/tracks/"):
            return _json(_track(path.rsplit("/", 1)[-1], "Chosen One"))
        return httpx.Response(404)

    return handler


class TestMusicAPI:
    async def test_overview_not_connected_empty(
        self, client: AsyncClient, auth_headers, no_music_cache
    ):
        resp = await client.get("/api/v1/music/overview", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["connected"] is False
        assert data["recent"] == [] and data["moods"] == [] and data["now_playing"] is None
        assert data["top_source"] == "history"
        assert data["stats"]["plays"] == 0

    async def test_overview_rejects_bad_range(self, client: AsyncClient, auth_headers):
        resp = await client.get("/api/v1/music/overview?range=1y", headers=auth_headers)
        assert resp.status_code == 422

    async def test_sync_then_overview(
        self,
        client: AsyncClient,
        auth_headers,
        db_session,
        test_user,
        spotify_settings,
        mock_http,
        no_music_cache,
    ):
        db_session.add(_connection(test_user.id))
        # An accepted outfit today shows up in "Tu música y tus looks".
        outfit = Outfit(
            user_id=test_user.id,
            occasion="casual",
            status=OutfitStatus.accepted,
            scheduled_for=datetime.now(UTC).date(),
        )
        db_session.add(outfit)
        await db_session.commit()
        mock_http(_spotify_api_handler())

        resp = await client.post("/api/v1/music/sync", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["inserted"] == 2
        again = await client.post("/api/v1/music/sync", headers=auth_headers)
        assert again.json()["skipped"] is True

        for range_key, source in (("7d", "history"), ("30d", "spotify")):
            resp = await client.get(
                f"/api/v1/music/overview?range={range_key}", headers=auth_headers
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["connected"] is True
            assert data["now_playing"]["name"] == "Ivy"
            assert [r["name"] for r in data["recent"]] == ["Solo", "Self Control"]
            assert data["top_source"] == source
            assert data["stats"]["plays"] == 2
            assert data["moods"] and data["moods"][-1]["mood_key"]
            assert data["genres"][0]["genre"] == "neo soul"
            assert data["outfit_days"][0]["outfits"][0]["id"] == str(outfit.id)
            assert data["outfit_days"][0]["tracks"]
        # 30d uses Spotify's top endpoints.
        assert data["top_tracks"][0]["name"] == "Nikes"

    async def test_recent_pagination(
        self, client: AsyncClient, auth_headers, db_session, test_user
    ):
        t0 = datetime(2026, 9, 1, tzinfo=UTC)
        for i in range(3):
            db_session.add(
                ListeningEvent(
                    user_id=test_user.id,
                    played_at=t0 + timedelta(minutes=i),
                    track_id=f"t{i}",
                    track_name=f"Song {i}",
                    artists=["A"],
                    genres=[],
                )
            )
        await db_session.commit()
        resp = await client.get("/api/v1/music/recent?limit=2", headers=auth_headers)
        data = resp.json()
        assert [i["name"] for i in data["items"]] == ["Song 2", "Song 1"]
        assert data["next_before"]
        resp = await client.get(
            "/api/v1/music/recent",
            params={"limit": 2, "before": data["next_before"]},
            headers=auth_headers,
        )
        assert [i["name"] for i in resp.json()["items"]] == ["Song 0"]

    async def test_search_spotify(
        self,
        client,
        auth_headers,
        db_session,
        test_user,
        spotify_settings,
        mock_http,
        no_music_cache,
    ):
        db_session.add(_connection(test_user.id))
        await db_session.commit()
        mock_http(_spotify_api_handler())
        resp = await client.get("/api/v1/music/search?q=frank", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["source"] == "spotify"
        assert [i["track_id"] for i in data["items"]] == ["s1", "s2"]
        assert data["items"][0]["image_url"].endswith("s1-300")

    async def test_search_fallback_musicbrainz(
        self, client, auth_headers, spotify_settings, mock_http, no_music_cache
    ):
        def handler(req: httpx.Request) -> httpx.Response:
            assert req.url.host == "musicbrainz.org"
            return _json(
                {
                    "recordings": [
                        {
                            "title": "Nights",
                            "artist-credit": [{"name": "Frank Ocean"}],
                            "releases": [{"id": "rel1", "title": "Blonde"}],
                        }
                    ]
                }
            )

        mock_http(handler)
        resp = await client.get("/api/v1/music/search?q=nights", headers=auth_headers)
        data = resp.json()
        assert data["source"] == "musicbrainz"
        assert data["items"][0]["track_id"] is None
        assert data["items"][0]["artists"] == ["Frank Ocean"]
        assert "coverartarchive.org/release/rel1" in data["items"][0]["image_url"]

    async def test_search_short_query(self, client, auth_headers):
        resp = await client.get("/api/v1/music/search?q=a", headers=auth_headers)
        assert resp.json() == {"source": None, "items": []}

    async def test_now_playing_endpoint(
        self,
        client,
        auth_headers,
        db_session,
        test_user,
        spotify_settings,
        mock_http,
        no_music_cache,
    ):
        resp = await client.get("/api/v1/music/now-playing", headers=auth_headers)
        assert resp.json() == {"connected": False, "track": None}
        db_session.add(_connection(test_user.id))
        await db_session.commit()
        mock_http(_spotify_api_handler())
        resp = await client.get("/api/v1/music/now-playing", headers=auth_headers)
        assert resp.json()["track"]["track_id"] == "np1"


class TestSongTrackId:
    async def test_track_id_resolves_directly(
        self, db_session, test_user, spotify_settings, mock_http, no_music_cache
    ):
        db_session.add(_connection(test_user.id))
        await db_session.commit()
        calls = mock_http(_spotify_api_handler())
        ctx = await music_service.resolve_music_context(
            db_session,
            test_user,
            "Frank Ocean — Chosen One",
            song_track_id="4iV5W9uYEdYUVa79Axb7Rh",
        )
        assert ctx is not None and ctx.source == "spotify"
        assert ctx.track == "Chosen One"
        paths = [c.url.path for c in calls]
        assert "/v1/tracks/4iV5W9uYEdYUVa79Axb7Rh" in paths
        assert "/v1/search" not in paths

    async def test_invalid_track_id_rejected_by_schema(self, client, auth_headers):
        resp = await client.post(
            "/api/v1/outfits/suggest",
            json={"occasion": "casual", "song_track_id": "../../etc"},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    async def test_spotify_mood_module_exposes_resolver(self):
        assert callable(spotify_mood_service.resolve_track_id)


class TestWorkerJob:
    async def test_cron_job_syncs_connected_users(
        self, async_engine, db_session, test_user, spotify_settings, mock_http, no_music_cache
    ):
        from sqlalchemy.ext.asyncio import async_sessionmaker

        from app.workers.music import sync_listening_history_job

        db_session.add(_connection(test_user.id))
        await db_session.commit()
        mock_http(_spotify_api_handler(now_playing=False))
        ctx = {
            "db_session_factory": async_sessionmaker(
                async_engine, class_=AsyncSession, expire_on_commit=False
            )
        }
        result = await sync_listening_history_job(ctx)
        assert result["synced"] >= 1
        count = await db_session.scalar(
            select(func.count())
            .select_from(ListeningEvent)
            .where(ListeningEvent.user_id == test_user.id)
        )
        assert count == 2
