"""Where "every photo knows its side" meets "the user can fix the cut-out by hand".

Two features arrived at the same screens from different directions. One made every
photo of a garment carry the side it shows and gave the extra photos their own
cut-out, their own untouched original and their own label. The other gave the user an
eraser over the stored alpha, and a queue that straightens a photo without making
anyone wait. Separately each was right; together the eraser and the rotation could
only ever reach the garment's *own* photo, so a user looking at the back of a jumper
and reaching for either one would have silently edited the front.

So what is pinned here is the seam:

* erasing an extra photo lands on that photo and on nothing else — not on the
  garment's own photo, and not on the garment's row;
* a photo's label is not a casualty of editing it: erasing, resetting and
  straightening all leave "detrás" saying detrás, for the primary photo and for the
  extra ones alike;
* straightening reaches the extra photos too, and collapses several taps the way the
  garment's own photo already did.
"""

import uuid
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import ClothingItem, ItemImage, ItemStatus
from app.models.user import User
from app.services.image_service import ImageService

CLOTH = (198, 74, 96)
PAPER = (238, 236, 231)

#: An enclosed hole, well inside the garment: the case the automatic cut-out gets
#: wrong and the eraser exists to finish.
HOLE = (0.40, 0.18, 0.60, 0.32)


def _photo(size: tuple[int, int] = (240, 360)) -> bytes:
    """A garment on paper with a hole in it, the way a halter top has one."""
    image = Image.new("RGB", size, PAPER)
    body = Image.new("RGB", (int(size[0] * 0.7), int(size[1] * 0.8)), CLOTH)
    image.paste(body, (int(size[0] * 0.15), int(size[1] * 0.1)))
    hole = Image.new(
        "RGB",
        (int(size[0] * (HOLE[2] - HOLE[0])), int(size[1] * (HOLE[3] - HOLE[1]))),
        PAPER,
    )
    image.paste(hole, (int(size[0] * HOLE[0]), int(size[1] * HOLE[1])))
    out = BytesIO()
    image.save(out, format="JPEG", quality=95)
    return out.getvalue()


def _alpha_from_colour(image: Image.Image) -> Image.Image:
    rgb = image.convert("RGB")
    alpha = Image.new("L", rgb.size, 0)
    alpha.putdata(
        [
            0
            if abs(r - PAPER[0]) < 24 and abs(g - PAPER[1]) < 24 and abs(b - PAPER[2]) < 24
            else 255
            for r, g, b in rgb.getdata()
        ]
    )
    return alpha


class _HolePunchingProvider:
    def remove(self, image: Image.Image) -> Image.Image:
        result = image.convert("RGBA")
        result.putalpha(_alpha_from_colour(image))
        return result


def _provider():
    return patch(
        "app.services.background_removal.get_provider", return_value=_HolePunchingProvider()
    )


def _stroke(size: tuple[int, int], box, colour) -> bytes:
    """A brush mask: `colour` is (255,0,0) to erase or (0,255,0) to restore."""
    mask = Image.new("RGBA", size, (0, 0, 0, 0))
    left = int(size[0] * box[0])
    top = int(size[1] * box[1])
    right = int(size[0] * box[2])
    bottom = int(size[1] * box[3])
    mask.paste(Image.new("RGBA", (right - left, bottom - top), (*colour, 255)), (left, top))
    out = BytesIO()
    mask.save(out, format="PNG")
    return out.getvalue()


def _alpha_at(path: Path, fraction: tuple[float, float]) -> int:
    image = Image.open(path).convert("RGBA")
    x = min(int(image.width * fraction[0]), image.width - 1)
    y = min(int(image.height * fraction[1]), image.height - 1)
    return image.getchannel("A").getpixel((x, y))


async def _cut_out_photo(service: ImageService, user: User) -> dict:
    """A stored, background-removed photo, as either side of a garment could be."""
    paths = await service.process_and_store(user.id, _photo(), f"{uuid.uuid4()}.jpg")
    with _provider():
        return service.remove_background(paths["image_path"])


