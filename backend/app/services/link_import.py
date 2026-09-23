"""Read a garment off a pasted shop link.

The page is fetched **server-side** and only ever parsed as markup: we read the
OpenGraph / JSON-LD / schema.org fields a shop already publishes for social
previews (name, brand, price, colour, main image) and never execute its
JavaScript, so a shop that renders everything client-side simply yields nothing
and the user falls back to manual entry with the link saved.

The URL comes from the user and points at our own network, so the fetcher is
deliberately narrow:

* ``https`` only (a pasted ``http://`` is upgraded, never followed);
* every hop is DNS-resolved and **every** resolved address must be public —
  loopback, private, link-local (which covers the 169.254.169.254 metadata
  address), CGNAT and IPv6 unique-local are refused — and the connection is
  pinned to the address we validated (``Host`` + SNI keep TLS and vhosts
  working), so a name that re-resolves to a private address between the check
  and the connection cannot be reached;
* redirects are followed by hand, at most :data:`MAX_REDIRECTS`, each hop
  re-validated from scratch;
* an allowlist of content types, a byte cap enforced while streaming and a
  wall-clock timeout on every request;
* an identifying User-Agent with a contact URL;
* pages that ask not to be indexed (``<meta name="robots" content="noindex">``
  or an ``X-Robots-Tag: noindex`` header) are fetched but not extracted;
* the remote image is re-encoded through Pillow before it reaches the user, so
  what the browser gets is a plain JPEG/PNG we produced ourselves.

Results are cached in-process by normalized URL for a few hours, which is what
keeps a user pasting the same link twice from hitting the shop twice.
"""

from __future__ import annotations

import asyncio
import io
import ipaddress
import json
import logging
import re
import socket
import time
from collections import OrderedDict
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
from PIL import Image, ImageOps

from app.config import get_settings
from app.services.ai_service import VALID_COLORS

logger = logging.getLogger(__name__)

MAX_URL_LENGTH = 2048
MAX_REDIRECTS = 3
FETCH_TIMEOUT_SECONDS = 10.0
CONNECT_TIMEOUT_SECONDS = 5.0
DNS_TIMEOUT_SECONDS = 5.0
MAX_HTML_BYTES = 1_500_000
MAX_IMAGE_BYTES = 8_000_000
MAX_IMAGE_EDGE = 1600

HTML_CONTENT_TYPES = frozenset({"text/html", "application/xhtml+xml"})
IMAGE_CONTENT_TYPES = frozenset(
    {"image/jpeg", "image/pjpeg", "image/png", "image/webp", "image/avif", "image/gif"}
)

#: Reasons that mean "we refused to go there" — the caller answers 4xx.
BLOCKED_REASONS = frozenset({"invalid_url", "https_required", "private_address", "unresolvable"})

CACHE_TTL_SECONDS = 6 * 60 * 60
CACHE_MAX_ENTRIES = 16
CACHE_MAX_IMAGE_BYTES = 2_000_000

# Extra ranges that older Pythons still call "global".
_EXTRA_BLOCKED_NETWORKS = (
    ipaddress.ip_network("100.64.0.0/10"),  # CGNAT
    ipaddress.ip_network("192.0.0.0/24"),  # IETF protocol assignments
    ipaddress.ip_network("192.0.2.0/24"),  # TEST-NET-1
    ipaddress.ip_network("198.18.0.0/15"),  # benchmarking
    ipaddress.ip_network("::/128"),
    ipaddress.ip_network("fc00::/7"),  # unique local
)


class LinkImportError(ValueError):
    """A pasted link could not be used; ``reason`` is a stable code for the UI."""

    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason
        self.message = message

    @property
    def blocked(self) -> bool:
        """True when we refused the URL itself rather than failing to read it."""
        return self.reason in BLOCKED_REASONS


@dataclass
class ProductExtraction:
    """What a shop page told us about the garment."""

    source_url: str
    name: str | None = None
    brand: str | None = None
    price: Decimal | None = None
    currency: str | None = None
    primary_color: str | None = None
    material: str | None = None
    description: str | None = None
    site_name: str | None = None
    image_url: str | None = None
    noindex: bool = False

    def has_content(self) -> bool:
        return any((self.name, self.brand, self.price, self.image_url))


