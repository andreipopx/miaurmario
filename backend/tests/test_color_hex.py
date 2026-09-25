"""The garment's real shade, kept next to its colour family.

``clothing_items.primary_color_hex`` exists so a card can show the user's own
brown. Everything that reasons about colour — the filters, the scorer, the
stylist — still reads ``primary_color``, so the point of most of these tests is
the negative one: a shade never changes which family a garment belongs to, and
two different browns are both "brown" wherever it matters.

The other half is null-safety. Every item that existed before this column did
has no hex, a sample can always fail, and none of that is allowed to cost the
garment.
"""

from io import BytesIO

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import ClothingItem, ItemStatus, TaggedBy, TaggingStatus
from app.schemas.item import BulkTagEntry, ItemCreate, ItemUpdate
from app.services.ai_service import ClothingTags
from app.services.item_service import ItemService
from app.utils.colors import dominant_hex_from_image, normalize_hex
from app.workers.tagging import tags_to_item_fields

# Two browns a person would describe the same way and a screen shows differently:
# a chocolate leather and a milky camel.
CHOCOLATE = "#4a2c1a"
CAMEL = "#a9764b"


def _image_bytes(color=(120, 80, 40)) -> bytes:
    buf = BytesIO()
    Image.new("RGB", (50, 50), color).save(buf, format="JPEG")
    return buf.getvalue()


async def _get_item(db_session: AsyncSession, item_id) -> ClothingItem:
    result = await db_session.execute(select(ClothingItem).where(ClothingItem.id == item_id))
    return result.scalar_one()


class TestNormalizeHex:
    def test_accepts_the_shapes_a_browser_produces(self):
        assert normalize_hex("#4A2C1A") == "#4a2c1a"
        assert normalize_hex("4a2c1a") == "#4a2c1a"
        assert normalize_hex("  #abc  ") == "#aabbcc"

    def test_refuses_anything_that_is_not_a_colour(self):
        # This is the only gate on a value that ends up in a CSS `style`, so a
        # near-miss has to be a rejection and not a best guess.
        for junk in (None, "", "   ", "#12345", "#1234567", "rgb(1,2,3)", "red", "#12345g", 0x4A):
            assert normalize_hex(junk) is None


class TestDominantSample:
    def test_finds_the_fabric_and_ignores_the_backdrop(self):
        # What the stored image actually looks like: the cut-out composited onto
        # solid white. The white is the backdrop, not the garment.
        image = Image.new("RGB", (40, 40), (255, 255, 255))
        for x in range(8, 32):
            for y in range(8, 32):
                image.putpixel((x, y), (74, 44, 26))
        assert dominant_hex_from_image(image) == "#4a2c1a"

    def test_reads_through_a_transparent_cut_out(self):
        image = Image.new("RGBA", (40, 40), (0, 0, 0, 0))
        for x in range(10, 30):
            for y in range(10, 30):
                image.putpixel((x, y), (169, 118, 75, 255))
        assert dominant_hex_from_image(image) == "#a9764b"

    def test_says_nothing_rather_than_guessing(self):
        # An all-white garment: the sampler cannot tell fabric from backdrop, so
        # it declines. A null hex is a working item with the palette's swatch.
        assert dominant_hex_from_image(Image.new("RGB", (20, 20), (255, 255, 255))) is None
        assert dominant_hex_from_image(Image.new("RGBA", (20, 20), (0, 0, 0, 0))) is None