@pytest_asyncio.fixture
async def garment_with_a_back(db_session: AsyncSession, test_user: User):
    """A garment whose front and back are both real, separately cut-out photos.

    Both sides go through the same pipeline on purpose: the point of the tests below
    is that two photos in the same state are still two photos, and editing one is
    not editing the other.
    """
    service = ImageService()
    front = await _cut_out_photo(service, test_user)
    back = await _cut_out_photo(service, test_user)

    item = ClothingItem(
        user_id=test_user.id,
        type="top",
        image_path=front["image_path"],
        medium_path=front["medium_path"],
        thumbnail_path=front["thumbnail_path"],
        original_image_path=front["original_backup_path"],
        image_view="front",
        status=ItemStatus.ready,
    )
    db_session.add(item)
    await db_session.commit()
    await db_session.refresh(item)

    extra = ItemImage(
        item_id=item.id,
        image_path=back["image_path"],
        medium_path=back["medium_path"],
        thumbnail_path=back["thumbnail_path"],
        original_image_path=back["original_backup_path"],
        position=0,
        image_view="back",
    )
    db_session.add(extra)
    await db_session.commit()
    await db_session.refresh(extra)
    return item, extra, service


def _erase_over_the_garment(service: ImageService, path: str) -> dict:
    """A red stroke across the lower half of a stored photo, as the client sends it."""
    size = Image.open(service.get_image_path(path)).size
    return {"mask": ("mask.png", _stroke(size, (0.1, 0.6, 0.9, 0.95), (255, 0, 0)), "image/png")}


