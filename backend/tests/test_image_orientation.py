"""A phone photo is stored the way it was taken.

Phones rarely rotate pixels: they write the sensor orientation into an EXIF tag
and leave it to the reader. Nothing downstream of the upload honoured it, so a
portrait photo of a pair of jeans was resized, hashed, cut out and stored on its
side. These tests pin the fix, and pin that the metadata does not come along for
the ride — a wardrobe thumbnail must not carry the GPS coordinates of the
bedroom it was taken in.
"""

import uuid
from io import BytesIO

import pytest
from PIL import Image

from app.services.image_service import CropBox, ImageService

# EXIF orientation 6: "rotate 90° clockwise to display". A phone held upright
# writes this and stores the pixels landscape.
ORIENTATION_ROTATE_90_CW = 6
_GPS_IFD = 0x8825


def _sideways_jpeg() -> bytes:
    """A landscape image that says "I am really a portrait", plus a GPS tag.

    Landscape pixels, 90x30: red on the left third, white elsewhere. Displayed
    upright (turned 90° clockwise) the red band must end up along the top.
    """
    image = Image.new("RGB", (90, 30), (255, 255, 255))
    for x in range(30):
        for y in range(30):
            image.putpixel((x, y), (255, 0, 0))

    exif = image.getexif()
    exif[0x0112] = ORIENTATION_ROTATE_90_CW  # Orientation
    exif[0x010F] = "TestPhone"  # Make
    gps = exif.get_ifd(_GPS_IFD)
    gps[1] = "N"
    gps[2] = (41.0, 23.0, 0.0)

    out = BytesIO()
    image.save(out, format="JPEG", quality=95, exif=exif)
    return out.getvalue()


def _upright_jpeg(size: tuple[int, int] = (90, 30)) -> bytes:
    out = BytesIO()
    Image.new("RGB", size, (255, 255, 255)).save(out, format="JPEG", quality=95)
    return out.getvalue()


def test_fixture_really_is_sideways() -> None:
    """Guard the fixture itself: without the fix there is nothing to test."""
    raw = Image.open(BytesIO(_sideways_jpeg()))
    assert raw.size == (90, 30)
    assert raw.getexif()[0x0112] == ORIENTATION_ROTATE_90_CW


def test_load_upload_turns_the_photo_upright() -> None:
    service = ImageService(storage_path="/tmp/unused-orientation")
    image = service.load_upload(_sideways_jpeg(), "jeans.jpg")

    # Portrait now, not landscape.
    assert image.size == (30, 90)
    # The red band was down the left edge; turned 90° clockwise it is along the top.
    assert image.getpixel((15, 5))[0] > 200
    assert image.getpixel((15, 5))[1] < 80
    # ...and the bottom is the white part.
    assert min(image.getpixel((15, 85))) > 200


@pytest.mark.asyncio
async def test_stored_sizes_are_upright_and_carry_no_metadata(tmp_path) -> None:
    service = ImageService(storage_path=str(tmp_path))
    user_id = uuid.uuid4()

    paths = await service.process_and_store(user_id, _sideways_jpeg(), "jeans.jpg")

    for key in ("image_path", "medium_path", "thumbnail_path"):
        stored = Image.open(tmp_path / paths[key])
        assert stored.width < stored.height, f"{key} was stored sideways"
        assert not stored.getexif(), f"{key} still carries EXIF"
        assert "exif" not in stored.info
        assert "GPS" not in str(stored.info)


@pytest.mark.asyncio
async def test_the_same_photo_hashes_the_same_however_the_phone_tagged_it(tmp_path) -> None:
    """The duplicate check compares garments, not sensor orientations."""
    service = ImageService(storage_path=str(tmp_path))

    sideways = service.compute_phash(_sideways_jpeg(), "jeans.jpg")

    # The same picture, already rotated by the phone and with no orientation tag.
    upright_pixels = Image.open(BytesIO(_sideways_jpeg())).rotate(-90, expand=True)
    out = BytesIO()
    upright_pixels.save(out, format="JPEG", quality=95)

    assert sideways == service.compute_phash(out.getvalue(), "jeans.jpg")


@pytest.mark.asyncio
async def test_rotate_and_crop_are_applied_to_what_is_stored(tmp_path) -> None:
    service = ImageService(storage_path=str(tmp_path))
    user_id = uuid.uuid4()

    paths = await service.process_and_store(
        user_id,
        _upright_jpeg((100, 200)),
        "trousers.jpg",
        rotate=1,
        crop=CropBox(x=0, y=0, width=120, height=100),
    )

    # Turned clockwise: 100x200 becomes 200x100, then cropped to 120x100.
    stored = Image.open(tmp_path / paths["image_path"])
    assert stored.size == (120, 100)


@pytest.mark.asyncio
async def test_a_silly_crop_keeps_the_whole_photo(tmp_path) -> None:
    """A stray tap must not save a garment as a 2-pixel sliver."""
    service = ImageService(storage_path=str(tmp_path))

    paths = await service.process_and_store(
        uuid.uuid4(), _upright_jpeg((100, 200)), "x.jpg", crop=CropBox(0, 0, 2, 2)
    )

    assert Image.open(tmp_path / paths["image_path"]).size == (100, 200)


@pytest.mark.asyncio
async def test_a_crop_past_the_edge_is_pulled_back_inside(tmp_path) -> None:
    service = ImageService(storage_path=str(tmp_path))

    paths = await service.process_and_store(
        uuid.uuid4(), _upright_jpeg((100, 200)), "x.jpg", crop=CropBox(90, 190, 60, 60)
    )

    assert Image.open(tmp_path / paths["image_path"]).size == (60, 60)
