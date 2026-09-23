"""Low-friction garment intake: pasted shop links and care-label photos.

The SSRF tests are the important ones: the URL in every link-import call comes
straight from a user and is pointed at our own network.
"""

import io
import json
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from httpx import AsyncClient
from PIL import Image

from app.services import link_import
from app.services.care_label import extract_json_object, parse_care_label
from app.services.link_import import (
    LinkImportError,
    guess_color,
    normalize_link_url,
    parse_price,
    parse_product_html,
)
from app.utils.care import care_hint_text, care_hints, dominant_material, parse_composition

PUBLIC_IP = "93.184.216.34"

PRODUCT_HTML = """
<html><head>
<title>Camisa de lino azul | ACME Shop</title>
<meta property="og:site_name" content="ACME Shop">
<meta property="og:title" content="Camisa de lino">
<meta property="og:image" content="/media/shirt.jpg">
<meta property="og:description" content="Una camisa fresca de lino.">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Camisa de lino azul",
 "brand":{"@type":"Brand","name":"ACME"},"color":"azul","material":"lino",
 "image":["https://cdn.example.com/shirt-large.jpg"],
 "offers":{"@type":"Offer","price":"49,95","priceCurrency":"EUR"}}
</script>
</head><body><h1>Camisa</h1></body></html>
"""


def _png_bytes(size: tuple[int, int] = (80, 60)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (120, 140, 200)).save(buffer, format="PNG")
    return buffer.getvalue()


def _jpeg_bytes(size: tuple[int, int] = (60, 60)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (200, 120, 140)).save(buffer, format="JPEG")
    return buffer.getvalue()


@pytest.fixture(autouse=True)
def _clear_link_cache():
    link_import.clear_cache()
    yield
    link_import.clear_cache()


@pytest.fixture
def public_dns(monkeypatch):
    """Pretend every host resolves to one public address."""

    async def _resolve(host: str, port: int) -> list[str]:
        return [PUBLIC_IP]

    monkeypatch.setattr(link_import, "resolve_public_addresses", _resolve)


def _mock_client(handler):
    """Build the client seam over a mock transport."""

    def factory() -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False)

    return factory


# --- URL validation / SSRF -------------------------------------------------------