class TestErasingOneExtraPhoto:
    """The back photo is erasable, and erasing it is not erasing the front."""

    @pytest.mark.asyncio
    async def test_the_strokes_land_on_that_photo(
        self, client: AsyncClient, auth_headers, garment_with_a_back
    ) -> None:
        item, extra, service = garment_with_a_back
        before = service.get_image_path(extra.image_path)
        assert _alpha_at(before, (0.5, 0.75)) > 215

        response = await client.post(
            f"/api/v1/items/{item.id}/images/{extra.id}/cutout-mask",
            headers=auth_headers,
            files=_erase_over_the_garment(service, extra.image_path),
            data={"space": "cutout"},
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["has_cutout"] is True
        after = service.get_image_path(body["image_path"])
        assert _alpha_at(after, (0.5, 0.8)) < 40

    @pytest.mark.asyncio
    async def test_and_nowhere_near_the_garments_own_photo(
        self, client: AsyncClient, auth_headers, garment_with_a_back
    ) -> None:
        item, extra, service = garment_with_a_back
        front_path = item.image_path
        front_before = service.get_image_path(front_path).read_bytes()

        response = await client.post(
            f"/api/v1/items/{item.id}/images/{extra.id}/cutout-mask",
            headers=auth_headers,
            files=_erase_over_the_garment(service, extra.image_path),
            data={"space": "cutout"},
        )
        assert response.status_code == 200, response.text

        kept = await client.get(f"/api/v1/items/{item.id}", headers=auth_headers)
        assert kept.status_code == 200
        # The same file, byte for byte, at the same path: the front was not
        # re-rendered, not moved and not repainted.
        assert kept.json()["image_path"] == front_path
        assert service.get_image_path(front_path).read_bytes() == front_before
        assert _alpha_at(service.get_image_path(front_path), (0.5, 0.8)) > 215

    @pytest.mark.asyncio
    async def test_the_photo_is_still_the_back_afterwards(
        self, client: AsyncClient, auth_headers, garment_with_a_back
    ) -> None:
        """Erasing is not relabelling. The eraser rewrites files, never the label."""
        item, extra, service = garment_with_a_back

        response = await client.post(
            f"/api/v1/items/{item.id}/images/{extra.id}/cutout-mask",
            headers=auth_headers,
            files=_erase_over_the_garment(service, extra.image_path),
            data={"space": "cutout"},
        )

        assert response.status_code == 200, response.text
        assert response.json()["image_view"] == "back"
        # And the garment still answers "yes, I have a back" — the derived back_image
        # reads the label, so losing it would quietly empty "ver por detrás".
        kept = await client.get(f"/api/v1/items/{item.id}", headers=auth_headers)
        assert kept.json()["back_image"] is not None

    @pytest.mark.asyncio
    async def test_its_own_original_is_what_it_paints_back_from(
        self, client: AsyncClient, auth_headers, garment_with_a_back
    ) -> None:
        """The extra photo's untouched version is on the wire, signed, per photo.

        Without it the eraser on a back photo could only erase: "devolver" has to
        show the pixels that were really there, and a stored cut-out keeps nothing
        usable under its own transparency.
        """
        item, extra, _ = garment_with_a_back

        response = await client.get(f"/api/v1/items/{item.id}", headers=auth_headers)

        assert response.status_code == 200, response.text
        moved = response.json()["additional_images"][0]
        assert moved["can_restore_original"] is True
        assert moved["original_image_url"]
        # The path itself stays off the wire; only the signed URL goes out.
        assert "original_image_path" not in moved

    @pytest.mark.asyncio
    async def test_going_back_to_automatic_is_per_photo_too(
        self, client: AsyncClient, auth_headers, garment_with_a_back
    ) -> None:
        item, extra, service = garment_with_a_back
        await client.post(
            f"/api/v1/items/{item.id}/images/{extra.id}/cutout-mask",
            headers=auth_headers,
            files=_erase_over_the_garment(service, extra.image_path),
            data={"space": "cutout"},
        )

        reset = await client.delete(
            f"/api/v1/items/{item.id}/images/{extra.id}/cutout-mask", headers=auth_headers
        )

        assert reset.status_code == 200, reset.text
        body = reset.json()
        back = service.get_image_path(body["image_path"])
        # What the model decided: the garment opaque, the enclosed hole transparent.
        assert _alpha_at(back, (0.5, 0.75)) > 215
        assert _alpha_at(back, (0.5, 0.26)) < 40
        assert body["image_view"] == "back"

    @pytest.mark.asyncio
    async def test_someone_elses_garment_has_no_photos_to_erase(
        self, client: AsyncClient, garment_with_a_back
    ) -> None:
        item, extra, service = garment_with_a_back

        response = await client.post(
            f"/api/v1/items/{item.id}/images/{extra.id}/cutout-mask",
            files=_erase_over_the_garment(service, extra.image_path),
            data={"space": "cutout"},
        )

        assert response.status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_a_photo_that_is_not_this_garments_is_not_found(
        self, client: AsyncClient, auth_headers, garment_with_a_back
    ) -> None:
        item, extra, service = garment_with_a_back

        response = await client.post(
            f"/api/v1/items/{item.id}/images/{uuid.uuid4()}/cutout-mask",
            headers=auth_headers,
            files=_erase_over_the_garment(service, extra.image_path),
            data={"space": "cutout"},
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_an_unknown_space_is_rejected(
        self, client: AsyncClient, auth_headers, garment_with_a_back
    ) -> None:
        item, extra, service = garment_with_a_back

        response = await client.post(
            f"/api/v1/items/{item.id}/images/{extra.id}/cutout-mask",
            headers=auth_headers,
            files=_erase_over_the_garment(service, extra.image_path),
            data={"space": "elsewhere"},
        )

        assert response.status_code == 400


class TestErasingTheGarmentsOwnPhoto:
    @pytest.mark.asyncio
    async def test_keeps_the_side_it_was_labelled(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        """A garment whose one photo is its back is still a back photo after an edit.

        The eraser re-renders all three sizes under new names, so the row moves; the
        label is a column of its own and must not be along for the ride.
        """
        service = ImageService()
        cut = await _cut_out_photo(service, test_user)
        item = ClothingItem(
            user_id=test_user.id,
            type="top",
            image_path=cut["image_path"],
            medium_path=cut["medium_path"],
            thumbnail_path=cut["thumbnail_path"],
            original_image_path=cut["original_backup_path"],
            image_view="back",
            status=ItemStatus.ready,
        )
        db_session.add(item)
        await db_session.commit()
        await db_session.refresh(item)

        response = await client.post(
            f"/api/v1/items/{item.id}/cutout-mask",
            headers=auth_headers,
            files=_erase_over_the_garment(service, item.image_path),
            data={"space": "cutout"},
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["image_view"] == "back"
        # Which is the whole point: the garment is still its own back photo, so the
        # flat lay can still turn it round.
        assert body["back_image"] is not None


class TestStraighteningAnExtraPhoto:
    """The rotation queue reaches the back photo, one request per photo as before."""

    @pytest.mark.asyncio
    async def test_the_extra_photo_turns(
        self, client: AsyncClient, auth_headers, garment_with_a_back
    ) -> None:
        item, extra, service = garment_with_a_back
        before = Image.open(service.get_image_path(extra.image_path)).size

        response = await client.post(
            f"/api/v1/items/{item.id}/images/{extra.id}/rotate?direction=cw&quarters=1",
            headers=auth_headers,
        )

        assert response.status_code == 200, response.text
        body = response.json()
        # A quarter turn swaps the sides; the filenames do not change, because a turn
        # rewrites the same files in place.
        assert body["image_path"] == extra.image_path
        after = Image.open(service.get_image_path(body["image_path"])).size
        assert after == (before[1], before[0])
        assert body["image_view"] == "back"

    @pytest.mark.asyncio
    async def test_and_the_garments_own_photo_stays_where_it_was(
        self, client: AsyncClient, auth_headers, garment_with_a_back
    ) -> None:
        item, extra, service = garment_with_a_back
        front_before = Image.open(service.get_image_path(item.image_path)).size

        await client.post(
            f"/api/v1/items/{item.id}/images/{extra.id}/rotate?direction=cw&quarters=1",
            headers=auth_headers,
        )

        assert Image.open(service.get_image_path(item.image_path)).size == front_before

    @pytest.mark.asyncio
    async def test_several_taps_collapse_into_one_half_turn(
        self, client: AsyncClient, auth_headers, garment_with_a_back
    ) -> None:
        item, extra, service = garment_with_a_back
        before = Image.open(service.get_image_path(extra.image_path)).size

        response = await client.post(
            f"/api/v1/items/{item.id}/images/{extra.id}/rotate?direction=cw&quarters=2",
            headers=auth_headers,
        )

        assert response.status_code == 200, response.text
        # Two quarters is upright again, at the original proportions.
        assert Image.open(service.get_image_path(extra.image_path)).size == before

    @pytest.mark.asyncio
    async def test_a_whole_turn_is_refused_rather_than_wasted(
        self, client: AsyncClient, auth_headers, garment_with_a_back
    ) -> None:
        """The client already collapses four taps into nothing; the API agrees."""
        item, extra, _ = garment_with_a_back

        response = await client.post(
            f"/api/v1/items/{item.id}/images/{extra.id}/rotate?direction=cw&quarters=4",
            headers=auth_headers,
        )

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_an_erased_back_stays_erased_after_being_straightened(
        self, client: AsyncClient, auth_headers, garment_with_a_back
    ) -> None:
        """The sidecar alpha turns with the photo, or straightening undoes the fix."""
        item, extra, service = garment_with_a_back
        erased = await client.post(
            f"/api/v1/items/{item.id}/images/{extra.id}/cutout-mask",
            headers=auth_headers,
            files=_erase_over_the_garment(service, extra.image_path),
            data={"space": "cutout"},
        )
        assert erased.status_code == 200, erased.text
        stored = erased.json()["image_path"]
        assert _alpha_at(service.get_image_path(stored), (0.5, 0.8)) < 40

        turned = await client.post(
            f"/api/v1/items/{item.id}/images/{extra.id}/rotate?direction=cw&quarters=2",
            headers=auth_headers,
        )

        assert turned.status_code == 200, turned.text
        # Half a turn later the erased band is at the top, still erased.
        assert _alpha_at(service.get_image_path(turned.json()["image_path"]), (0.5, 0.2)) < 40

    @pytest.mark.asyncio
    async def test_a_photo_that_is_not_this_garments_is_not_found(
        self, client: AsyncClient, auth_headers, garment_with_a_back
    ) -> None:
        item, _, _ = garment_with_a_back

        response = await client.post(
            f"/api/v1/items/{item.id}/images/{uuid.uuid4()}/rotate?direction=cw",
            headers=auth_headers,
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_signing_in_is_required(self, client: AsyncClient, garment_with_a_back) -> None:
        item, extra, _ = garment_with_a_back

        response = await client.post(f"/api/v1/items/{item.id}/images/{extra.id}/rotate")

        assert response.status_code in (401, 403)


class TestTheRowItselfIsLeftAlone:
    @pytest.mark.asyncio
    async def test_erasing_an_extra_photo_moves_no_other_photo(
        self, client: AsyncClient, auth_headers, garment_with_a_back, db_session: AsyncSession
    ) -> None:
        """One row changes, and it keeps its place in the strip."""
        item, extra, service = garment_with_a_back

        response = await client.post(
            f"/api/v1/items/{item.id}/images/{extra.id}/cutout-mask",
            headers=auth_headers,
            files=_erase_over_the_garment(service, extra.image_path),
            data={"space": "cutout"},
        )
        assert response.status_code == 200, response.text

        rows = (
            (await db_session.execute(select(ItemImage).where(ItemImage.item_id == item.id)))
            .scalars()
            .all()
        )
        assert len(rows) == 1
        assert rows[0].position == 0
        assert rows[0].image_view == "back"