class TestFamilyNotShade:
    """Two different browns are both "brown" everywhere it matters."""

    @pytest.mark.asyncio
    async def test_the_colour_filter_returns_both_browns(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ):
        service = ItemService(db_session)
        for shade, name in ((CHOCOLATE, "botas"), (CAMEL, "abrigo")):
            item = await service.create(
                user_id=test_user.id,
                item_data=ItemCreate(
                    type="coat",
                    name=name,
                    primary_color="brown",
                    colors=["brown"],
                    primary_color_hex=shade,
                ),
                image_paths={"image_path": f"test/{name}.jpg"},
            )
            item.status = ItemStatus.ready
        await db_session.commit()

        response = await client.get(
            "/api/v1/items", params={"colors": "brown"}, headers=auth_headers
        )
        assert response.status_code == 200, response.json()
        items = response.json()["items"]
        assert {i["name"] for i in items} == {"botas", "abrigo"}
        # Same family, different shades: the filter groups them, the UI can tell
        # them apart.
        assert {i["primary_color"] for i in items} == {"brown"}
        assert {i["primary_color_hex"] for i in items} == {CHOCOLATE, CAMEL}

    @pytest.mark.asyncio
    async def test_a_shade_never_moves_an_item_between_families(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ):
        service = ItemService(db_session)
        item = await service.create(
            user_id=test_user.id,
            item_data=ItemCreate(type="coat", primary_color="brown", colors=["brown"]),
            image_paths={"image_path": "test/shade-only.jpg"},
        )
        await db_session.commit()

        # A hex-only edit: the family it belongs to must not move with it.
        response = await client.patch(
            f"/api/v1/items/{item.id}",
            json={"primary_color_hex": CAMEL},
            headers=auth_headers,
        )
        assert response.status_code == 200, response.json()
        assert response.json()["primary_color"] == "brown"
        assert response.json()["primary_color_hex"] == CAMEL
        assert response.json()["colors"] == ["brown"]

        # And it still answers to its family, not to its shade.
        listed = await client.get("/api/v1/items", params={"colors": "brown"}, headers=auth_headers)
        assert [i["id"] for i in listed.json()["items"]] == [str(item.id)]


class TestRoundTrip:
    @pytest.mark.asyncio
    async def test_the_add_form_can_send_a_sampled_shade(
        self, client: AsyncClient, auth_headers, db_session: AsyncSession
    ):
        response = await client.post(
            "/api/v1/items",
            files={"image": ("abrigo.jpg", _image_bytes(), "image/jpeg")},
            data={
                "type": "coat",
                "primary_color": "brown",
                "primary_color_hex": "#4A2C1A",
                "skip_ai": "true",
            },
            headers=auth_headers,
        )
        assert response.status_code == 201, response.json()
        # Normalised on the way in, so the browser never has to care about case.
        assert response.json()["primary_color_hex"] == CHOCOLATE

    @pytest.mark.asyncio
    async def test_a_junk_hex_costs_the_shade_and_not_the_garment(
        self, client: AsyncClient, auth_headers
    ):
        response = await client.post(
            "/api/v1/items",
            files={"image": ("abrigo.jpg", _image_bytes(), "image/jpeg")},
            data={"type": "coat", "primary_color": "brown", "primary_color_hex": "chocolate"},
            headers=auth_headers,
        )
        assert response.status_code == 201, response.json()
        assert response.json()["primary_color_hex"] is None
        assert response.json()["primary_color"] == "brown"

    @pytest.mark.asyncio
    async def test_an_item_with_no_shade_reads_back_null(self, test_user, db_session: AsyncSession):
        # The state every pre-existing row is in.
        service = ItemService(db_session)
        item = await service.create(
            user_id=test_user.id,
            item_data=ItemCreate(type="shirt", primary_color="blue"),
            image_paths={"image_path": "test/no-hex.jpg"},
        )
        await db_session.commit()
        assert item.primary_color_hex is None

    @pytest.mark.asyncio
    async def test_clearing_the_shade_is_possible(self, test_user, db_session: AsyncSession):
        service = ItemService(db_session)
        item = await service.create(
            user_id=test_user.id,
            item_data=ItemCreate(type="shirt", primary_color="brown", primary_color_hex=CAMEL),
            image_paths={"image_path": "test/clearable.jpg"},
        )
        await db_session.commit()

        await service.update(item, ItemUpdate(primary_color_hex=None))
        await db_session.commit()
        assert (await _get_item(db_session, item.id)).primary_color_hex is None

    @pytest.mark.asyncio
    async def test_an_untouched_update_leaves_the_shade_alone(
        self, test_user, db_session: AsyncSession
    ):
        service = ItemService(db_session)
        item = await service.create(
            user_id=test_user.id,
            item_data=ItemCreate(type="shirt", primary_color="brown", primary_color_hex=CAMEL),
            image_paths={"image_path": "test/untouched.jpg"},
        )
        await db_session.commit()

        await service.update(item, ItemUpdate(name="camisa"))
        await db_session.commit()
        assert (await _get_item(db_session, item.id)).primary_color_hex == CAMEL


