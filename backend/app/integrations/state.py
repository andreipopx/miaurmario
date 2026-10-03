"""OAuth CSRF state store shared by all integrations.

State tokens live in Redis with a 10-minute TTL, namespaced per provider and
bound to the requesting user_id, so a leaked authorize URL cannot be replayed
against another account. Each state is single-use.

They are also bound to the browser that asked for them: ``/connect`` sets a
short-lived HttpOnly cookie and the callback must bring it back. Without that,
someone could send their own authorize URL to a victim and have the victim's
Spotify or Last.fm attached to the sender's Miaurmario account.
"""

import hashlib
import hmac
import secrets

from arq import create_pool
from fastapi import Request, Response

from app.workers.settings import get_redis_settings

STATE_TTL_SECONDS = 600


class OAuthStateError(RuntimeError):
    pass


def _key(provider: str, state: str) -> str:
    return f"{provider}:oauth:state:{state}"


def _cookie(provider: str) -> str:
    return f"mm_oauth_{provider}"


def _digest(nonce: str) -> str:
    return hashlib.sha256(nonce.encode()).hexdigest()


def bind_browser(request: Request, response: Response, provider: str) -> str:
    """Set the browser half of the state on ``response``; returns the nonce to store."""
    nonce = secrets.token_urlsafe(24)
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    response.set_cookie(
        _cookie(provider),
        nonce,
        max_age=STATE_TTL_SECONDS,
        path=f"/api/v1/integrations/{provider}",
        httponly=True,
        secure=scheme == "https",
        # Lax: the callback is a top-level redirect from the provider, which Lax allows.
        samesite="lax",
    )
    return nonce


def browser_nonce(request: Request, provider: str) -> str | None:
    return request.cookies.get(_cookie(provider))


def forget_browser(response: Response, provider: str) -> None:
    response.delete_cookie(_cookie(provider), path=f"/api/v1/integrations/{provider}")


async def create_state(provider: str, user_id: str, browser: str | None = None) -> str:
    state = secrets.token_urlsafe(32)
    value = user_id if browser is None else f"{user_id}|{_digest(browser)}"
    redis = await create_pool(get_redis_settings())
    try:
        await redis.set(_key(provider, state), value, ex=STATE_TTL_SECONDS)
    finally:
        await redis.aclose()
    return state


async def consume_state(provider: str, state: str | None, browser: str | None = None) -> str:
    """Validate and delete the state token; return the user_id it was issued for."""
    if not state:
        raise OAuthStateError("state token is missing")
    key = _key(provider, state)
    redis = await create_pool(get_redis_settings())
    try:
        raw = await redis.get(key)
        if raw is not None:
            await redis.delete(key)
    finally:
        await redis.aclose()
    if raw is None:
        raise OAuthStateError("state token is missing, expired, or already consumed")
    value = raw.decode() if isinstance(raw, (bytes, bytearray)) else str(raw)
    user_id, _, bound = value.partition("|")
    if bound and (browser is None or not hmac.compare_digest(bound, _digest(browser))):
        raise OAuthStateError("state token was issued to another browser")
    return user_id
