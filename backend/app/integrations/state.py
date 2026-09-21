"""OAuth CSRF state store shared by all integrations.

State tokens live in Redis with a 10-minute TTL, namespaced per provider and
bound to the requesting user_id, so a leaked authorize URL cannot be replayed
against another account. Each state is single-use.
"""

import secrets

from arq import create_pool

from app.workers.settings import get_redis_settings

STATE_TTL_SECONDS = 600


class OAuthStateError(RuntimeError):
    pass


def _key(provider: str, state: str) -> str:
    return f"{provider}:oauth:state:{state}"


async def create_state(provider: str, user_id: str) -> str:
    state = secrets.token_urlsafe(32)
    redis = await create_pool(get_redis_settings())
    try:
        await redis.set(_key(provider, state), user_id, ex=STATE_TTL_SECONDS)
    finally:
        await redis.aclose()
    return state


async def consume_state(provider: str, state: str | None) -> str:
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
    return raw.decode() if isinstance(raw, (bytes, bytearray)) else str(raw)
