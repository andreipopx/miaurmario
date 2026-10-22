"""Adding clothes from shops: the Inditex / Mango catalogues, screenshots, and the
funnel that tells us which way in people actually use."""

import io
import json
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select

from app.models.activity import UserActivityDay
from app.models.item import ClothingItem
from app.models.outfit import Outfit
from app.models.user import User
from app.services import activity, link_import, screenshot_import, shop_catalog
from app.services.admin_stats import funnel

PUBLIC_IP = "93.184.216.34"

STATIC = "https://static.pullandbear.net/assets/public/aa/bb"


def _shot(ref_color: str, name: str, host: str = STATIC) -> str:
    return f"{host}/{ref_color}-{name}/{ref_color}-{name}.jpg?ts=1"


ZARA_SEARCH = {
    "results": [
        {
            "content": {
                "name": "SOBRECAMISA CROPPED FIT ALGODÓN",
                "price": 6995,
                "familyName": "SOBRECAMISA",
                "subfamilyName": "Sobrecamisa",
                "seo": {"keyword": "sobrecamisa-cropped-fit-algodon", "seoProductId": "09621716"},
                "colorInfo": {"mainColorHexCode": "#c4b6a6"},
                "detail": {
                    "colors": [
                        {
                            "id": "710",
                            "name": "Beige",
                            "price": 6995,
                            "xmedia": [
                                {
                                    "name": "09621716710-p",
                                    "url": "https://static.zara.net/x/09621716710-p/09621716710-p.jpg?w={width}",
                                },
                                {
                                    "name": "09621716710-f1",
                                    "url": "https://static.zara.net/x/09621716710-f1/09621716710-f1.jpg?w={width}",
                                },
                            ],
                        }
                    ]
                },
            }
        },
        {"content": {"name": "OTRA COSA", "seo": {"seoProductId": "11111111"}}},
    ]
}

PB_PRODUCTS = {
    "products": [
        {
            "id": 748856955,
            "name": "Jeans balloon rayas costuras",
            "familyName": "PANTALON DENIM",
            "subFamilyName": "PANTALON",
            "detail": {
                "reference": "C07660304427-I2026",
                "colors": [{"id": "427", "name": "Azul medio", "sizes": [{"price": "2999"}]}],
                "xmedia": [
                    {
                        "path": "/427",
                        "xmediaItems": [
                            {
                                "medias": [
                                    {"extraInfo": {"deliveryUrl": _shot("07660304427", "A6M")}},
                                    {"extraInfo": {"deliveryUrl": _shot("07660304427", "R1")}},
                                    {"extraInfo": {"deliveryUrl": _shot("07660304427", "C")}},
                                    {"extraInfo": {"deliveryUrl": _shot("07660304999", "C")}},
                                ]
                            }
                        ],
                    }
                ],
            },
        }
    ]
}

MANGO_PRODUCT = {
    "name": "Pantalón recto cordón",
    "url": "/es/es/p/mujer/pantalones/casual/pantalon-recto-cordon/37057941",
    "assetsDomain": "https://media.mango.com",
    "families": [{"label": "Pantalones"}],
    "colors": [
        {
            "id": "56",
            "label": "Azul marino",
            "rgb": "33,39,44",
            "looks": {
                "00": {
                    "images": {
                        "F": {"img": "/is/image/punto/37057941-56-002"},
                        "B": {"img": "/is/image/punto/37057941-56-900"},
                    }
                }
            },
        }
    ],
}
MANGO_PRICES = {"56": {"default": {"price": 39.99, "currency": "EUR"}}}


def _jpeg(size=(60, 80), color=(200, 180, 150)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format="JPEG")
    return buffer.getvalue()