@dataclass
class LinkImportResult:
    extraction: ProductExtraction
    image: bytes | None = None
    image_content_type: str | None = None
    reason: str | None = None  # why the result is thin, when it is

    @property
    def extracted(self) -> bool:
        return self.extraction.has_content()


# --- URL validation -----------------------------------------------------------


def _ip_is_public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if not ip.is_global or ip.is_multicast:
        return False
    return not any(ip in net for net in _EXTRA_BLOCKED_NETWORKS if net.version == ip.version)


def normalize_link_url(url: str) -> tuple[str, str, int]:
    """Syntactic checks on a pasted link. Returns ``(normalized, host, port)``.

    A bare ``zara.com/...`` or an ``http://`` link is upgraded to https rather
    than rejected — people paste what the address bar shows them — but nothing
    else about the URL is guessed at. The query string is kept (shops need it);
    the fragment is dropped.
    """
    raw = (url or "").strip()
    if not raw:
        raise LinkImportError("invalid_url", "Paste a link first")
    if len(raw) > MAX_URL_LENGTH:
        raise LinkImportError("invalid_url", "That link is too long")
    if "://" not in raw:
        raw = f"https://{raw}"

    try:
        parts = urlsplit(raw)
        port = parts.port
    except ValueError:
        raise LinkImportError("invalid_url", "That does not look like a link") from None

    scheme = parts.scheme.lower()
    if scheme == "http":
        scheme = "https"
    if scheme != "https":
        raise LinkImportError("https_required", "Only https links can be imported")
    if not parts.hostname:
        raise LinkImportError("invalid_url", "That link has no site in it")
    if parts.username or parts.password:
        raise LinkImportError("invalid_url", "Links with credentials are not allowed")

    host = parts.hostname.lower().rstrip(".")
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        raise LinkImportError("private_address", "Local addresses are not allowed")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None and not _ip_is_public(literal):
        raise LinkImportError("private_address", "Private or local addresses are not allowed")

    netloc = parts.netloc.split("@")[-1]
    normalized = urlunsplit(("https", netloc, parts.path or "/", parts.query, ""))
    return normalized, host, port or 443


async def _getaddrinfo(host: str, port: int) -> list[str]:
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return [info[4][0] for info in infos]


async def resolve_public_addresses(host: str, port: int) -> list[str]:
    """Resolve ``host`` and refuse it unless *every* address is publicly routable."""
    try:
        addresses = await asyncio.wait_for(_getaddrinfo(host, port), timeout=DNS_TIMEOUT_SECONDS)
    except (OSError, TimeoutError):
        raise LinkImportError("unresolvable", "We could not reach that site") from None
    if not addresses:
        raise LinkImportError("unresolvable", "We could not reach that site")
    for address in addresses:
        try:
            ip = ipaddress.ip_address(address.split("%")[0])
        except ValueError:
            raise LinkImportError("private_address", "Unexpected address") from None
        if not _ip_is_public(ip):
            raise LinkImportError(
                "private_address", "That site resolves to a private or local address"
            )
    return addresses


# --- Fetching -----------------------------------------------------------------


def _user_agent() -> str:
    return get_settings().link_import_user_agent


def _open_client() -> httpx.AsyncClient:
    """Seam: tests swap this for a client on a mock transport."""
    return httpx.AsyncClient(
        timeout=httpx.Timeout(FETCH_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS),
        follow_redirects=False,
        trust_env=False,
    )


def _pinned_url(address: str, port: int, parts_path: str, query: str) -> str:
    host = f"[{address}]" if ":" in address else address
    netloc = host if port == 443 else f"{host}:{port}"
    return urlunsplit(("https", netloc, parts_path or "/", query, ""))


@dataclass
class _Fetched:
    url: str
    content_type: str
    body: bytes
    headers: httpx.Headers