class TestUrlGuard:
    @pytest.mark.parametrize(
        "url,reason",
        [
            ("ftp://example.com/x", "https_required"),
            ("https://localhost/item", "private_address"),
            ("https://shop.local/item", "private_address"),
            ("https://127.0.0.1/item", "private_address"),
            ("http://10.0.0.5/item", "private_address"),
            ("https://192.168.1.10/item", "private_address"),
            ("https://169.254.169.254/latest/meta-data/", "private_address"),
            ("https://[::1]/item", "private_address"),
            ("https://[fd00::1]/item", "private_address"),
            ("https://100.64.0.1/item", "private_address"),
            ("https://user:pass@example.com/item", "invalid_url"),
            ("", "invalid_url"),
            ("https://" + "a" * 2100, "invalid_url"),
        ],
    )
    def test_refuses(self, url, reason):
        with pytest.raises(LinkImportError) as excinfo:
            normalize_link_url(url)
        assert excinfo.value.reason == reason
        assert excinfo.value.blocked is True

    def test_upgrades_and_keeps_query(self):
        normalized, host, port = normalize_link_url("http://shop.example/p/1?color=blue#tab")
        assert normalized == "https://shop.example/p/1?color=blue"
        assert (host, port) == ("shop.example", 443)

    def test_bare_host_gets_https(self):
        normalized, host, _ = normalize_link_url("shop.example/p/1")
        assert normalized == "https://shop.example/p/1"
        assert host == "shop.example"

    async def test_private_dns_answer_is_refused(self, monkeypatch):
        async def _getaddrinfo(host: str, port: int) -> list[str]:
            return [PUBLIC_IP, "10.1.2.3"]

        monkeypatch.setattr(link_import, "_getaddrinfo", _getaddrinfo)
        with pytest.raises(LinkImportError) as excinfo:
            await link_import.resolve_public_addresses("shop.example", 443)
        assert excinfo.value.reason == "private_address"

    async def test_unresolvable_host(self, monkeypatch):
        async def _getaddrinfo(host: str, port: int) -> list[str]:
            raise OSError("nope")

        monkeypatch.setattr(link_import, "_getaddrinfo", _getaddrinfo)
        with pytest.raises(LinkImportError) as excinfo:
            await link_import.resolve_public_addresses("shop.example", 443)
        assert excinfo.value.reason == "unresolvable"

    async def test_redirect_to_private_address_is_refused(self, monkeypatch):
        """A public page that 302s to the metadata service must not be followed."""

        async def _resolve(host: str, port: int) -> list[str]:
            if host == "shop.example":
                return [PUBLIC_IP]
            raise AssertionError(f"should never resolve {host}")

        monkeypatch.setattr(link_import, "resolve_public_addresses", _resolve)

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/"})

        monkeypatch.setattr(link_import, "_open_client", _mock_client(handler))
        with pytest.raises(LinkImportError) as excinfo:
            await link_import.import_link("https://shop.example/p/1")
        assert excinfo.value.reason == "private_address"

    async def test_request_is_pinned_to_the_validated_address(self, public_dns, monkeypatch):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["url"] = str(request.url)
            seen["host"] = request.headers.get("host")
            seen["ua"] = request.headers.get("user-agent")
            return httpx.Response(
                200, text=PRODUCT_HTML, headers={"content-type": "text/html; charset=utf-8"}
            )

        monkeypatch.setattr(link_import, "_open_client", _mock_client(handler))
        await link_import.import_link("https://shop.example/p/1", with_image=False)
        assert seen["url"].startswith(f"https://{PUBLIC_IP}/")
        assert seen["host"] == "shop.example"
        assert "Miaurmario" in seen["ua"]

    async def test_oversized_page_is_refused(self, public_dns, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                content=b"x" * (link_import.MAX_HTML_BYTES + 10),
                headers={"content-type": "text/html"},
            )

        monkeypatch.setattr(link_import, "_open_client", _mock_client(handler))
        result = await link_import.import_link("https://shop.example/p/1")
        assert result.extracted is False
        assert result.reason == "too_large"

    async def test_non_html_is_refused(self, public_dns, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200, content=b"%PDF-1.4", headers={"content-type": "application/pdf"}
            )

        monkeypatch.setattr(link_import, "_open_client", _mock_client(handler))
        result = await link_import.import_link("https://shop.example/p/1.pdf")
        assert result.reason == "unsupported_content_type"

    async def test_redirect_loop_gives_up(self, public_dns, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(302, headers={"location": "https://shop.example/again"})

        monkeypatch.setattr(link_import, "_open_client", _mock_client(handler))
        result = await link_import.import_link("https://shop.example/p/1")
        assert result.reason == "too_many_redirects"


# --- Extraction --------------------------------------------------------------------


class TestExtraction:
    def test_reads_json_ld_and_opengraph(self):
        extraction = parse_product_html(PRODUCT_HTML, "https://shop.example/p/1")
        assert extraction.name == "Camisa de lino azul"
        assert extraction.brand == "ACME"
        assert extraction.price == Decimal("49.95")
        assert extraction.currency == "EUR"
        assert extraction.primary_color == "blue"
        assert extraction.site_name == "ACME Shop"
        assert extraction.image_url == "https://cdn.example.com/shirt-large.jpg"
        assert extraction.has_content() is True

    def test_opengraph_only_page(self):
        html = """
        <html><head>
        <meta property="og:title" content="Vaqueros negros">
        <meta property="og:site_name" content="Denim Co">
        <meta property="og:image" content="/img/jeans.webp">
        <meta property="product:price:amount" content="79.00">
        <meta property="product:price:currency" content="EUR">
        </head></html>
        """
        extraction = parse_product_html(html, "https://denim.example/p/9")
        assert extraction.name == "Vaqueros negros"
        assert extraction.brand == "Denim Co"
        assert extraction.price == Decimal("79.00")
        assert extraction.primary_color == "black"
        assert extraction.image_url == "https://denim.example/img/jeans.webp"

    def test_title_only_page_drops_the_shop_suffix(self):
        html = "<html><head><title>Jersey de lana | Shop</title></head><body></body></html>"
        extraction = parse_product_html(html, "https://shop.example/p/2")
        assert extraction.name == "Jersey de lana | Shop"  # no og:site_name to strip against

    def test_empty_page_has_no_content(self):
        extraction = parse_product_html("<html><body>hola</body></html>", "https://x.example/")
        assert extraction.has_content() is False

    def test_noindex_is_detected(self):
        html = '<html><head><meta name="robots" content="noindex, follow"></head></html>'
        assert parse_product_html(html, "https://x.example/").noindex is True

    def test_x_robots_tag_header_is_detected(self):
        headers = httpx.Headers({"x-robots-tag": "noindex"})
        assert parse_product_html(PRODUCT_HTML, "https://x.example/", headers).noindex is True

    def test_script_contents_never_run_and_are_ignored(self):
        html = (
            "<html><head><script>window.price = 1;</script>"
            '<meta property="og:title" content="Falda"></head></html>'
        )
        extraction = parse_product_html(html, "https://x.example/")
        assert extraction.name == "Falda"

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("49,95 €", Decimal("49.95")),
            ("€ 1.299,00", Decimal("1299.00")),
            ("$1,299.00", Decimal("1299.00")),
            ("79.00", Decimal("79.00")),
            ("1299", Decimal("1299")),
            (49.5, Decimal("49.5")),
            ("gratis", None),
            ("0", None),
            (None, None),
        ],
    )
    def test_price_parsing(self, raw, expected):
        assert parse_price(raw) == expected

    def test_color_guess_is_word_bounded(self):
        assert guess_color("Camisa azul marino") == "navy"
        assert guess_color("Abrigo rojo") == "red"
        assert guess_color("Blazer") is None