class TestShopCatalogParsing:
    def test_zara_search_keeps_the_product_and_puts_the_packshot_first(self):
        products = shop_catalog.parse_zara_search(ZARA_SEARCH, "09621716")
        assert len(products) == 1
        p = products[0]
        assert p.name == "Sobrecamisa cropped fit algodón"
        assert p.price == Decimal("69.95")
        assert p.color_hex == "#c4b6a6"
        assert "-f1" in p.images[0] and "{width}" not in p.images[0]
        assert p.url == "https://www.zara.com/es/es/sobrecamisa-cropped-fit-algodon-p09621716.html"

    def test_inditex_images_one_colour_packshots_first_no_swatches(self):
        images = shop_catalog.inditex_images(PB_PRODUCTS, "427", ("c", "a6m"))
        assert ["-C/" in images[0], "-A6M/" in images[1]] == [True, True]
        assert len(images) == 2  # R1 is a swatch, 999 is another colour

    def test_inditex_detail(self):
        p = shop_catalog.parse_inditex_detail(PB_PRODUCTS, shop_catalog.INDITEX[2], "https://x")
        assert (p.shop, p.name, p.price, p.color_name) == (
            "Pull&Bear",
            "Jeans balloon rayas costuras",
            Decimal("29.99"),
            "Azul medio",
        )

    def test_mango(self):
        p = shop_catalog.parse_mango(MANGO_PRODUCT, MANGO_PRICES, None)
        assert p.price == Decimal("39.99")
        assert p.color_hex == "#21272c"
        assert p.images[0].endswith("37057941-56-900?wid=1200")  # "B": garment alone
        assert p.url.startswith("https://shop.mango.com/es/es/p/")

    def test_brand_names_from_a_screenshot(self):
        assert shop_catalog.inditex_shop_named("ZARA").brand == "Zara"
        assert shop_catalog.inditex_shop_named("Pull & Bear").brand == "Pull&Bear"
        assert shop_catalog.inditex_shop_named("pullandbear").brand == "Pull&Bear"
        assert shop_catalog.inditex_shop_named("Mango") is None
        assert shop_catalog.inditex_shop_named(None) is None

    def test_name_similarity(self):
        assert shop_catalog.name_similarity(
            "VESTIDO MINI POPELÍN BORDADOS", "Vestido mini popelin bordados"
        ) == pytest.approx(1.0)
        assert shop_catalog.name_similarity("Vestido mini", "Abrigo largo") == 0

    def test_slug_words(self):
        assert (
            shop_catalog._slug_words("/es/chaqueta-punto-botones-l05015479")
            == "chaqueta punto botones"
        )


class TestShopLookup:
    async def test_zara_url_is_read_from_the_search(self):
        fetch = AsyncMock(return_value=ZARA_SEARCH)
        p = await shop_catalog.lookup(
            "https://www.zara.com/es/es/sobrecamisa-cropped-fit-algodon-p09621716.html", fetch
        )
        assert p.name == "Sobrecamisa cropped fit algodón"
        assert "query=09621716" in fetch.await_args.args[0]

    async def test_reference_brand_searches_then_reads_the_batch(self):
        fetch = AsyncMock(
            side_effect=[{"results": [{"content": {"productId": "748856955"}}]}, PB_PRODUCTS]
        )
        p = await shop_catalog.lookup(
            "https://www.pullandbear.com/es/jeans-balloon-rayas-costuras-l07660304", fetch
        )
        assert p.name == "Jeans balloon rayas costuras"
        assert "productsArray?productIds=748856955" in fetch.await_args_list[1].args[0]

    async def test_a_failing_shop_is_none_not_an_error(self):
        fetch = AsyncMock(side_effect=link_import.LinkImportError("fetch_failed", "403"))
        assert await shop_catalog.lookup("https://shop.mango.com/es/es/p/x/37057941", fetch) is None

    async def test_search_needs_a_close_name(self):
        fetch = AsyncMock(return_value=ZARA_SEARCH)
        assert (await shop_catalog.search("Zara", "Sobrecamisa cropped fit algodón", fetch)).price
        assert await shop_catalog.search("Zara", "Vestido largo de fiesta", fetch) is None
        assert await shop_catalog.search("Mango", "Pantalón recto", fetch) is None


