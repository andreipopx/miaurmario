"""Product data from the shops that serve it as JSON: the Inditex brands and Mango.

Their product *pages* sit behind a bot wall (a JavaScript challenge a server
cannot pass), but the JSON their own web apps read is public and answers a plain
request. That JSON is better than any page: the real name, the price, the
shop's own category, the colour with its hex, and every photo of the garment by
name, which is how the packshot (the garment alone, no model) is told apart from
the catalogue shots.

Everything here is pure: the network goes through the ``fetch_json`` callable
the caller hands in (``link_import`` passes its validated, pinned, size-capped
fetcher), so every request keeps the same SSRF guarantees as a pasted link, and
the parsing is unit-tested on canned answers.

These endpoints are not a documented API. A shop can change them any day; when
one stops answering, ``lookup`` returns ``None`` and the caller falls back to
reading the page like any other shop, so a change costs us the extras, never the
feature.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import parse_qs, quote, urlsplit

logger = logging.getLogger(__name__)

FetchJson = Callable[[str], Awaitable[Any]]

#: Photos offered per garment: enough to find the packshot, light enough to inline.
MAX_IMAGES = 4
IMAGE_WIDTH = 1200


@dataclass
class ShopProduct:
    """One product as the shop describes it."""

    shop: str
    name: str | None = None
    price: Decimal | None = None
    currency: str | None = None
    color_name: str | None = None
    color_hex: str | None = None
    #: The shop's own category words ("ABRIGO", "Pantalones"), for the type guess.
    family: str | None = None
    #: Photo URLs, the garment-alone shot first when the shop tells us which it is.
    images: list[str] = field(default_factory=list)
    url: str | None = None


# --- Inditex ------------------------------------------------------------------------


@dataclass(frozen=True)
class InditexShop:
    brand: str
    hosts: tuple[str, ...]
    base: str
    store: int
    catalog: int
    #: How the product is named in the page URL.
    url_id: str  # "zara" (-p09621716.html), "product" (c0p226927191) or "reference" (l07660304)
    #: Shot names that show the garment alone, best first (they differ per brand).
    packshots: tuple[str, ...]


INDITEX: tuple[InditexShop, ...] = (
    InditexShop(
        "Zara", ("zara.com",), "https://www.zara.com", 10701, 0, "zara", ("f1", "e1", "e2")
    ),
    InditexShop(
        "Bershka",
        ("bershka.com",),
        "https://www.bershka.com",
        44009500,
        40259530,
        "product",
        ("s", "a7o", "a4o", "b"),
    ),
    InditexShop(
        "Pull&Bear",
        ("pullandbear.com",),
        "https://www.pullandbear.com",
        24009400,
        20309459,
        "reference",
        ("c", "a6m", "a20m"),
    ),
    InditexShop(
        "Stradivarius",
        ("stradivarius.com",),
        "https://www.stradivarius.com",
        54009550,
        50109552,
        "reference",
        ("m1", "s1", "m", "s2"),
    ),
    InditexShop(
        "Massimo Dutti",
        ("massimodutti.com",),
        "https://www.massimodutti.com",
        34009450,
        30359536,
        "reference",
        ("o1", "t", "o2", "o10"),
    ),
)

_ZARA_ID = re.compile(r"-p(\d{8})\.html", re.I)
_PRODUCT_ID = re.compile(r"c0p(\d{6,12})(?:\.html)?", re.I)
_REFERENCE = re.compile(r"(?:^|[-/])l(\d{8})(?:$|[/?#.])", re.I)
#: An Inditex photo: .../{8-digit reference}{3-digit colour}-{shot name}/...jpg
_INDITEX_SHOT = re.compile(r"/(\d{8})(\d{3})-([a-z0-9]+)/[^/]+\.jpe?g", re.I)
#: Shot names that are a colour swatch, not a photo of the garment.
_SWATCHES = frozenset({"r", "r1"})


def _host_matches(host: str, domains: tuple[str, ...]) -> bool:
    host = host.lower().rstrip(".")
    return any(host == d or host.endswith(f".{d}") for d in domains)


def inditex_shop_for(host: str) -> InditexShop | None:
    return next((s for s in INDITEX if _host_matches(host, s.hosts)), None)


def inditex_shop_named(brand: str | None) -> InditexShop | None:
    """The shop a screenshot names ("ZARA", "Pull & Bear", "pullandbear")."""
    key = _fold(brand or "").replace(" ", "").replace("&", "and")
    if not key:
        return None
    for shop in INDITEX:
        names = {
            _fold(shop.brand).replace(" ", "").replace("&", "and"),
            shop.hosts[0].split(".")[0],
        }
        if key in names:
            return shop
    return None


def _cents(value: Any) -> Decimal | None:
    """Inditex prices are integer cents, as numbers or strings."""
    try:
        cents = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return (cents / 100).quantize(Decimal("0.01")) if cents > 0 else None


def _walk(node: Any):
    """Every dict and string in a JSON tree, depth-first, in document order."""
    stack = [node]
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            yield current
            stack.extend(reversed(list(current.values())))
        elif isinstance(current, list):
            stack.extend(reversed(current))
        elif isinstance(current, str):
            yield current


def inditex_images(data: Any, color: str | None, packshots: tuple[str, ...]) -> list[str]:
    """Every photo of one colour, one URL per shot name, packshots first.

    The brands nest their media differently (``xmedia``, ``xmediaItems``,
    ``bundleProductSummaries``…), but every photo URL carries the reference, the
    colour and the shot name, so the URLs alone are enough.
    """
    shots: dict[str, str] = {}
    first_color: str | None = None
    for value in _walk(data):
        if not isinstance(value, str) or not value.startswith("https://static."):
            continue
        match = _INDITEX_SHOT.search(value)
        if not match:
            continue
        shot_color, shot = match.group(2), match.group(3).lower()
        first_color = first_color or shot_color
        if shot_color != (color or first_color) or shot in shots or shot in _SWATCHES:
            continue
        shots[shot] = value.replace("{width}", str(IMAGE_WIDTH))
    ranked = [shots[name] for name in packshots if name in shots]
    ranked += [url for name, url in shots.items() if name not in packshots]
    return ranked[:MAX_IMAGES]


def _with_width(url: str) -> str:
    if "{width}" in url:
        return url.replace("{width}", str(IMAGE_WIDTH))
    joiner = "&" if "?" in url else "?"
    return f"{url}{joiner}w={IMAGE_WIDTH}" if "w=" not in url else url


def parse_zara_search(data: Any, seo_id: str | None) -> list[ShopProduct]:
    """Zara's search answer. With ``seo_id`` only that product is kept."""
    out: list[ShopProduct] = []
    results = data.get("results") if isinstance(data, dict) else None
    for result in results or []:
        content = result.get("content") if isinstance(result, dict) else None
        if not isinstance(content, dict) or not content.get("name"):
            continue
        seo = content.get("seo") or {}
        if seo_id and seo.get("seoProductId") != seo_id:
            continue
        colors = (content.get("detail") or {}).get("colors") or []
        color = colors[0] if colors and isinstance(colors[0], dict) else {}
        media = color.get("xmedia") or content.get("xmedia") or []
        shots = {}
        for item in media:
            if not isinstance(item, dict) or not item.get("url"):
                continue
            name = str(item.get("name", "")).rsplit("-", 1)[-1].lower()
            shots.setdefault(name, _with_width(item["url"]))
        packshots = INDITEX[0].packshots
        images = [shots[n] for n in packshots if n in shots]
        images += [u for n, u in shots.items() if n not in packshots]
        hex_color = (content.get("colorInfo") or {}).get("mainColorHexCode")
        url = None
        if seo.get("keyword") and seo.get("seoProductId"):
            url = f"https://www.zara.com/es/es/{seo['keyword']}-p{seo['seoProductId']}.html"
        out.append(
            ShopProduct(
                shop="Zara",
                name=_title(content.get("name")),
                price=_cents(color.get("price") or content.get("price")),
                currency="EUR",
                color_name=color.get("name"),
                color_hex=hex_color if isinstance(hex_color, str) else None,
                family=" ".join(
                    str(v) for v in (content.get("familyName"), content.get("subfamilyName")) if v
                )
                or None,
                images=images[:MAX_IMAGES],
                url=url,
            )
        )
    return out