async def _fetch(
    client: httpx.AsyncClient,
    url: str,
    *,
    accept: str,
    allowed_types: frozenset[str],
    max_bytes: int,
) -> _Fetched:
    """GET ``url`` with every hop re-validated and the body capped while streaming."""
    current = url
    for _hop in range(MAX_REDIRECTS + 1):
        normalized, host, port = normalize_link_url(current)
        addresses = await resolve_public_addresses(host, port)
        parts = urlsplit(normalized)
        target = _pinned_url(addresses[0], port, parts.path, parts.query)
        headers = {
            "Host": parts.netloc,
            "User-Agent": _user_agent(),
            "Accept": accept,
            "Accept-Language": "es-ES,es;q=0.9,en;q=0.6",
        }
        try:
            async with client.stream(
                "GET", target, headers=headers, extensions={"sni_hostname": host}
            ) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("location")
                    if not location:
                        raise LinkImportError("fetch_failed", "That link led nowhere")
                    current = urljoin(normalized, location)
                    continue
                if response.status_code >= 400:
                    raise LinkImportError(
                        "fetch_failed", f"The shop answered {response.status_code}"
                    )
                content_type = response.headers.get("content-type", "")
                media_type = content_type.split(";")[0].strip().lower()
                if media_type not in allowed_types:
                    raise LinkImportError(
                        "unsupported_content_type", "That link is not a product page"
                    )
                declared = response.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > max_bytes:
                    raise LinkImportError("too_large", "That page is too big to read")

                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > max_bytes:
                        raise LinkImportError("too_large", "That page is too big to read")
                    chunks.append(chunk)
                return _Fetched(
                    url=normalized,
                    content_type=media_type,
                    body=b"".join(chunks),
                    headers=response.headers,
                )
        except httpx.TimeoutException:
            raise LinkImportError("timeout", "The shop took too long to answer") from None
        except httpx.HTTPError as exc:
            logger.info("Link import fetch failed for %s: %s", host, type(exc).__name__)
            raise LinkImportError("fetch_failed", "We could not read that page") from None

    raise LinkImportError("too_many_redirects", "That link redirects too many times")


def _decode(body: bytes, content_type: str) -> str:
    charset = None
    match = re.search(r"charset=([\w\-]+)", content_type, re.I)
    if match:
        charset = match.group(1)
    if not charset:
        head = body[:2048]
        meta = re.search(rb"charset=[\"']?([\w\-]+)", head, re.I)
        if meta:
            charset = meta.group(1).decode("ascii", "ignore")
    try:
        return body.decode(charset or "utf-8", errors="replace")
    except (LookupError, UnicodeDecodeError):
        return body.decode("utf-8", errors="replace")


# --- Parsing ------------------------------------------------------------------