class TestBulkTag:
    @pytest.mark.asyncio
    async def test_the_review_grid_can_send_a_shade_with_a_family(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ):
        service = ItemService(db_session)
        item = await service.create(
            user_id=test_user.id,
            item_data=ItemCreate(type="unknown"),
            image_paths={"image_path": "test/review.jpg"},
        )
        await db_session.commit()

        response = await client.post(
            "/api/v1/items/bulk/tag",
            json={
                "items": [
                    {
                        "item_id": str(item.id),
                        "type": "coat",
                        "primary_color": "brown",
                        "primary_color_hex": CAMEL,
                    }
                ]
            },
            headers=auth_headers,
        )
        assert response.status_code == 200, response.json()
        assert response.json()["updated"] == 1

        refreshed = await _get_item(db_session, item.id)
        assert refreshed.primary_color == "brown"
        assert refreshed.primary_color_hex == CAMEL
        assert refreshed.colors == ["brown"]
        assert refreshed.tagged_by == TaggedBy.manual

    @pytest.mark.asyncio
    async def test_the_eyedropper_alone_keeps_the_family(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ):
        service = ItemService(db_session)
        item = await service.create(
            user_id=test_user.id,
            item_data=ItemCreate(type="coat", primary_color="brown", colors=["brown"]),
            image_paths={"image_path": "test/dropper-only.jpg"},
        )
        await db_session.commit()

        response = await client.post(
            "/api/v1/items/bulk/tag",
            json={"items": [{"item_id": str(item.id), "primary_color_hex": CHOCOLATE}]},
            headers=auth_headers,
        )
        assert response.status_code == 200, response.json()

        refreshed = await _get_item(db_session, item.id)
        assert refreshed.primary_color == "brown"
        assert refreshed.primary_color_hex == CHOCOLATE
        assert refreshed.tagging_status == TaggingStatus.tagged

    @pytest.mark.asyncio
    async def test_picking_a_swatch_drops_a_shade_that_no_longer_fits(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ):
        # The tagger sampled a brown and called it brown; the user says it is
        # black. Keeping the brown hex would draw a brown dot labelled "negro".
        service = ItemService(db_session)
        item = await service.create(
            user_id=test_user.id,
            item_data=ItemCreate(
                type="coat", primary_color="brown", colors=["brown"], primary_color_hex=CAMEL
            ),
            image_paths={"image_path": "test/corrected.jpg"},
        )
        await db_session.commit()

        response = await client.post(
            "/api/v1/items/bulk/tag",
            json={"items": [{"item_id": str(item.id), "primary_color": "black"}]},
            headers=auth_headers,
        )
        assert response.status_code == 200, response.json()

        refreshed = await _get_item(db_session, item.id)
        assert refreshed.primary_color == "black"
        assert refreshed.primary_color_hex is None

    def test_a_junk_hex_in_a_review_row_is_dropped(self):
        entry = BulkTagEntry(
            item_id="0" * 8 + "-0000-0000-0000-" + "0" * 12, primary_color_hex="nope"
        )
        assert entry.primary_color_hex is None


