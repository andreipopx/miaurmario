"""Detected location and timezone: rounding, the travel threshold, degradation.

The privacy promise is the thing under test here: a precise position handed to
the API must not reach the geocoding provider, the stored row, or anything else.
"""

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from httpx import AsyncClient
from redis.asyncio import Redis
from sqlalchemy import select

from app.config import get_settings
from app.models.user import User
from app.services import geocoding_service
from app.services.geocoding_service import Place, reverse_geocode
from app.services.location_service import (
    TRAVEL_DISTANCE_KM,
    city_label,
    distance_from_saved_km,
    haversine_km,
    is_travelling,
    round_city_coord,
    round_city_coords,
    short_city_name,
    travel_prompt_allowed,
)

# Somewhere precise in Madrid, and the city-level pair it must collapse to.
MADRID_EXACT = (40.416775, -3.703790)
MADRID_CITY = (40.42, -3.7)
LISBON_EXACT = (38.722252, -9.139337)

DEVICE_URL = "/api/v1/users/me/location/device"


@pytest.fixture(autouse=True)
async def geo_redis():
    """Redis bound to this test's loop, with a clean geo:* keyspace."""
    redis = Redis.from_url(str(get_settings().redis_url), decode_responses=True)
    keys = await redis.keys("geo:*")
    if keys:
        await redis.delete(*keys)
    with patch.object(geocoding_service, "get_redis", AsyncMock(return_value=redis)):
        yield redis
    await redis.aclose()


def _nominatim_payload(city: str, state: str, country: str, code: str) -> dict:
    return {
        "display_name": f"{city}, {state}, {country}",
        "address": {"city": city, "state": state, "country": country, "country_code": code},
    }


MADRID_PAYLOAD = _nominatim_payload("Madrid", "Comunidad de Madrid", "España", "es")
LISBON_PAYLOAD = _nominatim_payload("Lisboa", "Lisboa", "Portugal", "pt")


def _transport(handler):
    """Route the geocoding service's outbound HTTP through ``handler``."""
    calls: list[httpx.Request] = []

    def _handle(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)

    def factory(**kwargs):
        return httpx.AsyncClient(transport=httpx.MockTransport(_handle), **kwargs)

    return patch.object(geocoding_service, "_http_client", factory), calls