def _products(data: Any) -> list[dict]:
    """The products of a productsArray answer (or a bare product dict)."""
    if isinstance(data, dict) and isinstance(data.get("products"), list):
        return [p for p in data["products"] if isinstance(p, dict) and p.get("name")]
    if isinstance(data, dict) and data.get("name"):
        return [data]
    return []


def _detail_product(data: Any) -> dict | None:
    products = _products(data)
    return products[0] if products else None


def _inditex_colors(product: dict) -> list[dict]:
    colors = (product.get("detail") or {}).get("colors") or []
    if not colors:
        for bundle in product.get("bundleProductSummaries") or []:
            colors = ((bundle or {}).get("detail") or {}).get("colors") or []
            if colors:
                break
    return [c for c in colors if isinstance(c, dict)]


def parse_inditex_detail(data: Any, shop: InditexShop, url: str | None) -> ShopProduct | None:
    """A Bershka / Pull&Bear / Stradivarius / Massimo Dutti product detail."""
    product = _detail_product(data)
    if product is None:
        return None
    colors = _inditex_colors(product)
    color = colors[0] if colors else {}
    price = None
    for size in color.get("sizes") or []:
        price = _cents((size or {}).get("price"))
        if price:
            break
    family = " ".join(
        str(v)
        for v in (
            product.get("familyName"),
            product.get("subFamilyName"),
            ((product.get("detail") or {}).get("familyInfo") or {}).get("familyName"),
        )
        if v
    )
    return ShopProduct(
        shop=shop.brand,
        name=_title(product.get("name")),
        price=price,
        currency="EUR",
        color_name=_title(color.get("name")),
        family=family or None,
        images=inditex_images(
            product, str(color["id"]) if color.get("id") else None, shop.packshots
        ),
        url=url,
    )