class TestWorkerSample:
    def test_the_shade_only_travels_with_a_family(self):
        named = tags_to_item_fields(
            ClothingTags(type="coat", primary_color="brown", colors=["brown"], confidence=0.9),
            None,
            CAMEL,
        )
        assert named["primary_color_hex"] == CAMEL

        # No family from the model: a shade on its own would show a swatch the
        # filters cannot explain.
        unnamed = tags_to_item_fields(
            ClothingTags(type="coat", primary_color=None, colors=[], confidence=0.9),
            None,
            CAMEL,
        )
        assert unnamed["primary_color_hex"] is None

    def test_no_sample_is_a_null_and_not_a_crash(self):
        fields = tags_to_item_fields(
            ClothingTags(type="coat", primary_color="brown", colors=["brown"], confidence=0.9),
            None,
            None,
        )
        assert fields["primary_color_hex"] is None
        assert fields["primary_color"] == "brown"

    @pytest.mark.asyncio
    async def test_the_worker_samples_the_photo_it_tagged(
        self, db_session: AsyncSession, test_user, platform_ai_user, monkeypatch, tmp_path
    ):
        from unittest.mock import AsyncMock, patch

        from app.workers import tagging

        photo = tmp_path / "abrigo.jpg"
        # A garment on the white backdrop the pipeline leaves behind.
        image = Image.new("RGB", (60, 60), (255, 255, 255))
        for x in range(10, 50):
            for y in range(10, 50):
                image.putpixel((x, y), (169, 118, 75))
        image.save(photo, format="JPEG", quality=100)

        item = ClothingItem(
            user_id=test_user.id,
            type="unknown",
            image_path="test/worker-hex.jpg",
            status=ItemStatus.processing,
        )
        db_session.add(item)
        await db_session.commit()

        class _StubAI:
            def __init__(self, *args, **kwargs):
                pass

            async def analyze_image(self, path):
                return ClothingTags(
                    type="coat", primary_color="brown", colors=["brown"], confidence=0.9
                )

        monkeypatch.setattr(tagging, "AIService", _StubAI)

        with (
            patch("app.workers.tagging.get_db_session", return_value=db_session),
            patch.object(db_session, "close", new_callable=AsyncMock),
        ):
            result = await tagging.tag_item_image({}, str(item.id), str(photo))

        assert result["status"] == "success"
        refreshed = await _get_item(db_session, item.id)
        assert refreshed.primary_color == "brown"
        # JPEG is lossy, so the sample lands near the paint rather than on it.
        assert refreshed.primary_color_hex is not None
        assert refreshed.primary_color_hex.startswith("#a")

    @pytest.mark.asyncio
    async def test_an_unreadable_photo_still_tags_the_garment(
        self, db_session: AsyncSession, test_user, platform_ai_user, monkeypatch
    ):
        from unittest.mock import AsyncMock, patch

        from app.workers import tagging

        item = ClothingItem(
            user_id=test_user.id,
            type="unknown",
            image_path="test/worker-nohex.jpg",
            status=ItemStatus.processing,
        )
        db_session.add(item)
        await db_session.commit()

        class _StubAI:
            def __init__(self, *args, **kwargs):
                pass

            async def analyze_image(self, path):
                return ClothingTags(
                    type="coat", primary_color="brown", colors=["brown"], confidence=0.9
                )

        monkeypatch.setattr(tagging, "AIService", _StubAI)

        with (
            patch("app.workers.tagging.get_db_session", return_value=db_session),
            patch.object(db_session, "close", new_callable=AsyncMock),
        ):
            # Not an image at all: sampling fails, tagging must not.
            result = await tagging.tag_item_image({}, str(item.id), __file__)

        assert result["status"] == "success"
        refreshed = await _get_item(db_session, item.id)
        assert refreshed.primary_color == "brown"
        assert refreshed.primary_color_hex is None
        assert refreshed.status == ItemStatus.ready

    @pytest.mark.asyncio
    async def test_a_shade_the_user_sampled_survives_the_worker(
        self, db_session: AsyncSession, test_user, platform_ai_user, monkeypatch, tmp_path
    ):
        from unittest.mock import AsyncMock, patch

        from app.workers import tagging

        photo = tmp_path / "ya-elegido.jpg"
        Image.new("RGB", (60, 60), (30, 30, 200)).save(photo, format="JPEG")

        item = ClothingItem(
            user_id=test_user.id,
            type="coat",
            primary_color="brown",
            primary_color_hex=CHOCOLATE,
            image_path="test/worker-keeps.jpg",
            status=ItemStatus.processing,
        )
        db_session.add(item)
        await db_session.commit()

        class _StubAI:
            def __init__(self, *args, **kwargs):
                pass

            async def analyze_image(self, path):
                return ClothingTags(
                    type="coat", primary_color="blue", colors=["blue"], confidence=0.9
                )

        monkeypatch.setattr(tagging, "AIService", _StubAI)

        with (
            patch("app.workers.tagging.get_db_session", return_value=db_session),
            patch.object(db_session, "close", new_callable=AsyncMock),
        ):
            result = await tagging.tag_item_image({}, str(item.id), str(photo))

        assert result["status"] == "success"
        refreshed = await _get_item(db_session, item.id)
        # The user's family and the user's shade, both untouched.
        assert refreshed.primary_color == "brown"
        assert refreshed.primary_color_hex == CHOCOLATE
