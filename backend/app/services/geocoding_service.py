"""City search (forward geocoding) and "use my location" (reverse geocoding).

- Search goes to the Open-Meteo geocoding API (free, no key, returns the
  IANA timezone for every place).
- Reverse geocoding goes to Nominatim (OpenStreetMap), which Open-Meteo does
  not offer. Nominatim's usage policy requires an identifying User-Agent and
  at most 1 request per second per application, enforced here with a small
  Redis-backed throttle shared by every worker process.
- The timezone for a reverse-geocoded point is looked up through the
  Open-Meteo forecast API (``timezone=auto``), which reports the zone of the
  grid cell.

Results are cached in Redis; Redis being down degrades to uncached lookups.
"""

import asyncio
import json
import logging
import time
from dataclasses import asdict, dataclass

import httpx
import redis.asyncio as aioredis

from app.config import get_settings
from app.utils.redis_lock import get_redis

logger = logging.getLogger(__name__)

OPEN_METEO_GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"

SEARCH_CACHE_PREFIX = "geo:search:"
SEARCH_CACHE_TTL = 60 * 60 * 24 * 7  # a week; place names do not move
REVERSE_CACHE_PREFIX = "geo:reverse:"
REVERSE_CACHE_TTL = 60 * 60 * 24 * 30
SEARCH_RESULT_COUNT = 8
MIN_QUERY_LENGTH = 2
MAX_QUERY_LENGTH = 100

NOMINATIM_THROTTLE_KEY = "geo:nominatim:throttle"
NOMINATIM_MIN_INTERVAL_MS = 1000
NOMINATIM_MAX_WAIT_S = 5.0

# In-process fallback when Redis is unavailable: monotonic time of the next free slot.
_local_nominatim_next_slot = 0.0


class GeocodingError(Exception):
    """The upstream geocoding provider failed or returned garbage."""


class GeocodingBusyError(GeocodingError):
    """The shared Nominatim slot stayed busy for too long."""


@dataclass
class Place:
    name: str
    admin1: str | None
    country: str | None
    country_code: str | None
    latitude: float
    longitude: float
    timezone: str | None

    @property
    def label(self) -> str:
        parts: list[str] = [self.name]
        for part in (self.admin1, self.country):
            if part and part not in parts:
                parts.append(part)
        return ", ".join(parts)

    def to_dict(self) -> dict:
        data = asdict(self)
        data["label"] = self.label
        return data

    @classmethod
    def from_dict(cls, data: dict) -> "Place":
        return cls(
            name=data["name"],
            admin1=data.get("admin1"),
            country=data.get("country"),
            country_code=data.get("country_code"),
            latitude=float(data["latitude"]),
            longitude=float(data["longitude"]),
            timezone=data.get("timezone"),
        )


def normalize_query(query: str) -> str:
    return " ".join(query.split()).strip()[:MAX_QUERY_LENGTH]


def _user_agent() -> str:
    return get_settings().get_geocoding_user_agent()


def _http_client(**kwargs) -> httpx.AsyncClient:
    """Single construction point for outbound clients (tests swap the transport)."""
    return httpx.AsyncClient(**kwargs)


async def _cache_get(key: str) -> str | None:
    try:
        redis = await get_redis()
        raw = await redis.get(key)
    except aioredis.RedisError:
        logger.debug("Redis unavailable for geo cache read (%s)", key)
        return None
    if raw is None:
        return None
    return raw.decode() if isinstance(raw, bytes) else raw


async def _cache_set(key: str, value: str, ttl: int) -> None:
    try:
        redis = await get_redis()
        await redis.set(key, value, ex=ttl)
    except aioredis.RedisError:
        logger.debug("Redis unavailable for geo cache write (%s)", key)


async def wait_for_nominatim_slot() -> None:
    """Block until this process may call Nominatim (≤ 1 req/s app-wide).

    Uses ``SET NX PX`` so the slot is shared across API workers and the arq
    worker. Falls back to a per-process lock when Redis is down.
    """
    deadline = time.monotonic() + NOMINATIM_MAX_WAIT_S
    try:
        redis = await get_redis()
        while True:
            acquired = await redis.set(
                NOMINATIM_THROTTLE_KEY, "1", nx=True, px=NOMINATIM_MIN_INTERVAL_MS
            )
            if acquired:
                return
            if time.monotonic() >= deadline:
                raise GeocodingBusyError("Nominatim throttle slot busy")
            ttl_ms = await redis.pttl(NOMINATIM_THROTTLE_KEY)
            wait_s = max(ttl_ms, 50) / 1000 if ttl_ms and ttl_ms > 0 else 0.05
            await asyncio.sleep(min(wait_s, max(deadline - time.monotonic(), 0.01)))
    except (aioredis.RedisError, OSError, RuntimeError):
        # Redis down (or unusable from this event loop): throttle per process.
        global _local_nominatim_next_slot
        now = time.monotonic()
        slot = max(now, _local_nominatim_next_slot)
        # Reserve the slot before sleeping so concurrent callers queue up.
        _local_nominatim_next_slot = slot + NOMINATIM_MIN_INTERVAL_MS / 1000
        if slot - now > NOMINATIM_MAX_WAIT_S:
            raise GeocodingBusyError("Nominatim throttle slot busy") from None
        if slot > now:
            await asyncio.sleep(slot - now)


