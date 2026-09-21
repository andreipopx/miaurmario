"""Spotify integration package (mood input for the Stylist)."""

from app.integrations.spotify.client import SpotifyAPIError, SpotifyClient
from app.integrations.spotify.oauth import (
    DEFAULT_SCOPES,
    OAuthStateError,
    SpotifyTokenError,
    build_authorize_url,
    consume_state,
    create_state,
    exchange_code,
    is_configured,
    refresh_access_token,
)

__all__ = [
    "DEFAULT_SCOPES",
    "OAuthStateError",
    "SpotifyAPIError",
    "SpotifyClient",
    "SpotifyTokenError",
    "build_authorize_url",
    "consume_state",
    "create_state",
    "exchange_code",
    "is_configured",
    "refresh_access_token",
]
