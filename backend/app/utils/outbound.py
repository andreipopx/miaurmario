"""POSTs to URLs a user typed in (ntfy servers, Mattermost webhooks).

Same guard as the shop-link importer (:mod:`app.services.link_import`): https
only, every address the host resolves to must be public, the connection is
pinned to the address that was checked (no DNS rebinding in between) and
redirects are not followed. Otherwise any signed-in user could aim the backend
at the Docker network or the home LAN and read the answers back.

The one exception is the operator's own ntfy server (``NTFY_SERVER``), which is
trusted because it comes from the deployment's environment, not from a user.
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlsplit

import httpx

from app.config import get_settings
from app.services.link_import import (
    LinkImportError,
    _pinned_url,
    normalize_link_url,
    resolve_public_addresses,
)

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 15.0


class OutboundBlocked(Exception):
    """The URL points somewhere the backend must not send requests to."""


def _trusted_base(url: str) -> bool:
    trusted = (get_settings().ntfy_server or "").rstrip("/")
    return bool(trusted) and (url == trusted or url.startswith(trusted + "/"))


async def guarded_post(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    json: Any = None,
    content: str | bytes | None = None,
    timeout: float = TIMEOUT_SECONDS,
) -> httpx.Response:
    """POST to a user-supplied URL, refusing private targets. Raises :class:`OutboundBlocked`."""
    if _trusted_base(url):
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            return await client.post(url, headers=headers, json=json, content=content)

    if not url.lower().startswith("https://"):
        raise OutboundBlocked("https_required")
    try:
        normalized, host, port = normalize_link_url(url)
        addresses = await resolve_public_addresses(host, port)
    except LinkImportError as exc:
        raise OutboundBlocked(exc.reason) from None

    parts = urlsplit(normalized)
    target = _pinned_url(addresses[0], port, parts.path, parts.query)
    send_headers = {**(headers or {}), "Host": parts.netloc}
    async with httpx.AsyncClient(
        timeout=timeout, follow_redirects=False, trust_env=False
    ) as client:
        return await client.post(
            target,
            headers=send_headers,
            json=json,
            content=content,
            extensions={"sni_hostname": host},
        )
