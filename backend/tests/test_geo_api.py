import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from httpx import AsyncClient
from redis.asyncio import Redis

from app.config import get_settings
from app.services import geocoding_service
from app.services.geocoding_service import (
    NOMINATIM_THROTTLE_KEY,
    GeocodingError,
    Place,
    _parse_nominatim_reverse,
    _parse_open_meteo_results,
)

OPEN_METEO_MADRID = {
    "results": [
        {
            "id": 3117735,
            "name": "Madrid",
            "latitude": 40.4165,
            "longitude": -3.70256,
            "country_code": "ES",
            "timezone": "Europe/Madrid",
            "country": "España",
            "admin1": "Comunidad de Madrid",
        },
        {
            "id": 1,
            "name": "Madrid",
            "latitude": 40.4165,
            "longitude": -3.70256,
            "country_code": "ES",
            "timezone": "Europe/Madrid",
            "country": "España",
            "admin1": "Comunidad de Madrid",
        },
        {"name": "Broken"},
        {
            "name": "Madrid",
            "latitude": 41.8,
            "longitude": -93.8,
            "country_code": "US",
            "timezone": "America/Chicago",
            "country": "Estados Unidos",
            "admin1": "Iowa",
        },
    ]
}


@pytest.fixture(autouse=True)
async def geo_redis():
    """A Redis client bound to this test's event loop, with a clean geo:* keyspace."""
    redis = Redis.from_url(str(get_settings().redis_url), decode_responses=True)
    keys = await redis.keys("geo:*")
    if keys:
        await redis.delete(*keys)
    with patch.object(geocoding_service, "get_redis", AsyncMock(return_value=redis)):
        yield redis
    await redis.aclose()


def _transport(handler):
    """Route the service's outbound HTTP through ``handler`` (sync, gets httpx.Request)."""
    calls: list[httpx.Request] = []

    def _handle(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)

    def factory(**kwargs):
        return httpx.AsyncClient(transport=httpx.MockTransport(_handle), **kwargs)

    return patch.object(geocoding_service, "_http_client", factory), calls


class TestParsers:
    def test_open_meteo_dedupes_and_skips_broken(self):
        places = _parse_open_meteo_results(OPEN_METEO_MADRID)
        assert [p.label for p in places] == [
            "Madrid, Comunidad de Madrid, España",
            "Madrid, Iowa, Estados Unidos",
        ]
        assert places[0].timezone == "Europe/Madrid"

    def test_open_meteo_no_results(self):
        assert _parse_open_meteo_results({"generationtime_ms": 0.1}) == []

    def test_open_meteo_bad_shape(self):
        with pytest.raises(GeocodingError):
            _parse_open_meteo_results(["nope"])

    def test_nominatim_reverse(self):
        place = _parse_nominatim_reverse(
            {
                "display_name": "Madrid, Comunidad de Madrid, España",
                "address": {
                    "city": "Madrid",
                    "state": "Comunidad de Madrid",
                    "country": "España",
                    "country_code": "es",
                },
            },
            40.4,
            -3.7,
        )
        assert place is not None
        assert place.label == "Madrid, Comunidad de Madrid, España"
        assert place.country_code == "ES"

    def test_nominatim_error(self):
        assert _parse_nominatim_reverse({"error": "Unable to geocode"}, 0, 0) is None

    def test_label_skips_duplicates(self):
        place = Place("Singapur", "Singapur", "Singapur", "SG", 1.3, 103.8, "Asia/Singapore")
        assert place.label == "Singapur"


def _mock_response(payload, status_code: int = 200) -> httpx.Response:
    return httpx.Response(
        status_code,
        content=json.dumps(payload).encode(),
        request=httpx.Request("GET", "https://example.test"),
    )