def _search_url(shop: InditexShop, query: str) -> str:
    return (
        f"{shop.base}/itxrest/1/search/store/{shop.store}/query"
        f"?query={quote(query)}&locale=es_ES&channel=web"
    )


def _products_url(shop: InditexShop, product_ids: list[str]) -> str:
    # The batch endpoint, one request for several ids. (The per-product /detail
    # endpoint sits behind the same bot wall as the pages.)
    return (
        f"{shop.base}/itxrest/3/catalog/store/{shop.store}/{shop.catalog}/productsArray"
        f"?productIds={','.join(product_ids)}&languageId=-5&appId=1"
    )


def _search_ids(data: Any) -> list[str]:
    ids: list[str] = []
    for result in (data.get("results") if isinstance(data, dict) else None) or []:
        if not isinstance(result, dict):
            continue
        content = result.get("content") or {}
        pid = content.get("productId") or result.get("id")
        if pid and str(pid) not in ids:
            ids.append(str(pid))
    return ids


def _references_of(product: dict) -> set[str]:
    """The 8-digit references a product carries ("C05015479001-I2026" → 05015479)."""
    refs = [(product.get("detail") or {}).get("reference")]
    refs += [
        ((bundle or {}).get("detail") or {}).get("reference")
        for bundle in product.get("bundleProductSummaries") or []
    ]
    found: set[str] = set()
    for ref in refs:
        match = re.match(r"\D?(\d{8})", str(ref or ""))
        if match:
            found.add(match.group(1))
    return found


