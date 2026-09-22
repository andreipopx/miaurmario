"""Minimal async Last.fm Web API client (read-only + web auth).

Every request goes through a Redis token bucket shared by the API and the
worker (Last.fm allows ~5 req/s per IP), and error 29 ("rate limit exceeded")
is retried once after a short back-off; a second 29 opens a short global
cooldown so neither the cron nor on-demand syncs keep hammering the API.

Docs: https://www.last.fm/api
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from typing import Any
from urllib.parse import urlencode

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

API_BASE = "https://ws.audioscrobbler.com/2.0/"
AUTH_URL = "https://www.last.fm/api/auth/"
DEFAULT_TIMEOUT = 8.0

# Error codes (https://www.last.fm/api/errorcodes).
ERR_INVALID_PARAMS = 6  # also "User not found"
ERR_INVALID_KEY = 10
ERR_OPERATION_FAILED = 8
ERR_SERVICE_OFFLINE = 11
ERR_TEMPORARY = 16
ERR_LOGIN_REQUIRED = 17  # profile hides its recent tracks
ERR_SUSPENDED_KEY = 26
ERR_RATE_LIMIT = 29
ERR_UNAUTHORIZED_TOKEN = 14
ERR_TOKEN_EXPIRED = 15

RATE_BUCKET_KEY = "lastfm:ratelimit:bucket"
COOLDOWN_KEY = "lastfm:ratelimit:cooldown"
COOLDOWN_SECONDS = 60
BACKOFF_SECONDS = 2.0
MAX_BUCKET_WAITS = 20

# Token bucket: refill `rate` tokens/s up to `capacity`; returns the seconds to
# wait (0 = a token was taken). Float state lives in a hash.
_BUCKET_LUA = """
local rate = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(data[1]) or capacity
local ts = tonumber(data[2]) or now
if now > ts then
  tokens = math.min(capacity, tokens + (now - ts) * rate)
  ts = now
end
local wait = 0
if tokens >= 1 then
  tokens = tokens - 1
