"""A garment with its background removed keeps its transparency.

It used to be composited onto solid white and saved as JPEG, which means the
"cut-out" was a photograph of a white card: the grid could not float it on a
tinted tile and a flat-lay could not lay it on anything. These tests pin the
round trip — alpha in, alpha on disk, alpha served — and pin that undoing the
removal still gives the untouched photo back.
"""

import uuid
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image

from app.services.image_service import ImageService, trim_transparent
from app.utils.image_formats import CUTOUT_SUFFIX, is_cutout_path


def _photo(size: tuple[int, int] = (200, 300), colour=(40, 90, 170)) -> bytes:
    out = BytesIO()
    Image.new("RGB", size, colour).save(out, format="JPEG", quality=95)
    return out.getvalue()


def _cut_out(image: Image.Image) -> Image.Image:
    """A stand-in for rembg: keeps the middle, makes the border transparent."""
    result = image.convert("RGBA")
    pixels = result.load()
    for x in range(result.width):
        for y in range(result.height):
            inside = (
                result.width // 4 <= x < result.width * 3 // 4
                and result.height // 4 <= y < result.height * 3 // 4
            )
            if not inside:
                pixels[x, y] = (0, 0, 0, 0)
    return result


class _FakeProvider:
    def remove(self, image: Image.Image) -> Image.Image:
        return _cut_out(image)


@pytest.fixture
def service(tmp_path: Path) -> ImageService:
    return ImageService(storage_path=str(tmp_path))


def test_is_cutout_path_reads_the_extension() -> None:
    assert is_cutout_path("u/1.webp")
    # PNG carries alpha too, and seeded and imported garments arrive as PNGs.
    assert is_cutout_path("u/1.PNG")
    assert not is_cutout_path("u/1.jpg")
    assert not is_cutout_path(None)


def test_trim_transparent_keeps_the_garment_and_drops_the_void() -> None:
    trimmed = trim_transparent(_cut_out(Image.new("RGB", (400, 400), (10, 20, 30))))
    # Half the picture was empty; what is left is the garment plus a small margin.
    assert 190 <= trimmed.width <= 230
    assert 190 <= trimmed.height <= 230


def test_trim_transparent_leaves_a_bad_mask_alone() -> None:
    """A mask that found almost nothing is a bad mask, not a tight crop."""
    image = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    image.putpixel((5, 5), (255, 0, 0, 255))
    assert trim_transparent(image).size == (200, 200)


class TestRemoveBackground:
    @pytest.mark.asyncio
    async def test_stores_webp_with_an_alpha_channel(self, service, tmp_path) -> None:
        paths = await service.process_and_store(uuid.uuid4(), _photo(), "jumper.jpg")

        with patch("app.services.background_removal.get_provider", return_value=_FakeProvider()):
            result = service.remove_background(paths["image_path"])

        for key in ("image_path", "medium_path", "thumbnail_path"):
            assert result[key].endswith(CUTOUT_SUFFIX), key
            stored = Image.open(tmp_path / result[key])
            assert stored.format == "WEBP", key
            assert stored.mode == "RGBA", key
            # The corners were cut away, the middle was not.
            assert stored.getchannel("A").getextrema()[0] == 0, key
            assert stored.getchannel("A").getextrema()[1] == 255, key

    @pytest.mark.asyncio
    async def test_keeps_a_flat_backup_of_the_untouched_photo(self, service, tmp_path) -> None:
        paths = await service.process_and_store(uuid.uuid4(), _photo(), "jumper.jpg")
        before = (tmp_path / paths["image_path"]).read_bytes()

        with patch("app.services.background_removal.get_provider", return_value=_FakeProvider()):
            result = service.remove_background(paths["image_path"])

        backup = tmp_path / result["original_backup_path"]
        assert backup.read_bytes() == before
        assert Image.open(backup).format == "JPEG"

    @pytest.mark.asyncio
    async def test_a_second_removal_does_not_eat_the_original(self, service, tmp_path) -> None:
        """The stem is shared by the .jpg photo and the .webp cut-out, so the
        backup name has to be stable or the second pass would overwrite it."""
        paths = await service.process_and_store(uuid.uuid4(), _photo(), "jumper.jpg")
        original = (tmp_path / paths["image_path"]).read_bytes()

        with patch("app.services.background_removal.get_provider", return_value=_FakeProvider()):
            first = service.remove_background(paths["image_path"])
            second = service.remove_background(first["image_path"])

        assert second["original_backup_path"] == first["original_backup_path"]
        assert (tmp_path / second["original_backup_path"]).read_bytes() == original

    @pytest.mark.asyncio
    async def test_a_caller_that_wants_a_flat_image_still_gets_one(self, service, tmp_path) -> None:
        paths = await service.process_and_store(uuid.uuid4(), _photo(), "jumper.jpg")

        with patch("app.services.background_removal.get_provider", return_value=_FakeProvider()):
            result = service.remove_background(paths["image_path"], bg_color=(255, 255, 255))

        flat = Image.open(tmp_path / result["image_path"])
        assert result["image_path"].endswith(".jpg")
        assert flat.mode == "RGB"
        assert flat.getpixel((2, 2)) == (255, 255, 255)