def _geocoder(payload: dict, timezone: str | None):
    """Nominatim answers ``payload``; the Open-Meteo forecast answers ``timezone``."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "nominatim.openstreetmap.org":
            return httpx.Response(200, json=payload)
        return httpx.Response(200, json={"timezone": timezone} if timezone else {})

    mocked, calls = _transport(handler)
    return patch.object(geocoding_service, "wait_for_nominatim_slot", AsyncMock()), mocked, calls


class TestRounding:
    def test_rounds_to_city_precision(self):
        assert round_city_coord(40.416775) == Decimal("40.42")
        assert round_city_coord(-3.703790) == Decimal("-3.70")
        assert round_city_coords(*MADRID_EXACT) == (Decimal("40.42"), Decimal("-3.70"))

    def test_half_up_is_stable(self):
        # Banker's rounding would send one of these the other way.
        assert round_city_coord(0.125) == Decimal("0.13")
        assert round_city_coord(0.135) == Decimal("0.14")

    def test_already_round_is_untouched(self):
        assert round_city_coord(Decimal("40.42")) == Decimal("40.42")
        assert round_city_coord(0) == Decimal("0.00")

    def test_two_decimals_is_about_a_kilometre(self):
        """The granularity we promise: a city, not a street."""
        assert haversine_km(40.42, -3.70, 40.43, -3.70) < 1.2

    @pytest.mark.asyncio
    async def test_reverse_geocode_never_sends_or_returns_exact_coords(self):
        slot, mocked, calls = _geocoder(MADRID_PAYLOAD, "Europe/Madrid")
        with slot, mocked:
            place = await reverse_geocode(*MADRID_EXACT)

        assert place is not None
        # What came back is the city grid point, not where the device was.
        assert (place.latitude, place.longitude) == MADRID_CITY
        nominatim = next(c for c in calls if c.url.host == "nominatim.openstreetmap.org")
        assert nominatim.url.params["lat"] == "40.42"
        assert nominatim.url.params["lon"] == "-3.70"
        # No part of the precise fix is anywhere in the outbound URL.
        assert "40.4167" not in str(nominatim.url)
        assert "3.70379" not in str(nominatim.url)

    @pytest.mark.asyncio
    async def test_reverse_geocode_failure_logs_only_rounded_coords(self, caplog):
        def boom(request):
            raise httpx.ConnectError("down", request=request)

        mocked, _ = _transport(boom)
        with (
            patch.object(geocoding_service, "wait_for_nominatim_slot", AsyncMock()),
            mocked,
            caplog.at_level("WARNING"),
            pytest.raises(geocoding_service.GeocodingError),
        ):
            await reverse_geocode(*MADRID_EXACT)

        logged = caplog.text
        assert "40.42" in logged
        assert "40.4167" not in logged

    @pytest.mark.asyncio
    async def test_nearby_precise_readings_share_one_cache_entry(self, geo_redis):
        """Rounding first also means two fixes in the same block hit the cache."""
        slot, mocked, calls = _geocoder(MADRID_PAYLOAD, "Europe/Madrid")
        with slot, mocked:
            await reverse_geocode(40.4167, -3.7038)
            await reverse_geocode(40.4171, -3.7041)

        nominatim_calls = [c for c in calls if c.url.host == "nominatim.openstreetmap.org"]
        assert len(nominatim_calls) == 1
        assert await geo_redis.exists("geo:reverse:es:40.42,-3.7")


class TestTravelThreshold:
    def test_madrid_to_lisbon_is_a_trip(self):
        km = haversine_km(*MADRID_CITY, *LISBON_EXACT)
        assert 480 < km < 520
        assert is_travelling(km)

    def test_commuting_inside_a_metro_area_is_not(self):
        # Madrid -> Alcalá de Henares, ~30 km.
        km = haversine_km(40.42, -3.70, 40.48, -3.37)
        assert km < TRAVEL_DISTANCE_KM
        assert not is_travelling(km)

    def test_threshold_is_exclusive(self):
        assert not is_travelling(TRAVEL_DISTANCE_KM)
        assert is_travelling(TRAVEL_DISTANCE_KM + 0.1)

    def test_no_saved_city_is_never_a_trip(self):
        assert distance_from_saved_km(None, None, 40.42, -3.70) is None
        assert not is_travelling(None)

    def test_distance_accepts_the_stored_decimals(self):
        km = distance_from_saved_km(Decimal("40.42"), Decimal("-3.70"), 38.72, -9.14)
        assert km is not None and 480 < km < 520

    def test_haversine_is_symmetric_and_zero_at_a_point(self):
        assert haversine_km(40.42, -3.70, 40.42, -3.70) == 0
        assert haversine_km(40.42, -3.70, 38.72, -9.14) == pytest.approx(
            haversine_km(38.72, -9.14, 40.42, -3.70)
        )

    def test_prompt_is_capped_at_once_a_day(self):
        now = datetime(2026, 9, 25, 9, 0, tzinfo=UTC)
        assert travel_prompt_allowed(None, now)
        assert not travel_prompt_allowed(now - timedelta(hours=3), now)
        assert not travel_prompt_allowed(now - timedelta(hours=23, minutes=59), now)
        assert travel_prompt_allowed(now - timedelta(days=1), now)


class TestLabels:
    def test_city_label_is_the_full_place(self):
        place = Place("Madrid", "Comunidad de Madrid", "España", "ES", 40.42, -3.7, "Europe/Madrid")
        assert city_label(place) == "Madrid, Comunidad de Madrid, España"

    def test_city_label_fits_the_column(self):
        place = Place("x" * 150, None, None, None, 0.0, 0.0, None)
        assert len(city_label(place)) == 100

    def test_short_city_name(self):
        assert short_city_name("Madrid, Comunidad de Madrid, España") == "Madrid"
        assert short_city_name(None) is None
        assert short_city_name("") is None


class TestDeviceLocationEndpoint:
    @pytest.mark.asyncio
    async def test_button_saves_city_and_zone_rounded(
        self, client: AsyncClient, auth_headers, test_user, db_session
    ):
        slot, mocked, calls = _geocoder(MADRID_PAYLOAD, "Europe/Madrid")
        with slot, mocked:
            r = await client.post(
                DEVICE_URL,
                headers=auth_headers,
                json={"latitude": MADRID_EXACT[0], "longitude": MADRID_EXACT[1]},
            )

        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "saved"
        assert body["detected"]["name"] == "Madrid"
        assert body["detected"]["label"] == "Madrid, Comunidad de Madrid, España"
        assert body["detected"]["latitude"] == 40.42
        assert body["timezone"] == "Europe/Madrid"
        assert body["timezone_source"] == "auto"

        await db_session.refresh(test_user)
        assert test_user.location_name == "Madrid, Comunidad de Madrid, España"
        # The stored row holds the city grid point, never the device's fix.
        assert float(test_user.location_lat) == 40.42
        assert float(test_user.location_lon) == -3.70
        assert test_user.timezone == "Europe/Madrid"
        assert test_user.timezone_source == "auto"
        assert calls  # the provider was actually consulted

    @pytest.mark.asyncio
    async def test_button_near_saved_city_just_saves(
        self, client: AsyncClient, auth_headers, test_user, db_session
    ):
        test_user.location_lat = Decimal("40.48")
        test_user.location_lon = Decimal("-3.37")
        test_user.location_name = "Alcalá de Henares, Comunidad de Madrid, España"
        await db_session.commit()

        slot, mocked, _ = _geocoder(MADRID_PAYLOAD, "Europe/Madrid")
        with slot, mocked:
            r = await client.post(
                DEVICE_URL,
                headers=auth_headers,
                json={"latitude": MADRID_EXACT[0], "longitude": MADRID_EXACT[1]},
            )

        assert r.json()["status"] == "saved"
        await db_session.refresh(test_user)
        assert test_user.location_name.startswith("Madrid")

    @pytest.mark.asyncio
    async def test_button_far_away_asks_instead_of_moving(
        self, client: AsyncClient, auth_headers, test_user, db_session
    ):
        test_user.location_lat = Decimal("40.42")
        test_user.location_lon = Decimal("-3.70")
        test_user.location_name = "Madrid, Comunidad de Madrid, España"
        test_user.timezone = "Europe/Madrid"
        await db_session.commit()

        slot, mocked, _ = _geocoder(LISBON_PAYLOAD, "Europe/Lisbon")
        with slot, mocked:
            r = await client.post(
                DEVICE_URL,
                headers=auth_headers,
                json={"latitude": LISBON_EXACT[0], "longitude": LISBON_EXACT[1]},
            )

        body = r.json()
        assert body["status"] == "travel_suspected"
        assert body["detected"]["name"] == "Lisboa"
        assert body["current_city"] == "Madrid"
        assert 480 < body["distance_km"] < 520

        await db_session.refresh(test_user)
        # Nothing moved, not the city and not the zone.
        assert test_user.location_name == "Madrid, Comunidad de Madrid, España"
        assert float(test_user.location_lat) == 40.42
        assert test_user.timezone == "Europe/Madrid"
        assert test_user.travel_prompt_at is not None

    @pytest.mark.asyncio
    async def test_confirm_moves_the_city(
        self, client: AsyncClient, auth_headers, test_user, db_session
    ):
        test_user.location_lat = Decimal("40.42")
        test_user.location_lon = Decimal("-3.70")
        test_user.location_name = "Madrid, Comunidad de Madrid, España"
        test_user.timezone = "Europe/Madrid"
        test_user.travel_prompt_at = datetime.now(UTC)
        await db_session.commit()

        slot, mocked, _ = _geocoder(LISBON_PAYLOAD, "Europe/Lisbon")
        with slot, mocked:
            r = await client.post(
                DEVICE_URL,
                headers=auth_headers,
                json={
                    "latitude": LISBON_EXACT[0],
                    "longitude": LISBON_EXACT[1],
                    "trigger": "confirm",
                },
            )

        assert r.json()["status"] == "saved"
        await db_session.refresh(test_user)
        # Place.label drops a region that repeats the city.
        assert test_user.location_name == "Lisboa, Portugal"
        assert test_user.timezone == "Europe/Lisbon"
        # We are where they are again, so the question starts over.
        assert test_user.travel_prompt_at is None

    @pytest.mark.asyncio
    async def test_open_never_saves_a_first_city(
        self, client: AsyncClient, auth_headers, test_user, db_session
    ):
        """The silent check is not a way around the button."""
        slot, mocked, _ = _geocoder(MADRID_PAYLOAD, "Europe/Madrid")
        with slot, mocked:
            r = await client.post(
                DEVICE_URL,
                headers=auth_headers,
                json={
                    "latitude": MADRID_EXACT[0],
                    "longitude": MADRID_EXACT[1],
                    "trigger": "open",
                },
            )

        assert r.json()["status"] == "unchanged"
        await db_session.refresh(test_user)
        assert test_user.location_name is None
        assert test_user.location_lat is None

    @pytest.mark.asyncio
    async def test_open_asks_once_a_day(
        self, client: AsyncClient, auth_headers, test_user, db_session
    ):
        test_user.location_lat = Decimal("40.42")
        test_user.location_lon = Decimal("-3.70")
        test_user.location_name = "Madrid, Comunidad de Madrid, España"
        await db_session.commit()

        async def check() -> dict:
            slot, mocked, _ = _geocoder(LISBON_PAYLOAD, "Europe/Lisbon")
            with slot, mocked:
                r = await client.post(
                    DEVICE_URL,
                    headers=auth_headers,
                    json={
                        "latitude": LISBON_EXACT[0],
                        "longitude": LISBON_EXACT[1],
                        "trigger": "open",
                    },
                )
            return r.json()

        assert (await check())["status"] == "travel_suspected"
        # Same day, second open: silence.
        assert (await check())["status"] == "unchanged"

        await db_session.refresh(test_user)
        test_user.travel_prompt_at = datetime.now(UTC) - timedelta(days=1, minutes=1)
        await db_session.commit()
        assert (await check())["status"] == "travel_suspected"

    @pytest.mark.asyncio
    async def test_manual_timezone_survives_detection(
        self, client: AsyncClient, auth_headers, test_user, db_session
    ):
        test_user.timezone = "Atlantic/Canary"
        test_user.timezone_source = "manual"
        await db_session.commit()

        slot, mocked, _ = _geocoder(MADRID_PAYLOAD, "Europe/Madrid")
        with slot, mocked:
            r = await client.post(
                DEVICE_URL,
                headers=auth_headers,
                json={"latitude": MADRID_EXACT[0], "longitude": MADRID_EXACT[1]},
            )

        assert r.json()["status"] == "saved"
        await db_session.refresh(test_user)
        assert test_user.location_name.startswith("Madrid")
        assert test_user.timezone == "Atlantic/Canary"
        assert test_user.timezone_source == "manual"

    @pytest.mark.asyncio
    async def test_unknown_place_is_404_and_changes_nothing(
        self, client: AsyncClient, auth_headers, test_user, db_session
    ):
        slot, mocked, _ = _geocoder({"error": "Unable to geocode"}, None)
        with slot, mocked:
            r = await client.post(
                DEVICE_URL, headers=auth_headers, json={"latitude": 0, "longitude": -160}
            )

        assert r.status_code == 404
        assert r.json()["detail"] == "place_not_found"
        await db_session.refresh(test_user)
        assert test_user.location_name is None

    @pytest.mark.asyncio
    async def test_provider_down_is_503(self, client: AsyncClient, auth_headers):
        def boom(request):
            raise httpx.ConnectError("down", request=request)

        mocked, _ = _transport(boom)
        with patch.object(geocoding_service, "wait_for_nominatim_slot", AsyncMock()), mocked:
            r = await client.post(
                DEVICE_URL,
                headers=auth_headers,
                json={"latitude": MADRID_EXACT[0], "longitude": MADRID_EXACT[1]},
            )
        assert r.status_code == 503
        assert r.json()["detail"] == "geocoding_unavailable"

    @pytest.mark.asyncio
    async def test_validates_coordinates(self, client: AsyncClient, auth_headers):
        r = await client.post(
            DEVICE_URL, headers=auth_headers, json={"latitude": 95, "longitude": 0}
        )
        assert r.status_code == 422

    @pytest.mark.asyncio
    async def test_requires_auth(self, client: AsyncClient):
        r = await client.post(DEVICE_URL, json={"latitude": 40.4, "longitude": -3.7})
        assert r.status_code == 401


class TestAutoTimezone:
    URL = "/api/v1/users/me/timezone/auto"

    @pytest.mark.asyncio
    async def test_saves_browser_zone_for_an_untouched_user(
        self, client: AsyncClient, auth_headers, test_user, db_session
    ):
        r = await client.post(self.URL, headers=auth_headers, json={"timezone": "Europe/Madrid"})
        assert r.status_code == 200
        assert r.json() == {
            "timezone": "Europe/Madrid",
            "timezone_source": "auto",
            "updated": True,
        }
        await db_session.refresh(test_user)
        assert test_user.timezone == "Europe/Madrid"
        assert test_user.timezone_source == "auto"

    @pytest.mark.asyncio
    async def test_never_overwrites_a_manual_choice(
        self, client: AsyncClient, auth_headers, test_user, db_session
    ):
        test_user.timezone = "Atlantic/Canary"
        test_user.timezone_source = "manual"
        await db_session.commit()

        r = await client.post(self.URL, headers=auth_headers, json={"timezone": "Europe/Madrid"})
        assert r.json() == {
            "timezone": "Atlantic/Canary",
            "timezone_source": "manual",
            "updated": False,
        }
        await db_session.refresh(test_user)
        assert test_user.timezone == "Atlantic/Canary"

    @pytest.mark.asyncio
    async def test_same_zone_is_not_an_update(
        self, client: AsyncClient, auth_headers, test_user, db_session
    ):
        test_user.timezone = "Europe/Madrid"
        await db_session.commit()
        r = await client.post(self.URL, headers=auth_headers, json={"timezone": "Europe/Madrid"})
        assert r.json()["updated"] is False

    @pytest.mark.asyncio
    async def test_legacy_browser_name_is_canonicalized(
        self, client: AsyncClient, auth_headers, test_user, db_session
    ):
        """Chrome still reports Asia/Calcutta; the slim image only has Asia/Kolkata."""
        r = await client.post(self.URL, headers=auth_headers, json={"timezone": "Asia/Calcutta"})
        assert r.json()["timezone"] == "Asia/Kolkata"
        await db_session.refresh(test_user)
        assert test_user.timezone == "Asia/Kolkata"

    @pytest.mark.asyncio
    async def test_garbage_zone_is_rejected(self, client: AsyncClient, auth_headers):
        r = await client.post(self.URL, headers=auth_headers, json={"timezone": "../etc/passwd"})
        assert r.status_code == 422

    @pytest.mark.asyncio
    async def test_patch_marks_the_zone_manual(
        self, client: AsyncClient, auth_headers, test_user, db_session
    ):
        r = await client.patch(
            "/api/v1/users/me", headers=auth_headers, json={"timezone": "Europe/Lisbon"}
        )
        assert r.status_code == 200
        assert r.json()["timezone_source"] == "manual"
        await db_session.refresh(test_user)
        assert test_user.timezone_source == "manual"

        # ...and detection now leaves it alone for good.
        r = await client.post(self.URL, headers=auth_headers, json={"timezone": "Europe/Madrid"})
        assert r.json()["updated"] is False

    @pytest.mark.asyncio
    async def test_resaving_the_same_zone_does_not_freeze_detection(
        self, client: AsyncClient, auth_headers, test_user, db_session
    ):
        """Saving the city submits the zone too; that must not count as a choice."""
        test_user.timezone = "Europe/Madrid"
        await db_session.commit()

        r = await client.patch(
            "/api/v1/users/me", headers=auth_headers, json={"timezone": "Europe/Madrid"}
        )
        assert r.json()["timezone_source"] == "auto"

    @pytest.mark.asyncio
    async def test_patch_rounds_coordinates(
        self, client: AsyncClient, auth_headers, test_user, db_session
    ):
        """Even typed-in coordinates are kept at city precision."""
        r = await client.patch(
            "/api/v1/users/me",
            headers=auth_headers,
            json={
                "location_lat": MADRID_EXACT[0],
                "location_lon": MADRID_EXACT[1],
                "location_name": "Madrid",
            },
        )
        assert r.status_code == 200
        assert r.json()["location_lat"] == 40.42
        await db_session.refresh(test_user)
        assert float(test_user.location_lat) == 40.42


class TestNoLocation:
    @pytest.mark.asyncio
    async def test_profile_reports_the_zone_source(self, client: AsyncClient, auth_headers):
        r = await client.get("/api/v1/users/me", headers=auth_headers)
        assert r.status_code == 200
        body = r.json()
        assert body["timezone_source"] == "auto"
        assert body["location_name"] is None

    @pytest.mark.asyncio
    async def test_delete_location_keeps_the_timezone(
        self, client: AsyncClient, auth_headers, test_user, db_session
    ):
        test_user.location_lat = Decimal("40.42")
        test_user.location_lon = Decimal("-3.70")
        test_user.location_name = "Madrid, Comunidad de Madrid, España"
        test_user.timezone = "Europe/Madrid"
        test_user.travel_prompt_at = datetime.now(UTC)
        await db_session.commit()

        r = await client.delete("/api/v1/users/me/location", headers=auth_headers)
        assert r.status_code == 200
        assert r.json() == {
            "location_name": None,
            "location_lat": None,
            "location_lon": None,
            "timezone": "Europe/Madrid",
            "timezone_source": "auto",
        }

        await db_session.refresh(test_user)
        assert test_user.location_name is None
        assert test_user.location_lat is None
        assert test_user.location_lon is None
        assert test_user.travel_prompt_at is None
        # The hour notifications fire at is not part of the location.
        assert test_user.timezone == "Europe/Madrid"

    @pytest.mark.asyncio
    async def test_delete_is_idempotent(self, client: AsyncClient, auth_headers):
        assert (
            await client.delete("/api/v1/users/me/location", headers=auth_headers)
        ).status_code == 200
        assert (
            await client.delete("/api/v1/users/me/location", headers=auth_headers)
        ).status_code == 200

    @pytest.mark.asyncio
    async def test_weather_without_a_location_still_degrades_as_before(
        self, client: AsyncClient, auth_headers, test_user, db_session
    ):
        """Removing the location must leave the user exactly where a new one starts."""
        assert test_user.location_lat is None
        r = await client.get("/api/v1/weather/current", headers=auth_headers)
        assert r.status_code == 400
        assert "Location not set" in r.json()["detail"]

    @pytest.mark.asyncio
    async def test_weather_after_deleting_the_location(
        self, client: AsyncClient, auth_headers, test_user, db_session
    ):
        test_user.location_lat = Decimal("40.42")
        test_user.location_lon = Decimal("-3.70")
        test_user.location_name = "Madrid, Comunidad de Madrid, España"
        await db_session.commit()

        await client.delete("/api/v1/users/me/location", headers=auth_headers)
        r = await client.get("/api/v1/weather/current", headers=auth_headers)
        assert r.status_code == 400

    @pytest.mark.asyncio
    async def test_explicit_coordinates_still_work_without_a_saved_location(
        self, client: AsyncClient, auth_headers
    ):
        """The weather endpoint's query-parameter path is untouched by any of this."""
        from app.services.weather_service import WeatherData, WeatherService

        sample = WeatherData(
            temperature=18.0,
            feels_like=17.0,
            humidity=50,
            precipitation_chance=0,
            precipitation_mm=0.0,
            wind_speed=5.0,
            condition="clear",
            condition_code=0,
            is_day=True,
            uv_index=3.0,
            timestamp=datetime.now(UTC),
        )
        with patch.object(WeatherService, "get_current_weather", AsyncMock(return_value=sample)):
            r = await client.get(
                "/api/v1/weather/current?latitude=40.42&longitude=-3.7", headers=auth_headers
            )
        assert r.status_code == 200
        assert r.json()["temperature"] == 18.0