class TestGuesses:
    @pytest.mark.parametrize(
        ("texts", "expected"),
        [
            (("Chaqueta punto botones tacto suave", "Tricot Punto"), "cardigan"),
            (("Jeans balloon rayas costuras",), "jeans"),
            (("Pantalón recto", "PANTALON DENIM"), "jeans"),
            (("Pantalón recto cordón", "Pantalones"), "pants"),
            (("Botín plano chelsea",), "boots"),
            (("Abrigo largo cuello funnel cinturón",), "coat"),
            (("Jersey cuello camisa",), "sweater"),
            (("Algo raro",), None),
        ],
    )
    def test_type(self, texts, expected):
        assert link_import.guess_type(*texts) == expected

    def test_link_inside_a_shared_sentence(self):
        assert (
            link_import.link_in_text(
                "Mira este producto de ZARA https://www.zara.com/es/es/x-p1.html."
            )
            == "https://www.zara.com/es/es/x-p1.html"
        )
        assert link_import.link_in_text("zara.com/es/x") == "zara.com/es/x"

    def test_product_group_prices_and_photos_come_from_the_variants(self):
        html = """<html><head>
        <meta property="og:image" content="https://shop.example/og.jpg">
        <script type="application/ld+json">{"@type":"ProductGroup","name":"Gabardina de mujer",
          "hasVariant":[{"@type":"Product","color":"Camel","image":["https://shop.example/a.jpg"],
            "offers":{"@type":"Offer","price":"129.00","priceCurrency":"EUR"}}]}</script>
        </head></html>"""
        e = link_import.parse_product_html(html, "https://shop.example/p")
        assert (e.price, e.currency, e.type) == (Decimal("129.00"), "EUR", "coat")
        assert e.primary_color == "tan"
        assert e.image_urls == ["https://shop.example/a.jpg", "https://shop.example/og.jpg"]


@pytest.fixture
def public_dns(monkeypatch):
    async def fake(host, port):
        return [PUBLIC_IP]

    monkeypatch.setattr(link_import, "_getaddrinfo", fake)
    link_import.clear_cache()
    yield
    link_import.clear_cache()


def _client(handler):
    def factory():
        return httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False)

    return factory