else
  wait = (1 - tokens) / rate
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(ts))
redis.call('PEXPIRE', KEYS[1], 60000)
return tostring(wait)
"""


class LastfmError(RuntimeError):
    def __init__(self, message: str, code: int | None = None, status_code: int | None = None):
        super().__init__(message)
        self.code = code
        self.status_code = status_code

    @property
    def not_found(self) -> bool:
        return self.code == ERR_INVALID_PARAMS and "not found" in str(self).lower()

    @property
    def private(self) -> bool:
        return self.code == ERR_LOGIN_REQUIRED

    @property
    def rate_limited(self) -> bool:
        return self.code == ERR_RATE_LIMIT

    @property
    def bad_key(self) -> bool:
        return self.code in (ERR_INVALID_KEY, ERR_SUSPENDED_KEY)

    @property
    def reason(self) -> str:
        """Short machine code stored on the connection / returned to the UI."""
        if self.not_found:
            return "not_found"
        if self.private:
            return "private"
        if self.rate_limited:
            return "rate_limited"
        if self.bad_key:
            return "bad_key"
        return "unavailable"


class LastfmRateLimited(LastfmError):
    def __init__(self, message: str = "Last.fm rate limit exceeded"):
        super().__init__(message, code=ERR_RATE_LIMIT)


def is_configured() -> bool:
    return bool(get_settings().lastfm_api_key)


def auth_configured() -> bool:
    s = get_settings()
    return bool(s.lastfm_api_key and s.lastfm_api_secret)


def sign(params: dict[str, Any], secret: str) -> str:
    """api_sig: md5 of the alphabetically sorted name+value pairs + secret."""
    raw = "".join(
        f"{k}{params[k]}" for k in sorted(params) if k not in ("format", "callback", "api_sig")
    )
    return hashlib.md5((raw + secret).encode("utf-8")).hexdigest()  # noqa: S324 - API contract


def auth_url(callback_url: str) -> str:
    return f"{AUTH_URL}?{urlencode({'api_key': get_settings().lastfm_api_key, 'cb': callback_url})}"


# --- rate limiting ---------------------------------------------------------------------

_local_lock = asyncio.Lock()
_local_last = 0.0


async def _local_throttle(rate: float) -> None:
    """Fallback when Redis is unreachable: space calls in this process."""
    global _local_last
    async with _local_lock:
        wait = _local_last + 1.0 / rate - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        _local_last = time.monotonic()


async def _redis():
    from app.utils.redis_lock import get_redis

    return await get_redis()


async def acquire_token() -> None:
    """Block until the shared bucket hands out a request slot."""
    settings = get_settings()
    rate = float(settings.lastfm_requests_per_second)
    capacity = max(1.0, rate)
    try:
        redis = await _redis()
        for _ in range(MAX_BUCKET_WAITS):
            wait = float(
                await redis.eval(_BUCKET_LUA, 1, RATE_BUCKET_KEY, rate, capacity, time.time())
            )
            if wait <= 0:
                return
            await asyncio.sleep(min(wait, 2.0))
        return
    except Exception:
        logger.debug("Last.fm Redis token bucket unavailable; throttling locally", exc_info=True)
    await _local_throttle(rate)


async def in_cooldown() -> bool:
    try:
        return bool(await (await _redis()).exists(COOLDOWN_KEY))
    except Exception:
        return False


async def start_cooldown() -> None:
    try:
        await (await _redis()).set(COOLDOWN_KEY, "1", ex=COOLDOWN_SECONDS)
    except Exception:
        logger.debug("Could not set Last.fm cooldown", exc_info=True)


# --- client -------------------------------------------------------------------------------


def _as_list(value: Any) -> list[Any]:
    """Last.fm returns a bare object instead of a 1-element list."""
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


class LastfmClient:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        api_secret: str | None = None,
        session_key: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
    ):
        settings = get_settings()
        self.api_key = api_key or settings.lastfm_api_key
        self.api_secret = api_secret or settings.lastfm_api_secret
        self.session_key = session_key
        self.timeout = timeout
        if not self.api_key:
            raise LastfmError("LASTFM_API_KEY not configured", code=ERR_INVALID_KEY)

    async def call(self, method: str, **params: Any) -> dict[str, Any]:
        """GET a method; retries a rate-limit answer once after BACKOFF_SECONDS."""
        if await in_cooldown():
            raise LastfmRateLimited("Last.fm cooldown active")
        query: dict[str, Any] = {
            "method": method,
            "api_key": self.api_key,
            **{k: v for k, v in params.items() if v is not None},
        }
        signed = bool(self.session_key and self.api_secret) or method.startswith("auth.")
        if self.session_key and self.api_secret:
            query["sk"] = self.session_key
        if signed:
            if not self.api_secret:
                raise LastfmError("LASTFM_API_SECRET not configured")
            query = {k: str(v) for k, v in query.items()}
            query["api_sig"] = sign(query, self.api_secret)
        query["format"] = "json"

        for attempt in range(2):
            await acquire_token()
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as http:
                    resp = await http.get(API_BASE, params=query)
            except httpx.HTTPError as exc:
                raise LastfmError(f"Last.fm request failed: {type(exc).__name__}") from exc
            try:
                data = resp.json()
            except ValueError:
                data = None
            if isinstance(data, dict) and "error" in data:
                try:
                    code = int(data.get("error"))
                except (TypeError, ValueError):
                    code = None
                message = str(data.get("message") or "Last.fm error")
                if code == ERR_RATE_LIMIT:
                    if attempt == 0:
                        logger.info("Last.fm rate limit (29); backing off %.1fs", BACKOFF_SECONDS)
                        await asyncio.sleep(BACKOFF_SECONDS)
                        continue
                    await start_cooldown()
                    raise LastfmRateLimited(message)
                raise LastfmError(message, code=code, status_code=resp.status_code)
            if resp.status_code == 429:
                if attempt == 0:
                    await asyncio.sleep(BACKOFF_SECONDS)
                    continue
                await start_cooldown()
                raise LastfmRateLimited()
            if resp.status_code >= 400 or not isinstance(data, dict):
                raise LastfmError(f"Last.fm HTTP {resp.status_code}", status_code=resp.status_code)
            return data
        raise LastfmRateLimited()  # pragma: no cover - loop always returns/raises

    # --- methods --------------------------------------------------------------------------

    async def user_info(self, user: str) -> dict[str, Any]:
        data = await self.call("user.getInfo", user=user)
        return data.get("user") or {}

    async def recent_tracks(
        self,
        user: str,
        *,
        limit: int = 200,
        page: int = 1,
        from_uts: int | None = None,
        extended: bool = True,
    ) -> dict[str, Any]:
        """{"tracks": [...], "page": n, "total_pages": n, "total": n}."""
        data = await self.call(
            "user.getRecentTracks",
            user=user,
            limit=limit,
            page=page,
            extended=1 if extended else 0,
            **({"from": from_uts} if from_uts is not None else {}),
        )
        root = data.get("recenttracks") or {}
        attr = root.get("@attr") or {}

        def _int(v: Any, default: int) -> int:
            try:
                return int(v)
            except (TypeError, ValueError):
                return default

        return {
            "tracks": [t for t in _as_list(root.get("track")) if isinstance(t, dict)],
            "page": _int(attr.get("page"), page),
            "total_pages": _int(attr.get("totalPages"), 1),
            "total": _int(attr.get("total"), 0),
        }

    async def top_artists(self, user: str, period: str, limit: int = 10) -> list[dict[str, Any]]:
        data = await self.call("user.getTopArtists", user=user, period=period, limit=limit)
        return [a for a in _as_list((data.get("topartists") or {}).get("artist")) if a]

    async def top_tracks(self, user: str, period: str, limit: int = 10) -> list[dict[str, Any]]:
        data = await self.call("user.getTopTracks", user=user, period=period, limit=limit)
        return [t for t in _as_list((data.get("toptracks") or {}).get("track")) if t]

    async def artist_top_tags(self, artist: str) -> list[dict[str, Any]]:
        data = await self.call("artist.getTopTags", artist=artist, autocorrect=1)
        return [t for t in _as_list((data.get("toptags") or {}).get("tag")) if t]

    async def get_session(self, token: str) -> dict[str, Any]:
        data = await self.call("auth.getSession", token=token)
        return data.get("session") or {}