class TestImportLink:
    async def test_happy_path_fetches_page_and_image(self, public_dns, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            if "cdn.example.com" == request.headers.get("host"):
                return httpx.Response(
                    200, content=_png_bytes(), headers={"content-type": "image/png"}
                )
            return httpx.Response(200, text=PRODUCT_HTML, headers={"content-type": "text/html"})

        monkeypatch.setattr(link_import, "_open_client", _mock_client(handler))
        result = await link_import.import_link("https://shop.example/p/1")
        assert result.extracted is True
        assert result.image_content_type in ("image/jpeg", "image/png")
        assert result.image and len(result.image) > 0
        assert result.extraction.brand == "ACME"

    async def test_noindex_page_is_not_extracted(self, public_dns, monkeypatch):
        html = '<html><head><meta name="robots" content="noindex">' + PRODUCT_HTML
        monkeypatch.setattr(
            link_import,
            "_open_client",
            _mock_client(
                lambda request: httpx.Response(
                    200, text=html, headers={"content-type": "text/html"}
                )
            ),
        )
        result = await link_import.import_link("https://shop.example/p/1")
        assert result.extracted is False
        assert result.reason == "noindex"

    async def test_shop_error_degrades_instead_of_raising(self, public_dns, monkeypatch):
        monkeypatch.setattr(
            link_import,
            "_open_client",
            _mock_client(lambda request: httpx.Response(404, text="nope")),
        )
        result = await link_import.import_link("https://shop.example/p/1")
        assert result.extracted is False
        assert result.reason == "fetch_failed"
        assert result.extraction.source_url == "https://shop.example/p/1"

    async def test_second_call_is_served_from_cache(self, public_dns, monkeypatch):
        calls = {"n": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            calls["n"] += 1
            return httpx.Response(200, text=PRODUCT_HTML, headers={"content-type": "text/html"})

        monkeypatch.setattr(link_import, "_open_client", _mock_client(handler))
        first = await link_import.import_link("https://shop.example/p/1", with_image=False)
        second = await link_import.import_link("https://shop.example/p/1", with_image=False)
        assert calls["n"] == 1
        assert first.extraction.name == second.extraction.name


# --- Care labels ---------------------------------------------------------------------


class TestCareParsing:
    def test_composition_text_both_orders(self):
        assert parse_composition("60% algodón, 40% poliéster") == [
            {"fiber": "cotton", "percent": 60},
            {"fiber": "polyester", "percent": 40},
        ]
        assert parse_composition("Algodón 95% / Elastano 5%") == [
            {"fiber": "cotton", "percent": 95},
            {"fiber": "elastane", "percent": 5},
        ]

    def test_composition_without_percentages(self):
        assert parse_composition("lana merino") == [{"fiber": "wool", "percent": None}]

    def test_unknown_fibre_is_kept_as_text(self):
        assert parse_composition("70% fibra rara") == [{"fiber": "fibra rara", "percent": 70}]

    def test_dominant_material(self):
        composition = [
            {"fiber": "polyester", "percent": 40},
            {"fiber": "cotton", "percent": 60},
        ]
        assert dominant_material(composition) == "cotton"
        assert dominant_material([]) is None

    def test_parses_ai_json_with_fences(self):
        answer = """```json
        {"composition": [{"fiber": "Algodón", "percent": 100}],
         "wash": {"machine": true, "max_temp_c": 30, "cycle": "gentle"},
         "dry": {"tumble_dry": false},
         "iron": {"allowed": true, "max_temp_c": 2},
         "bleach": "none"}
        ```"""
        care = parse_care_label(answer)
        assert care.source == "ai"
        assert care.composition[0].fiber == "cotton"
        assert care.wash and care.wash.max_temp_c == 30
        assert care.iron and care.iron.max_temp_c == 150  # two dots
        assert care.bleach == "none"

    def test_dots_become_degrees(self):
        care = parse_care_label('{"wash": {"max_temp_c": 2}}')
        assert care.wash and care.wash.max_temp_c == 40

    def test_unreadable_answer_is_empty_not_an_error(self):
        care = parse_care_label("I cannot read this label, sorry.")
        assert care.is_empty() is True
        assert care.source == "ai"

    def test_bad_sections_are_dropped_and_good_ones_kept(self):
        care = parse_care_label(
            '{"wash": {"max_temp_c": 30}, "iron": {"allowed": "maybe"},'
            ' "composition": "60% algodón, 40% poliéster"}'
        )
        assert care.wash and care.wash.max_temp_c == 30
        assert care.iron is None
        assert [c.fiber for c in care.composition] == ["cotton", "polyester"]

    def test_extract_json_object_handles_prose(self):
        assert extract_json_object('sure! {"a": 1} hope that helps') == {"a": 1}
        assert extract_json_object("no json here") is None

    def test_hints_and_text(self):
        care = {
            "wash": {"max_temp_c": 30, "cycle": "delicate"},
            "dry": {"tumble_dry": False},
            "iron": {"allowed": False},
            "bleach": "none",
        }
        assert care_hints(care) == [
            "wash_30",
            "cycle_delicate",
            "no_tumble",
            "no_iron",
            "no_bleach",
        ]
        assert care_hint_text(care) == "30°C, delicate cycle, no tumble dry"
        assert care_hint_text(None) is None


# --- API ------------------------------------------------------------------------------


class TestLinkPreviewAPI:
    async def test_preview_returns_fields_and_inline_image(
        self, client: AsyncClient, auth_headers, public_dns, monkeypatch
    ):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.headers.get("host") == "cdn.example.com":
                return httpx.Response(
                    200, content=_png_bytes(), headers={"content-type": "image/png"}
                )
            return httpx.Response(200, text=PRODUCT_HTML, headers={"content-type": "text/html"})

        monkeypatch.setattr(link_import, "_open_client", _mock_client(handler))
        response = await client.post(
            "/api/v1/items/link-preview",
            json={"url": "https://shop.example/p/1"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["extracted"] is True
        assert data["name"] == "Camisa de lino azul"
        assert data["brand"] == "ACME"
        assert data["price"] == "49.95"
        assert data["primary_color"] == "blue"
        assert data["image"]["data_url"].startswith("data:image/")

    async def test_preview_refuses_private_url(self, client: AsyncClient, auth_headers):
        response = await client.post(
            "/api/v1/items/link-preview",
            json={"url": "http://169.254.169.254/latest/meta-data/"},
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "private_address"

    async def test_preview_requires_auth(self, client: AsyncClient):
        response = await client.post(
            "/api/v1/items/link-preview", json={"url": "https://shop.example/p/1"}
        )
        assert response.status_code in (401, 403)

    async def test_unreadable_link_still_answers_200(
        self, client: AsyncClient, auth_headers, public_dns, monkeypatch
    ):
        monkeypatch.setattr(
            link_import,
            "_open_client",
            _mock_client(lambda request: httpx.Response(500)),
        )
        response = await client.post(
            "/api/v1/items/link-preview",
            json={"url": "https://shop.example/p/1"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        body = response.json()
        assert body["extracted"] is False
        assert body["source_url"] == "https://shop.example/p/1"


class TestItemSourceAndCare:
    async def test_create_item_with_link_and_care(self, client: AsyncClient, auth_headers):
        care = {
            "composition": "60% algodón, 40% poliéster",
            "wash": {"machine": True, "max_temp_c": 30},
            "dry": {"tumble_dry": False},
        }
        with patch("app.api.items.create_pool", new_callable=AsyncMock):
            response = await client.post(
                "/api/v1/items",
                headers=auth_headers,
                files={"image": ("shirt.jpg", _jpeg_bytes((51, 47)), "image/jpeg")},
                data={
                    "type": "shirt",
                    "name": "Camisa de lino",
                    "source_url": "http://shop.example/p/1?v=2",
                    "care": json.dumps(care),
                    "skip_ai": "true",
                },
            )
        assert response.status_code == 201, response.text
        item = response.json()
        assert item["source_url"] == "https://shop.example/p/1?v=2"
        assert item["care"]["composition"] == [
            {"fiber": "cotton", "percent": 60},
            {"fiber": "polyester", "percent": 40},
        ]
        assert item["care"]["wash"]["max_temp_c"] == 30
        assert item["care"]["source"] == "manual"
        assert item["care_hints"] == ["wash_30", "no_tumble"]

        # And it survives a round trip through the detail endpoint.
        detail = await client.get(f"/api/v1/items/{item['id']}", headers=auth_headers)
        assert detail.json()["source_url"] == "https://shop.example/p/1?v=2"

    async def test_create_item_refuses_a_private_source_url(
        self, client: AsyncClient, auth_headers
    ):
        response = await client.post(
            "/api/v1/items",
            headers=auth_headers,
            files={"image": ("shirt.jpg", _jpeg_bytes((53, 49)), "image/jpeg")},
            data={"type": "shirt", "source_url": "http://127.0.0.1/admin", "skip_ai": "true"},
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "private_address"

    async def test_patch_item_care(self, client: AsyncClient, auth_headers):
        with patch("app.api.items.create_pool", new_callable=AsyncMock):
            created = await client.post(
                "/api/v1/items",
                headers=auth_headers,
                files={"image": ("shirt.jpg", _jpeg_bytes((57, 43)), "image/jpeg")},
                data={"type": "sweater", "skip_ai": "true"},
            )
        item_id = created.json()["id"]
        response = await client.patch(
            f"/api/v1/items/{item_id}",
            headers=auth_headers,
            json={"care": {"wash": {"hand_wash": True}, "composition": "100% lana"}},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["care"]["wash"]["hand_wash"] is True
        assert body["care"]["composition"] == [{"fiber": "wool", "percent": 100}]
        assert body["care_hints"] == ["hand_wash"]

    async def test_item_without_care_reports_no_hints(self, client: AsyncClient, auth_headers):
        with patch("app.api.items.create_pool", new_callable=AsyncMock):
            created = await client.post(
                "/api/v1/items",
                headers=auth_headers,
                files={"image": ("shirt.jpg", _jpeg_bytes((61, 41)), "image/jpeg")},
                data={"type": "shoes", "skip_ai": "true"},
            )
        assert created.json()["care"] is None
        assert created.json()["care_hints"] == []


class TestCareLabelAPI:
    async def test_without_ai_the_user_is_told_to_type_it(self, client: AsyncClient, auth_headers):
        """A wardrobe with no AI gets a machine code, never a 500."""
        response = await client.post(
            "/api/v1/items/care-label",
            headers=auth_headers,
            files={"image": ("label.jpg", _jpeg_bytes(), "image/jpeg")},
        )
        assert response.status_code in (403, 503)
        detail = response.json()["detail"]
        if isinstance(detail, dict):
            assert detail["code"].startswith("ai_")

    async def test_reads_the_label_with_ai(
        self, client: AsyncClient, auth_headers, platform_ai_user, monkeypatch
    ):
        async def fake_analyze(self, image_path):
            return (
                '{"composition": [{"fiber": "algodón", "percent": 100}],'
                ' "wash": {"machine": true, "max_temp_c": 40},'
                ' "dry": {"tumble_dry": false}}'
            )

        monkeypatch.setattr("app.services.ai_service.AIService.analyze_care_label", fake_analyze)
        response = await client.post(
            "/api/v1/items/care-label",
            headers=auth_headers,
            files={"image": ("label.jpg", _jpeg_bytes(), "image/jpeg")},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["read"] is True
        assert body["care"]["composition"] == [{"fiber": "cotton", "percent": 100}]
        assert body["care"]["source"] == "ai"
        assert body["hints"] == ["wash_40", "no_tumble"]
        assert body["suggested_material"] == "cotton"

    async def test_unreadable_label_is_not_an_error(
        self, client: AsyncClient, auth_headers, platform_ai_user, monkeypatch
    ):
        async def fake_analyze(self, image_path):
            return "{}"

        monkeypatch.setattr("app.services.ai_service.AIService.analyze_care_label", fake_analyze)
        response = await client.post(
            "/api/v1/items/care-label",
            headers=auth_headers,
            files={"image": ("label.jpg", _jpeg_bytes(), "image/jpeg")},
        )
        assert response.status_code == 200
        assert response.json()["read"] is False

    async def test_rejects_a_non_image(self, client: AsyncClient, auth_headers, platform_ai_user):
        response = await client.post(
            "/api/v1/items/care-label",
            headers=auth_headers,
            files={"image": ("label.txt", b"not an image", "text/plain")},
        )
        assert response.status_code == 400