class _ProductHTMLParser(HTMLParser):
    """Collects the handful of tags a product page keeps its metadata in."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.metas: list[dict[str, str]] = []
        self.jsonld: list[str] = []
        self.title: str | None = None
        self._in_title = False
        self._title_parts: list[str] = []
        self._in_jsonld = False
        self._jsonld_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            self.metas.append(attributes)
        elif tag == "title" and self.title is None:
            self._in_title = True
            self._title_parts = []
        elif tag == "script":
            script_type = attributes.get("type", "").split(";")[0].strip().lower()
            if script_type == "application/ld+json":
                self._in_jsonld = True
                self._jsonld_parts = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "title" and self._in_title:
            self._in_title = False
            self.title = "".join(self._title_parts).strip() or None
        elif tag == "script" and self._in_jsonld:
            self._in_jsonld = False
            blob = "".join(self._jsonld_parts).strip()
            if blob:
                self.jsonld.append(blob)

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self._title_parts.append(data)
        elif self._in_jsonld:
            self._jsonld_parts.append(data)


def _meta_map(metas: list[dict[str, str]]) -> dict[str, str]:
    out: dict[str, str] = {}
    for meta in metas:
        key = meta.get("property") or meta.get("name") or meta.get("itemprop")
        content = meta.get("content")
        if not key or not content:
            continue
        key = key.strip().lower()
        if key not in out:
            out[key] = content.strip()
    return out


def _is_noindex(meta: dict[str, str], headers: httpx.Headers | None) -> bool:
    values = [meta.get("robots", ""), meta.get("googlebot", "")]
    if headers is not None:
        values.append(headers.get("x-robots-tag", ""))
    return any("noindex" in value.lower() for value in values if value)


def _walk_jsonld(node: Any) -> list[dict]:
    """Flatten a JSON-LD blob into the dicts it contains (``@graph`` included)."""
    found: list[dict] = []
    if isinstance(node, list):
        for child in node:
            found.extend(_walk_jsonld(child))
    elif isinstance(node, dict):
        found.append(node)
        for key in ("@graph", "mainEntity", "hasVariant", "itemListElement"):
            if key in node:
                found.extend(_walk_jsonld(node[key]))
    return found


def _node_types(node: dict) -> list[str]:
    raw = node.get("@type") or node.get("type") or []
    if isinstance(raw, str):
        raw = [raw]
    return [str(t).lower() for t in raw if isinstance(t, str)]


def _first_string(value: Any) -> str | None:
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    if isinstance(value, list):
        for child in value:
            found = _first_string(child)
            if found:
                return found
    if isinstance(value, dict):
        for key in ("name", "url", "contentUrl", "@id", "value"):
            if key in value:
                found = _first_string(value[key])
                if found:
                    return found
    return None


_PRICE_RE = re.compile(r"\d[\d.,\s]*")


def parse_price(value: Any) -> Decimal | None:
    """Turn ``"49,95 €"`` / ``"$1,299.00"`` / ``1299`` into a Decimal, or None."""
    if isinstance(value, int | float | Decimal):
        try:
            price = Decimal(str(value))
        except InvalidOperation:
            return None
        return price if 0 < price < Decimal("1000000") else None
    if not isinstance(value, str):
        return None
    match = _PRICE_RE.search(value.replace("\xa0", " "))
    if not match:
        return None
    digits = match.group(0).strip().replace(" ", "")
    if "," in digits and "." in digits:
        # Whichever separator comes last is the decimal one.
        if digits.rfind(",") > digits.rfind("."):
            digits = digits.replace(".", "").replace(",", ".")
        else:
            digits = digits.replace(",", "")
    elif "," in digits:
        decimals = len(digits) - digits.rfind(",") - 1
        digits = digits.replace(",", "." if decimals in (1, 2) else "")
    elif digits.count(".") > 1:
        digits = digits.replace(".", "")
    digits = digits.rstrip(".")
    try:
        price = Decimal(digits)
    except InvalidOperation:
        return None
    return price if 0 < price < Decimal("1000000") else None


_CURRENCY_SYMBOLS = {"€": "EUR", "$": "USD", "£": "GBP"}


def _currency_from(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip().upper()
    if re.fullmatch(r"[A-Z]{3}", text):
        return text
    for symbol, code in _CURRENCY_SYMBOLS.items():
        if symbol in value:
            return code
    return None


#: Colour words we can recognise in a product title, mapped to the app vocabulary.
COLOR_WORDS: dict[str, str] = {
    "negro": "black",
    "negra": "black",
    "black": "black",
    "blanco": "white",
    "blanca": "white",
    "white": "white",
    "gris": "gray",
    "gray": "gray",
    "grey": "gray",
    "marino": "navy",
    "navy": "navy",
    "azul marino": "navy",
    "azul": "blue",
    "blue": "blue",
    "celeste": "light-blue",
    "azul claro": "light-blue",
    "light blue": "light-blue",
    "rojo": "red",
    "roja": "red",
    "red": "red",
    "burdeos": "burgundy",
    "granate": "burgundy",
    "burgundy": "burgundy",
    "rosa": "pink",
    "pink": "pink",
    "verde": "green",
    "green": "green",
    "oliva": "olive",
    "olive": "olive",
    "kaki": "tan",
    "caqui": "tan",
    "khaki": "tan",
    "amarillo": "yellow",
    "amarilla": "yellow",
    "yellow": "yellow",
    "naranja": "orange",
    "orange": "orange",
    "morado": "purple",
    "morada": "purple",
    "lila": "purple",
    "purple": "purple",
    "marron": "brown",
    "marrón": "brown",
    "brown": "brown",
    "camel": "tan",
    "tan": "tan",
    "beige": "beige",
    "crudo": "cream",
    "cream": "cream",
    "hueso": "cream",
    "dorado": "gold",
    "gold": "gold",
    "plateado": "silver",
    "silver": "silver",
}

_COLOR_PATTERNS = sorted(COLOR_WORDS, key=len, reverse=True)


def guess_color(*texts: str | None) -> str | None:
    """Pick a wardrobe colour out of free text (Spanish or English)."""
    for text in texts:
        if not text:
            continue
        haystack = f" {text.lower()} "
        for word in _COLOR_PATTERNS:
            # Spanish plurals: "vaqueros negros", "camisas azules".
            if re.search(rf"(?<![\w-]){re.escape(word)}(?:es|s)?(?![\w-])", haystack):
                color = COLOR_WORDS[word]
                if color in VALID_COLORS:
                    return color
    return None


def _clean_title(title: str | None, site_name: str | None) -> str | None:
    """Drop the ``| SHOP`` tail shops put in <title>."""
    if not title:
        return None
    cleaned = re.sub(r"\s+", " ", title).strip()
    for separator in ("|", "·", "—", " - ", "–"):
        if separator in cleaned:
            head, _, tail = cleaned.partition(separator)
            head, tail = head.strip(), tail.strip()
            if site_name and site_name.lower() in tail.lower() and head:
                cleaned = head
                break
            if site_name and site_name.lower() in head.lower() and tail:
                cleaned = tail
                break
    return cleaned[:300] or None


def parse_product_html(
    html: str, base_url: str, headers: httpx.Headers | None = None
) -> ProductExtraction:
    """Read OpenGraph / JSON-LD / schema.org fields out of a product page."""
    parser = _ProductHTMLParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:  # a broken page is not an error, it is just empty
        logger.debug("Malformed HTML while importing %s", base_url)

    meta = _meta_map(parser.metas)
    extraction = ProductExtraction(source_url=base_url)
    extraction.noindex = _is_noindex(meta, headers)

    product: dict = {}
    offer: dict = {}
    for blob in parser.jsonld[:20]:
        try:
            data = json.loads(blob)
        except (ValueError, TypeError):
            continue
        for node in _walk_jsonld(data):
            types = _node_types(node)
            if not product and any("product" in t for t in types):
                product = node
            if not offer and any(t in ("offer", "aggregateoffer") for t in types):
                offer = node
    if product and not offer:
        offers = product.get("offers")
        for node in _walk_jsonld(offers) if offers is not None else []:
            if isinstance(node, dict) and ("price" in node or "lowPrice" in node):
                offer = node
                break

    site_name = meta.get("og:site_name") or None
    name = (
        _first_string(product.get("name"))
        or meta.get("og:title")
        or meta.get("twitter:title")
        or _clean_title(parser.title, site_name)
    )
    brand = (
        _first_string(product.get("brand"))
        or meta.get("product:brand")
        or meta.get("og:brand")
        or site_name
    )
    description = (
        meta.get("og:description")
        or meta.get("description")
        or _first_string(product.get("description"))
    )

    price = parse_price(
        product.get("price")
        or offer.get("price")
        or offer.get("lowPrice")
        or meta.get("product:price:amount")
        or meta.get("og:price:amount")
        or meta.get("twitter:data1")
    )
    currency = (
        _currency_from(offer.get("priceCurrency"))
        or _currency_from(product.get("priceCurrency"))
        or _currency_from(meta.get("product:price:currency"))
        or _currency_from(meta.get("og:price:currency"))
    )

    # The JSON-LD product image is the garment itself; og:image is often a
    # social card with the logo burnt in, so it is the fallback.
    image = (
        _first_string(product.get("image"))
        or meta.get("og:image:secure_url")
        or meta.get("og:image")
        or meta.get("twitter:image")
        or meta.get("twitter:image:src")
    )

    extraction.name = _clean_title(name, site_name)
    extraction.brand = (brand or "").strip()[:100] or None
    extraction.price = price
    extraction.currency = currency
    extraction.description = (description or "").strip()[:500] or None
    extraction.site_name = (site_name or "").strip()[:100] or None
    extraction.material = _first_string(product.get("material"))
    extraction.primary_color = guess_color(
        _first_string(product.get("color")),
        meta.get("product:color"),
        extraction.name,
    )
    if image:
        try:
            extraction.image_url = urljoin(base_url, image.strip())
        except ValueError:
            extraction.image_url = None
    return extraction


# --- Image ---------------------------------------------------------------------


def normalize_image(data: bytes) -> tuple[bytes, str]:
    """Re-encode a remote image ourselves, so no original bytes reach the user."""
    try:
        with Image.open(io.BytesIO(data)) as img:
            img = ImageOps.exif_transpose(img)
            has_alpha = img.mode in ("RGBA", "LA") or (
                img.mode == "P" and "transparency" in img.info
            )
            img = img.convert("RGBA" if has_alpha else "RGB")
            img.thumbnail((MAX_IMAGE_EDGE, MAX_IMAGE_EDGE), Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            if has_alpha:
                img.save(buffer, format="PNG", optimize=True)
                return buffer.getvalue(), "image/png"
            img.save(buffer, format="JPEG", quality=85)
            return buffer.getvalue(), "image/jpeg"
    except Exception:
        raise LinkImportError("image_unreadable", "We could not read that photo") from None


# --- Cache ----------------------------------------------------------------------

_cache: OrderedDict[str, tuple[float, LinkImportResult]] = OrderedDict()


def _cache_get(key: str) -> LinkImportResult | None:
    entry = _cache.get(key)
    if entry is None:
        return None
    stored_at, result = entry
    if time.monotonic() - stored_at > CACHE_TTL_SECONDS:
        _cache.pop(key, None)
        return None
    _cache.move_to_end(key)
    return result


def _cache_put(key: str, result: LinkImportResult) -> None:
    if result.image is not None and len(result.image) > CACHE_MAX_IMAGE_BYTES:
        result = LinkImportResult(extraction=result.extraction, reason=result.reason)
    _cache[key] = (time.monotonic(), result)
    _cache.move_to_end(key)
    while len(_cache) > CACHE_MAX_ENTRIES:
        _cache.popitem(last=False)


def clear_cache() -> None:
    _cache.clear()


# --- Entry point -----------------------------------------------------------------


async def import_link(url: str, *, with_image: bool = True) -> LinkImportResult:
    """Fetch a shop link and return what we could read off it.

    Raises :class:`LinkImportError` with ``blocked`` set when the URL itself is
    refused. Everything else — a 404, a timeout, a page with no metadata — comes
    back as a result with ``extracted`` False and a ``reason``, because the user
    can still save the link and type the garment in by hand.
    """
    normalized, _host, _port = normalize_link_url(url)
    cached = _cache_get(normalized)
    if cached is not None:
        return cached

    client = _open_client()
    try:
        page = await _fetch(
            client,
            normalized,
            accept="text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
            allowed_types=HTML_CONTENT_TYPES,
            max_bytes=MAX_HTML_BYTES,
        )
        extraction = parse_product_html(
            _decode(page.body, page.headers.get("content-type", "")),
            page.url,
            page.headers,
        )
        if extraction.noindex:
            result = LinkImportResult(
                extraction=ProductExtraction(source_url=page.url, noindex=True),
                reason="noindex",
            )
            _cache_put(normalized, result)
            return result

        image_bytes: bytes | None = None
        image_type: str | None = None
        reason: str | None = None if extraction.has_content() else "no_metadata"
        if with_image and extraction.image_url:
            try:
                fetched = await _fetch(
                    client,
                    extraction.image_url,
                    accept="image/*",
                    allowed_types=IMAGE_CONTENT_TYPES,
                    max_bytes=MAX_IMAGE_BYTES,
                )
                image_bytes, image_type = normalize_image(fetched.body)
            except LinkImportError as exc:
                logger.info("Link import: image skipped (%s)", exc.reason)
                reason = reason or f"image_{exc.reason}"

        result = LinkImportResult(
            extraction=extraction,
            image=image_bytes,
            image_content_type=image_type,
            reason=reason,
        )
        _cache_put(normalized, result)
        return result
    except LinkImportError as exc:
        if exc.blocked:
            raise
        return LinkImportResult(
            extraction=ProductExtraction(source_url=normalized), reason=exc.reason
        )
    finally:
        await client.aclose()