class TestImportFromShop:
    async def test_mango_link_comes_with_every_photo(self, public_dns, monkeypatch):
        seen: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            url = str(request.url)
            host = request.headers["host"]
            seen.append(host)
            if host == "online-orchestrator.mango.com" and "/prices/" in url:
                return httpx.Response(200, json=MANGO_PRICES)
            if host == "online-orchestrator.mango.com":
                return httpx.Response(200, json=MANGO_PRODUCT)
            if host == "media.mango.com":
                return httpx.Response(200, content=_jpeg(), headers={"content-type": "image/jpeg"})
            return httpx.Response(403)

        monkeypatch.setattr(link_import, "_open_client", _client(handler))
        result = await link_import.import_link(
            "Mira esto: https://shop.mango.com/es/es/p/mujer/pantalones/pantalon-recto-cordon/37057941"
        )
        e = result.extraction
        assert (e.name, e.brand, e.type, e.primary_color) == (
            "Pantalón recto cordón",
            "Mango",
            "pants",
            "navy",
        )
        assert e.price == Decimal("39.99")
        assert len(result.images) == 2 and result.image == result.images[0][0]
        assert "shop.mango.com" not in seen  # the walled page is never asked for

    async def test_shop_json_failing_falls_back_to_the_page(self, public_dns, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            if request.headers["host"] == "online-orchestrator.mango.com":
                return httpx.Response(500)
            return httpx.Response(
                200,
                text='<meta property="og:title" content="Pantalón">',
                headers={"content-type": "text/html"},
            )

        monkeypatch.setattr(link_import, "_open_client", _client(handler))
        result = await link_import.import_link("https://shop.mango.com/es/es/p/x/37057941")
        assert result.extraction.name == "Pantalón"

    async def test_preview_endpoint_lists_the_photos(
        self, client: AsyncClient, auth_headers, public_dns, monkeypatch
    ):
        def handler(request: httpx.Request) -> httpx.Response:
            host = request.headers["host"]
            if "/prices/" in str(request.url):
                return httpx.Response(200, json=MANGO_PRICES)
            if host == "online-orchestrator.mango.com":
                return httpx.Response(200, json=MANGO_PRODUCT)
            return httpx.Response(200, content=_jpeg(), headers={"content-type": "image/jpeg"})

        monkeypatch.setattr(link_import, "_open_client", _client(handler))
        resp = await client.post(
            "/api/v1/items/link-preview",
            json={"url": "https://shop.mango.com/es/es/p/x/37057941"},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["type"] == "pants"
        assert body["primary_color_hex"] == "#21272c"
        assert len(body["images"]) == 2
        assert body["image"]["data_url"] == body["images"][0]["data_url"]


class TestScreenshotParsing:
    def test_fields_ride_along_and_bad_garments_drop(self):
        raw = json.dumps(
            {
                "garments": [
                    {
                        "type": "dress",
                        "primary_color": "olive",
                        "colors": ["olive"],
                        "pattern": "solid",
                        "name": "VESTIDO MINI POPELÍN BORDADOS",
                        "brand": "ZARA",
                        "price": "29,95 EUR",
                        "box": [115, 505, 320, 810],
                    },
                    {"type": "spaceship", "primary_color": "red"},
                    {"type": "belt", "primary_color": "black", "box": [1, 2, 3]},
                ]
            }
        )
        found = screenshot_import.parse_screenshot(raw)
        assert [g.garment.type for g in found] == ["dress", "belt"]
        dress = found[0]
        assert (dress.name, dress.brand, dress.price, dress.currency) == (
            "Vestido mini popelín bordados",
            "Zara",
            Decimal("29.95"),
            "EUR",
        )
        assert dress.box == (115, 505, 320, 810)
        assert found[1].box is None

    def test_crop_adds_air_and_grows_tiny_boxes(self):
        source = Image.new("RGB", (1000, 2000), (255, 255, 255))
        piece = Image.open(io.BytesIO(screenshot_import.crop(source, (400, 400, 600, 600))))
        assert piece.size == (232, 464)  # 200x400 box + 8 % on each side
        tiny = Image.open(io.BytesIO(screenshot_import.crop(source, (500, 500, 510, 510))))
        assert tiny.size[0] >= 120 and tiny.size[1] >= 240
        whole = Image.open(io.BytesIO(screenshot_import.crop(source, None)))
        assert whole.size == (600, 1200)  # capped at CROP_EDGE

    def test_garbage_is_not_an_image(self):
        with pytest.raises(screenshot_import.ScreenshotImageError):
            screenshot_import.prepare(b"not an image")


class _ScreenshotAI:
    analyze_vision_json = AsyncMock(
        return_value=json.dumps(
            {
                "garments": [
                    {
                        "type": "jacket",
                        "primary_color": "beige",
                        "colors": ["beige"],
                        "pattern": "solid",
                        "name": "SOBRECAMISA CROPPED FIT ALGODÓN",
                        "brand": "ZARA",
                        "price": "69,95 EUR",
                        "box": [100, 100, 500, 600],
                    },
                    {"type": "sneakers", "primary_color": "white", "box": [600, 800, 700, 900]},
                ]
            }
        )
    )


class TestScreenshotEndpoint:
    async def test_shop_photos_first_then_the_crop(self, client: AsyncClient, auth_headers):
        shop = link_import.LinkImportResult(
            extraction=link_import.ProductExtraction(
                source_url="https://www.zara.com/es/es/x-p09621716.html",
                name="Sobrecamisa cropped fit algodón",
                brand="Zara",
                price=Decimal("69.95"),
                currency="EUR",
                primary_color_hex="#c4b6a6",
            ),
            images=[(_jpeg(), "image/jpeg")],
        )
        find = AsyncMock(side_effect=[shop, None])
        with (
            patch("app.api.items.require_ai_client", AsyncMock(return_value=_ScreenshotAI())),
            patch("app.api.items.link_import.find_in_shop", find),
            patch("app.api.items.rate_limit_by_user", AsyncMock()),
        ):
            resp = await client.post(
                "/api/v1/items/screenshot",
                files={"image": ("captura.png", _jpeg((400, 800)), "image/jpeg")},
                headers=auth_headers,
            )
        assert resp.status_code == 200, resp.text
        jacket, sneakers = resp.json()["garments"]
        assert jacket["from_shop"] is True
        assert jacket["source_url"].startswith("https://www.zara.com/")
        assert len(jacket["images"]) == 2  # the shop's photo, then the crop
        assert jacket["primary_color_hex"] == "#c4b6a6"
        assert sneakers["from_shop"] is False and len(sneakers["images"]) == 1
        assert find.await_args_list[0].args == ("Zara", "Sobrecamisa cropped fit algodón")
        # No name on the trainers: nothing to look up, so no brand is guessed.
        assert find.await_args_list[1].args == (None, None)

    async def test_unreadable_upload(self, client: AsyncClient, auth_headers):
        with patch("app.api.items.rate_limit_by_user", AsyncMock()):
            resp = await client.post(
                "/api/v1/items/screenshot",
                files={"image": ("x.png", b"nope", "image/png")},
                headers=auth_headers,
            )
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "image_unreadable"


class TestCreatedVia:
    async def test_the_way_in_is_kept_and_unknown_ways_are_not(
        self, client: AsyncClient, auth_headers, db_session, test_user
    ):
        for way in ("screenshot", "hacked"):
            photo = io.BytesIO()
            Image.effect_noise((300, 300), 90).convert("RGB").save(photo, format="JPEG")
            resp = await client.post(
                "/api/v1/items",
                data={
                    "type": "shirt",
                    "created_via": way,
                    "purchase_price": "29.95",
                    "skip_ai": "true",
                },
                files={"image": ("p.jpg", photo.getvalue(), "image/jpeg")},
                headers=auth_headers,
            )
            assert resp.status_code == 201, resp.text
        rows = (
            await db_session.execute(
                select(ClothingItem.created_via, ClothingItem.purchase_price).where(
                    ClothingItem.user_id == test_user.id
                )
            )
        ).all()
        assert sorted((r[0] or "", r[1]) for r in rows) == [
            ("", Decimal("29.95")),
            ("screenshot", Decimal("29.95")),
        ]


class TestActivity:
    async def test_recorded_once_a_day(self, test_user, db_session, monkeypatch):
        activity._seen.clear()

        class _NoRedis:
            async def set(self, *a, **k):
                raise ConnectionError

        monkeypatch.setattr(activity, "get_redis", AsyncMock(return_value=_NoRedis()))
        sessions = []

        class _Session:
            def __init__(self):
                self.execute = AsyncMock()
                self.commit = AsyncMock()
                sessions.append(self)

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

        monkeypatch.setattr(activity, "async_session_maker", _Session)
        await activity.record_activity(test_user.id)
        await activity.record_activity(test_user.id)
        assert len(sessions) == 1 and sessions[0].commit.await_count == 1
        assert activity.already_recorded(test_user.id)
        activity._seen.clear()


def _funnel_numbers(data: dict) -> dict:
    out = {s["key"]: s["count"] for s in data["steps"]}
    for key in ("came_back_first_week", "came_back_second_week"):
        out[f"{key}.count"] = data[key]["count"]
        out[f"{key}.eligible"] = data[key]["eligible"]
    for way in data["items_by_way"]:
        out[f"way.{way['way']}"] = way["count"]
    return out


class TestFunnel:
    async def test_steps_and_retention(self, db_session, test_user):
        # The test database is shared, so the funnel is compared before and after.
        before = _funnel_numbers(await funnel(db_session))
        joined = datetime.now(UTC) - timedelta(days=20)
        test_user.created_at = joined
        test_user.onboarding_completed = True
        other = User(
            id=uuid.uuid4(),
            external_id=f"f-{uuid.uuid4()}",
            email=f"f-{uuid.uuid4()}@x.es",
            display_name="F",
            created_at=joined,
        )
        db_session.add(other)
        await db_session.flush()
        for i in range(3):
            db_session.add(
                ClothingItem(
                    user_id=test_user.id,
                    type="shirt",
                    image_path=f"x/{i}.jpg",
                    created_via="link" if i else None,
                )
            )
        db_session.add(Outfit(user_id=test_user.id, occasion="casual", scheduled_for=date.today()))
        d0 = joined.date()
        for day in (d0, d0 + timedelta(days=2), d0 + timedelta(days=9)):
            db_session.add(UserActivityDay(user_id=test_user.id, day=day))
        db_session.add(UserActivityDay(user_id=other.id, day=d0))
        await db_session.commit()

        after = _funnel_numbers(await funnel(db_session))
        delta = {k: after.get(k, 0) - before.get(k, 0) for k in after}
        assert delta["signed_up"] == 1  # test_user was already counted
        assert (delta["items_1"], delta["items_3"], delta["items_10"]) == (1, 1, 0)
        assert delta["first_look"] == 1
        # test_user moved 20 days back: now eligible for both, and came back in both
        assert delta["came_back_first_week.count"] == 1
        assert delta["came_back_second_week.count"] == 1
        assert delta["came_back_second_week.eligible"] == 2
        assert (delta["way.link"], delta["way.unknown"]) == (2, 1)