class TestTravelPromptPersistence:
    @pytest.mark.asyncio
    async def test_prompt_timestamp_is_the_only_thing_written_when_asking(
        self, client: AsyncClient, auth_headers, test_user, db_session
    ):
        test_user.location_lat = Decimal("40.42")
        test_user.location_lon = Decimal("-3.70")
        test_user.location_name = "Madrid, Comunidad de Madrid, España"
        test_user.timezone = "Europe/Madrid"
        await db_session.commit()
        before = json.dumps(
            {
                "name": test_user.location_name,
                "lat": float(test_user.location_lat),
                "lon": float(test_user.location_lon),
                "tz": test_user.timezone,
            }
        )

        slot, mocked, _ = _geocoder(LISBON_PAYLOAD, "Europe/Lisbon")
        with slot, mocked:
            await client.post(
                DEVICE_URL,
                headers=auth_headers,
                json={
                    "latitude": LISBON_EXACT[0],
                    "longitude": LISBON_EXACT[1],
                    "trigger": "open",
                },
            )

        row = (await db_session.execute(select(User).where(User.id == test_user.id))).scalar_one()
        await db_session.refresh(row)
        after = json.dumps(
            {
                "name": row.location_name,
                "lat": float(row.location_lat),
                "lon": float(row.location_lon),
                "tz": row.timezone,
            }
        )
        assert after == before
        assert row.travel_prompt_at is not None