class TestRotateAndRestore:
    @pytest.mark.asyncio
    async def test_rotating_a_cutout_keeps_it_a_cutout(self, service, tmp_path) -> None:
        paths = await service.process_and_store(uuid.uuid4(), _photo((200, 300)), "j.jpg")
        with patch("app.services.background_removal.get_provider", return_value=_FakeProvider()):
            cut = service.remove_background(paths["image_path"])

        before = Image.open(tmp_path / cut["image_path"])
        rotated_paths = service.rotate_image(cut["image_path"], "cw")

        rotated = Image.open(tmp_path / rotated_paths["image_path"])
        assert rotated.format == "WEBP"
        assert rotated.mode == "RGBA"
        assert rotated.size == (before.height, before.width)

    @pytest.mark.asyncio
    async def test_restore_puts_the_jpeg_back_under_its_old_name(self, service, tmp_path) -> None:
        paths = await service.process_and_store(uuid.uuid4(), _photo(), "jumper.jpg")
        with patch("app.services.background_removal.get_provider", return_value=_FakeProvider()):
            cut = service.remove_background(paths["image_path"])

        restored = service.restore_original(cut["image_path"], cut["original_backup_path"])

        assert restored["image_path"] == paths["image_path"]
        assert Image.open(tmp_path / restored["image_path"]).mode == "RGB"
        # The backup is consumed, and the cut-out files are now stale.
        assert not (tmp_path / cut["original_backup_path"]).exists()

    @pytest.mark.asyncio
    async def test_delete_replaced_only_bins_what_is_no_longer_used(
        self, service, tmp_path
    ) -> None:
        paths = await service.process_and_store(uuid.uuid4(), _photo(), "jumper.jpg")
        with patch("app.services.background_removal.get_provider", return_value=_FakeProvider()):
            cut = service.remove_background(paths["image_path"])

        service.delete_replaced(
            [paths["image_path"], paths["medium_path"], paths["thumbnail_path"]],
            [cut["image_path"], cut["medium_path"], cut["thumbnail_path"]],
        )

        assert not (tmp_path / paths["image_path"]).exists()
        assert (tmp_path / cut["image_path"]).exists()
        # The backup is not in either list and must survive.
        assert (tmp_path / cut["original_backup_path"]).exists()


class TestServingACutout:
    """The route that hands the browser the file has to say `image/webp`."""

    @pytest.mark.asyncio
    async def test_webp_is_served_as_webp_with_its_alpha(
        self, client, test_user, auth_headers, tmp_path
    ) -> None:
        service = ImageService()
        paths = await service.process_and_store(test_user.id, _photo(), "jumper.jpg")
        with patch("app.services.background_removal.get_provider", return_value=_FakeProvider()):
            cut = service.remove_background(paths["image_path"])

        response = await client.get(f"/api/v1/images/{cut['image_path']}", headers=auth_headers)

        assert response.status_code == 200
        assert response.headers["content-type"] == "image/webp"
        served = Image.open(BytesIO(response.content))
        assert served.format == "WEBP"
        assert served.mode == "RGBA"

    def test_the_item_response_says_whether_it_is_a_cutout(self) -> None:
        """The grid needs to know: a cut-out must not be drawn with multiply."""
        from app.schemas.item import ItemResponse

        cut = ItemResponse.model_construct(image_path="u/a.webp", thumbnail_path="u/a_thumb.webp")
        flat = ItemResponse.model_construct(image_path="u/a.jpg", thumbnail_path="u/a_thumb.jpg")

        assert cut.has_cutout is True
        assert flat.has_cutout is False
        assert "has_cutout" in ItemResponse.model_json_schema(mode="serialization")["properties"]

    def test_an_outfit_item_says_it_too(self) -> None:
        """The flat lay is the screen that most needs to know.

        It lays the garments on the look's own tint: a real cut-out floats there
        with a shadow the shape of the garment, while a photo with white baked in
        has to be clipped to a tile or it reads as a white rectangle over the
        others. The outfit payload is a shape of its own, so the flag has to be on
        it as well as on ``ItemResponse``.
        """
        from app.api.outfits import OutfitItemResponse

        cut = OutfitItemResponse.model_construct(
            image_path="u/a.webp", thumbnail_path="u/a_thumb.webp"
        )
        flat = OutfitItemResponse.model_construct(
            image_path="u/a.jpg", thumbnail_path="u/a_thumb.jpg"
        )
        # A garment with no photo at all is not a cut-out either.
        empty = OutfitItemResponse.model_construct(image_path=None, thumbnail_path=None)

        assert cut.has_cutout is True
        assert flat.has_cutout is False
        assert empty.has_cutout is False
        schema = OutfitItemResponse.model_json_schema(mode="serialization")
        assert "has_cutout" in schema["properties"]