def _parse_open_meteo_results(data: object) -> list[Place]:
    if not isinstance(data, dict):
        raise GeocodingError("Unexpected geocoding response shape")
    results = data.get("results") or []
    if not isinstance(results, list):
        return []
    places: list[Place] = []
    seen: set[tuple[str, str | None, str | None]] = set()
    for row in results:
        if not isinstance(row, dict):
            continue
        try:
            name = str(row["name"])
            lat = float(row["latitude"])
            lon = float(row["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        key = (name, row.get("admin1"), row.get("country"))
        if key in seen:
            continue
        seen.add(key)
        places.append(
            Place(
                name=name,
                admin1=row.get("admin1") or None,
                country=row.get("country") or None,
                country_code=(row.get("country_code") or None),
                latitude=lat,
                longitude=lon,
                timezone=row.get("timezone") or None,
            )
        )
    return places


async def search_places(query: str, language: str = "es") -> list[Place]:
    q = normalize_query(query)
    if len(q) < MIN_QUERY_LENGTH:
        return []
    lang = language if language in {"es", "en"} else "es"
    cache_key = f"{SEARCH_CACHE_PREFIX}{lang}:{q.lower()}"

    cached = await _cache_get(cache_key)
    if cached is not None:
        try:
            return [Place.from_dict(d) for d in json.loads(cached)]
        except (ValueError, KeyError, TypeError):
            logger.debug("Discarding undecodable geo search cache entry %s", cache_key)

    params = {"name": q, "count": SEARCH_RESULT_COUNT, "language": lang, "format": "json"}
    async with _http_client(
        timeout=8.0, headers={"User-Agent": _user_agent()}, follow_redirects=True
    ) as client:
        try:
            response = await client.get(OPEN_METEO_GEOCODING_URL, params=params)
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError) as e:
            logger.warning("Open-Meteo geocoding failed for %r: %s", q, e)
            raise GeocodingError(f"Geocoding search failed: {e}") from None

    places = _parse_open_meteo_results(data)
    await _cache_set(cache_key, json.dumps([asdict(p) for p in places]), SEARCH_CACHE_TTL)
    return places


async def lookup_timezone(latitude: float, longitude: float) -> str | None:
    """IANA timezone of a point, via Open-Meteo's ``timezone=auto``."""
    params = {
        "latitude": round(latitude, 4),
        "longitude": round(longitude, 4),
        "timezone": "auto",
        "forecast_days": 1,
        "daily": "weather_code",
    }
    base = get_settings().openmeteo_url.rstrip("/")
    async with _http_client(timeout=8.0) as client:
        try:
            response = await client.get(f"{base}/forecast", params=params)
            response.raise_for_status()
            tz = response.json().get("timezone")
        except (httpx.HTTPError, ValueError, AttributeError) as e:
            logger.info("Timezone lookup failed for %s,%s: %s", latitude, longitude, e)
            return None
    return tz if isinstance(tz, str) and tz and tz != "GMT" else None


def _parse_nominatim_reverse(data: object, latitude: float, longitude: float) -> Place | None:
    if not isinstance(data, dict) or data.get("error"):
        return None
    address = data.get("address") or {}
    if not isinstance(address, dict):
        address = {}
    name = (
        address.get("city")
        or address.get("town")
        or address.get("village")
        or address.get("municipality")
        or address.get("hamlet")
        or address.get("suburb")
        or address.get("county")
    )
    if not name:
        display = data.get("display_name")
        if isinstance(display, str) and display:
            name = display.split(",")[0].strip()
    if not name:
        return None
    country_code = address.get("country_code")
    return Place(
        name=str(name),
        admin1=address.get("state") or address.get("region") or address.get("province"),
        country=address.get("country"),
        country_code=country_code.upper() if isinstance(country_code, str) else None,
        latitude=latitude,
        longitude=longitude,
        timezone=None,
    )


async def reverse_geocode(latitude: float, longitude: float, language: str = "es") -> Place | None:
    lang = language if language in {"es", "en"} else "es"
    # ~1 km grid: good enough for a city name and keeps the cache useful.
    lat_r, lon_r = round(latitude, 2), round(longitude, 2)
    cache_key = f"{REVERSE_CACHE_PREFIX}{lang}:{lat_r},{lon_r}"

    cached = await _cache_get(cache_key)
    if cached is not None:
        try:
            payload = json.loads(cached)
            return Place.from_dict(payload) if payload else None
        except (ValueError, KeyError, TypeError):
            logger.debug("Discarding undecodable reverse cache entry %s", cache_key)

    await wait_for_nominatim_slot()
    params = {
        "lat": f"{latitude:.5f}",
        "lon": f"{longitude:.5f}",
        "format": "jsonv2",
        "zoom": 10,
        "addressdetails": 1,
        "accept-language": lang,
    }
    async with _http_client(
        timeout=8.0, headers={"User-Agent": _user_agent()}, follow_redirects=True
    ) as client:
        try:
            response = await client.get(NOMINATIM_REVERSE_URL, params=params)
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError) as e:
            logger.warning("Nominatim reverse failed for %s,%s: %s", latitude, longitude, e)
            raise GeocodingError(f"Reverse geocoding failed: {e}") from None

    place = _parse_nominatim_reverse(data, latitude, longitude)
    if place is not None:
        place.timezone = await lookup_timezone(latitude, longitude)
    await _cache_set(cache_key, json.dumps(asdict(place) if place else None), REVERSE_CACHE_TTL)
    return place
