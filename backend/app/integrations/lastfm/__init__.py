"""Last.fm integration package (music source for users without Spotify)."""

from app.integrations.lastfm.client import (
    LastfmClient,
    LastfmError,
    LastfmRateLimited,
    auth_configured,
    auth_url,
    is_configured,
)

__all__ = [
    "LastfmClient",
    "LastfmError",
    "LastfmRateLimited",
    "auth_configured",
    "auth_url",
    "is_configured",
]