class TestSearchEndpoint:
    @pytest.mark.asyncio
    async def test_search_returns_places_and_caches(
        self, client: AsyncClient, test_user, auth_headers
    ):
        mocked, calls = _transport(lambda req: httpx.Response(200, json=OPEN_METEO_MADRID))
        with mocked:
            r1 = await client.get("/api/v1/geo/search?q=Madrid", headers=auth_headers)
            r2 = await client.get("/api/v1/geo/search?q=%20madrid%20", headers=auth_headers)

        assert r1.status_code == 200
        body = r1.json()["results"]
        assert body[0] == {
            "name": "Madrid",
            "admin1": "Comunidad de Madrid",
            "country": "España",
            "country_code": "ES",
            "latitude": 40.4165,
            "longitude": -3.70256,
            "timezone": "Europe/Madrid",
            "label": "Madrid, Comunidad de Madrid, España",
        }
        assert r2.json() == r1.json()
        # Second call served from Redis.
        assert len(calls) == 1
        assert calls[0].url.host == "geocoding-api.open-meteo.com"
        params = calls[0].url.params
        assert params["name"] == "Madrid"
        assert params["count"] == "8"
        assert params["language"] == "es"
        assert calls[0].headers["user-agent"].startswith("Miaurmario/1.0")

    @pytest.mark.asyncio
    async def test_short_query_skips_upstream(self, client: AsyncClient, auth_headers):
        mocked, calls = _transport(lambda req: httpx.Response(500))
        with mocked:
            r = await client.get("/api/v1/geo/search?q=M", headers=auth_headers)
        assert r.status_code == 200
        assert r.json() == {"results": []}
        assert calls == []

    @pytest.mark.asyncio
    async def test_upstream_failure_is_503(self, client: AsyncClient, auth_headers):
        def boom(req):
            raise httpx.ConnectError("down", request=req)

        mocked, _ = _transport(boom)
        with mocked:
            r = await client.get("/api/v1/geo/search?q=Bilbao", headers=auth_headers)
        assert r.status_code == 503
        assert r.json()["detail"] == "geocoding_unavailable"

    @pytest.mark.asyncio
    async def test_requires_auth(self, client: AsyncClient):
        r = await client.get("/api/v1/geo/search?q=Madrid")
        assert r.status_code == 401

    @pytest.mark.asyncio
    async def test_rate_limited(self, client: AsyncClient, auth_headers):
        with (
            patch("app.api.geo.SEARCH_RATE_LIMIT", (2, 60)),
            patch(
                "app.api.geo.search_places",
                AsyncMock(return_value=[]),
            ),
        ):
            codes = [
                (
                    await client.get(f"/api/v1/geo/search?q=Sevilla{i}", headers=auth_headers)
                ).status_code
                for i in range(3)
            ]
        assert codes == [200, 200, 429]


class TestReverseEndpoint:
    @pytest.mark.asyncio
    async def test_reverse_uses_nominatim_with_user_agent_and_timezone(
        self, client: AsyncClient, auth_headers, geo_redis
    ):
        redis = geo_redis
        await redis.delete(NOMINATIM_THROTTLE_KEY)

        nominatim = _mock_response(
            {
                "display_name": "Madrid, España",
                "address": {
                    "city": "Madrid",
                    "state": "Comunidad de Madrid",
                    "country": "España",
                    "country_code": "es",
                },
            }
        )
        forecast = _mock_response({"timezone": "Europe/Madrid"})
        mocked, calls = _transport(
            lambda req: nominatim if req.url.host == "nominatim.openstreetmap.org" else forecast
        )
        with mocked:
            r = await client.get(
                "/api/v1/geo/reverse?lat=40.4168&lon=-3.7038", headers=auth_headers
            )

        assert r.status_code == 200
        body = r.json()
        assert body["label"] == "Madrid, Comunidad de Madrid, España"
        assert body["timezone"] == "Europe/Madrid"
        assert body["latitude"] == pytest.approx(40.4168)
        assert calls[0].url.host == "nominatim.openstreetmap.org"
        assert calls[0].url.params["accept-language"] == "es"
        assert calls[0].headers["user-agent"] == (
            "Miaurmario/1.0 (+https://github.com/andreipopx/miaurmario)"
        )
        assert calls[1].url.params["timezone"] == "auto"
        # The Nominatim slot was taken (1 req/s throttle).
        assert await redis.pttl(NOMINATIM_THROTTLE_KEY) > 0

    @pytest.mark.asyncio
    async def test_reverse_not_found(self, client: AsyncClient, auth_headers):
        with (
            patch.object(geocoding_service, "wait_for_nominatim_slot", AsyncMock()),
            _transport(lambda req: _mock_response({"error": "Unable to geocode"}))[0],
        ):
            r = await client.get("/api/v1/geo/reverse?lat=0&lon=-160", headers=auth_headers)
        assert r.status_code == 404

    @pytest.mark.asyncio
    async def test_reverse_validates_coords(self, client: AsyncClient, auth_headers):
        r = await client.get("/api/v1/geo/reverse?lat=95&lon=0", headers=auth_headers)
        assert r.status_code == 422


class TestNominatimThrottle:
    @pytest.mark.asyncio
    async def test_busy_slot_raises_after_deadline(self, monkeypatch, geo_redis):
        redis = geo_redis
        await redis.set(NOMINATIM_THROTTLE_KEY, "1", px=5000)
        monkeypatch.setattr(geocoding_service, "NOMINATIM_MAX_WAIT_S", 0.1)
        with pytest.raises(geocoding_service.GeocodingBusyError):
            await geocoding_service.wait_for_nominatim_slot()
        await redis.delete(NOMINATIM_THROTTLE_KEY)

    @pytest.mark.asyncio
    async def test_falls_back_to_local_throttle_without_redis(self, monkeypatch):
        monkeypatch.setattr(
            geocoding_service, "get_redis", AsyncMock(side_effect=OSError("no redis"))
        )
        monkeypatch.setattr(geocoding_service, "_local_nominatim_next_slot", 0.0)
        monkeypatch.setattr(geocoding_service, "NOMINATIM_MIN_INTERVAL_MS", 50)
        import time

        start = time.monotonic()
        await geocoding_service.wait_for_nominatim_slot()
        await geocoding_service.wait_for_nominatim_slot()
        assert time.monotonic() - start >= 0.045