def _slug_words(path: str) -> str:
    """The product words of a page URL: /es/chaqueta-punto-botones-l05015479 → chaqueta punto botones."""
    slug = path.rstrip("/").rsplit("/", 1)[-1]
    slug = re.sub(r"[-_]?(?:l\d{8}|c0p\d+)(?:\.html)?$", "", slug, flags=re.I)
    return " ".join(w for w in re.split(r"[-_]+", slug) if w and not w.isdigit())


async def _inditex_lookup(shop: InditexShop, url: str, fetch_json: FetchJson) -> ShopProduct | None:
    path = urlsplit(url).path
    if shop.url_id == "zara":
        match = _ZARA_ID.search(path)
        if not match:
            return None
        products = parse_zara_search(
            await fetch_json(_search_url(shop, match.group(1))), match.group(1)
        )
        return products[0] if products else None

    if shop.url_id == "product":
        match = _PRODUCT_ID.search(path)
        if not match:
            return None
        return parse_inditex_detail(
            await fetch_json(_products_url(shop, [match.group(1)])), shop, url
        )

    match = _REFERENCE.search(path)
    if not match:
        return None
    reference = match.group(1)
    # The page names a reference, the catalogue wants an id. Search for the
    # reference, and when the brand's search is fuzzy about numbers (Stradivarius,
    # Massimo Dutti), for the words of the URL; keep the product that carries it.
    queries = [reference]
    words = _slug_words(path)
    if words:
        queries.append(words)
    for query in queries:
        ids = _search_ids(await fetch_json(_search_url(shop, query)))[:10]
        if not ids:
            continue
        for product in _products(await fetch_json(_products_url(shop, ids))):
            if reference in _references_of(product):
                return parse_inditex_detail(product, shop, url)
    return None


# --- Mango --------------------------------------------------------------------------

MANGO_HOSTS = ("mango.com",)
_MANGO_ID = re.compile(r"/(\d{8})(?:$|[/?#])")
#: Mango labels its shots; "B" is the garment alone.
MANGO_PACKSHOTS = ("B", "F", "R")
_MANGO_API = "https://online-orchestrator.mango.com/v4"


def parse_mango(data: Any, prices: Any, color_id: str | None) -> ShopProduct | None:
    if not isinstance(data, dict) or not data.get("name"):
        return None
    colors = [c for c in data.get("colors") or [] if isinstance(c, dict)]
    color = next((c for c in colors if str(c.get("id")) == color_id), colors[0] if colors else {})
    images: dict[str, str] = {}
    domain = data.get("assetsDomain") or "https://media.mango.com"
    for look in (color.get("looks") or {}).values():
        for label, shot in ((look or {}).get("images") or {}).items():
            path = (shot or {}).get("img")
            if isinstance(path, str) and path.startswith("/") and label not in images:
                images[label] = f"{domain}{path}?wid={IMAGE_WIDTH}"
    ranked = [images[k] for k in MANGO_PACKSHOTS if k in images]
    ranked += [u for k, u in images.items() if k not in MANGO_PACKSHOTS]

    price = currency = None
    entry = (prices or {}).get(str(color.get("id"))) if isinstance(prices, dict) else None
    default = (entry or {}).get("default") if isinstance(entry, dict) else None
    if isinstance(default, dict):
        try:
            price = Decimal(str(default.get("price"))).quantize(Decimal("0.01"))
        except (InvalidOperation, ValueError):
            price = None
        currency = default.get("currency")

    hex_color = None
    rgb = color.get("rgb")
    if isinstance(rgb, str):
        parts = [p.strip() for p in rgb.split(",")]
        if len(parts) == 3 and all(p.isdigit() and int(p) < 256 for p in parts):
            hex_color = "#" + "".join(f"{int(p):02x}" for p in parts)

    family = next(
        (
            f.get("label")
            for f in data.get("families") or []
            if isinstance(f, dict) and f.get("label")
        ),
        None,
    )
    page = data.get("url")
    return ShopProduct(
        shop="Mango",
        name=_title(data.get("name")),
        price=price,
        currency=currency or ("EUR" if price else None),
        color_name=_title(color.get("label")),
        color_hex=hex_color,
        family=family,
        images=ranked[:MAX_IMAGES],
        url=f"https://shop.mango.com{page}"
        if isinstance(page, str) and page.startswith("/")
        else None,
    )


async def _mango_lookup(url: str, fetch_json: FetchJson) -> ShopProduct | None:
    parts = urlsplit(url)
    match = _MANGO_ID.search(parts.path)
    if not match:
        return None
    product_id = match.group(1)
    color_id = (parse_qs(parts.query).get("c") or [None])[0]
    data = await fetch_json(
        f"{_MANGO_API}/products?channelId=shop&countryIso=ES&languageIso=es&productId={product_id}"
    )
    try:
        prices = await fetch_json(
            f"{_MANGO_API}/prices/products?channelId=shop&countryIso=ES&productId={product_id}"
        )
    except Exception:  # the price is a nicety; the garment is not lost without it
        prices = None
    product = parse_mango(data, prices, color_id)
    if product is not None and product.url is None:
        product.url = url
    return product


# --- Entry points ---------------------------------------------------------------------


def supports(host: str) -> bool:
    return inditex_shop_for(host) is not None or _host_matches(host, MANGO_HOSTS)


async def lookup(url: str, fetch_json: FetchJson) -> ShopProduct | None:
    """The product behind a shop URL, or None when the shop is not one of ours,
    the URL names no product, or the shop's JSON did not answer as expected."""
    host = urlsplit(url).hostname or ""
    try:
        shop = inditex_shop_for(host)
        if shop is not None:
            return await _inditex_lookup(shop, url, fetch_json)
        if _host_matches(host, MANGO_HOSTS):
            return await _mango_lookup(url, fetch_json)
    except Exception as exc:
        # A changed endpoint, a block, a timeout: the caller reads the page instead.
        logger.info(
            "Shop lookup failed for %s: %s", host, getattr(exc, "reason", type(exc).__name__)
        )
    return None


def _fold(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in text if not unicodedata.combining(c)).strip()


def _words(text: str | None) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", _fold(text or "")) if len(w) > 1}


def name_similarity(a: str | None, b: str | None) -> float:
    """Share of the words of ``a`` (what the screenshot says) found in ``b``."""
    wa, wb = _words(a), _words(b)
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb) * 0.5 + len(wa & wb) / len(wa) * 0.5


#: Below this the search hit is a different product, so the screenshot crop is kept.
MIN_NAME_SIMILARITY = 0.6


async def search(brand: str | None, name: str | None, fetch_json: FetchJson) -> ShopProduct | None:
    """The product a screenshot shows, found by its name in the shop's search.

    Only for the Inditex brands (Mango has no public search). The best hit must
    share most of its words with the name read off the screenshot.
    """
    shop = inditex_shop_named(brand)
    if shop is None or not name or len(_words(name)) < 2:
        return None
    try:
        data = await fetch_json(_search_url(shop, name[:120]))
        if shop.url_id == "zara":
            candidates = parse_zara_search(data, None)[:6]
        else:
            ids = _search_ids(data)[:6]
            products = _products(await fetch_json(_products_url(shop, ids))) if ids else []
            candidates = [p for p in (parse_inditex_detail(x, shop, None) for x in products) if p]
    except Exception as exc:
        logger.info(
            "Shop search failed for %s: %s", shop.brand, getattr(exc, "reason", type(exc).__name__)
        )
        return None
    scored = sorted(candidates, key=lambda p: name_similarity(name, p.name), reverse=True)
    if scored and name_similarity(name, scored[0].name) >= MIN_NAME_SIMILARITY:
        return scored[0]
    return None


def _title(value: Any) -> str | None:
    """Shops shout ("SOBRECAMISA CROPPED FIT"); a wardrobe speaks normally."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = re.sub(r"\s+", " ", value).strip()
    if text.isupper():
        text = text[0] + text[1:].lower()
    return text[:200]
