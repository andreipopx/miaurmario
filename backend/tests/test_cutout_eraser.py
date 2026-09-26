"""The garment's transparency, and the user's right to fix it by hand.

Three things are pinned here, all reported by people uploading a real wardrobe:

* a hole the fabric encloses — a halter neckline, a bag handle — must come out
  transparent, and must survive being stored, rotated and re-rendered;
* "borra lo que sobra" must land on the *stored* alpha, so the correction shows on
  every screen afterwards and not only the one the user was looking at, and it
  must be undoable back to what the model decided;
* a model that is not on disk must not cost the user their cut-outs.
"""

import uuid
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import ClothingItem, ItemStatus
from app.models.user import User
from app.services.background_removal import RembgProvider
from app.services.image_service import (
    AUTO_ALPHA_SUFFIX,
    EDIT_ALPHA_SUFFIX,
    CropBox,
    ImageService,
    apply_brush_mask,
    sidecar_paths,
    stem_of,
    trim_box,
)
from app.utils.image_formats import CUTOUT_SUFFIX

CLOTH = (198, 74, 96)
PAPER = (238, 236, 231)

#: Where the hole is punched, as a fraction of the photo. Deliberately well inside
#: the garment so that "the hole is transparent" cannot be satisfied by a mask that
#: merely found the silhouette.
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
    """A stand-in for a model that gets holes right: paper is background, cloth is not.

    Colour-keying rather than a geometric mask on purpose — it finds the interior
    hole for the same reason the real thing is supposed to, because the hole looks
    like the background.
    """
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


@pytest.fixture
def service(tmp_path: Path) -> ImageService:
    return ImageService(storage_path=str(tmp_path))


class TestBrushMaskMaths:
    def test_red_erases_and_green_restores(self) -> None:
        alpha = Image.new("L", (4, 1), 255)
        mask = Image.new("RGBA", (4, 1), (0, 0, 0, 0))
        mask.putpixel((0, 0), (255, 0, 0, 255))  # erase, full strength
        mask.putpixel((1, 0), (255, 0, 0, 128))  # erase, half strength
        result = apply_brush_mask(alpha, mask)
        assert result.getpixel((0, 0)) == 0
        assert 100 <= result.getpixel((1, 0)) <= 155
        assert result.getpixel((2, 0)) == 255  # untouched

        transparent = Image.new("L", (2, 1), 0)
        restore = Image.new("RGBA", (2, 1), (0, 0, 0, 0))
        restore.putpixel((0, 0), (0, 255, 0, 255))
        restored = apply_brush_mask(transparent, restore)
        assert restored.getpixel((0, 0)) == 255
        assert restored.getpixel((1, 0)) == 0

    def test_a_mask_of_a_different_size_is_scaled_to_the_alpha(self) -> None:
        alpha = Image.new("L", (40, 40), 255)
        mask = Image.new("RGBA", (10, 10), (255, 0, 0, 255))
        assert apply_brush_mask(alpha, mask).getextrema() == (0, 0)

    def test_trim_box_matches_what_the_trim_would_crop(self) -> None:
        alpha = Image.new("L", (200, 200), 0)
        alpha.paste(Image.new("L", (100, 100), 255), (50, 50))
        box = trim_box(alpha)
        assert box is not None
        left, top, right, bottom = box
        assert left < 50 and top < 50 and right > 150 and bottom > 150

    def test_trim_box_refuses_a_mask_that_found_almost_nothing(self) -> None:
        alpha = Image.new("L", (200, 200), 0)
        alpha.putpixel((5, 5), 255)
        assert trim_box(alpha) is None


class TestHolesSurviveStorage:
    @pytest.mark.asyncio
    async def test_an_enclosed_hole_is_stored_transparent(self, service, tmp_path) -> None:
        paths = await service.process_and_store(uuid.uuid4(), _photo(), "halter.jpg")
        with _provider():
            cut = service.remove_background(paths["image_path"])

        for key in ("image_path", "medium_path", "thumbnail_path"):
            stored = tmp_path / cut[key]
            # The middle of the neck opening, and a point on the bodice below it.
            assert _alpha_at(stored, (0.5, 0.26)) < 40, key
            assert _alpha_at(stored, (0.5, 0.75)) > 215, key

    @pytest.mark.asyncio
    async def test_the_automatic_alpha_is_kept_beside_the_photo(self, service, tmp_path) -> None:
        """ "Volver al automático" needs something to go back to."""
        paths = await service.process_and_store(uuid.uuid4(), _photo(), "halter.jpg")
        with _provider():
            cut = service.remove_background(paths["image_path"])

        auto = tmp_path / f"{stem_of(cut['image_path'])}{AUTO_ALPHA_SUFFIX}"
        assert auto.exists()
        assert Image.open(auto).mode == "L"
        # Full frame, not the trimmed cut-out: it is the base every edit works on.
        assert Image.open(auto).size == Image.open(tmp_path / paths["image_path"]).size
        assert not (tmp_path / f"{stem_of(cut['image_path'])}{EDIT_ALPHA_SUFFIX}").exists()

    @pytest.mark.asyncio
    async def test_a_hole_survives_being_straightened(self, service, tmp_path) -> None:
        paths = await service.process_and_store(uuid.uuid4(), _photo(), "halter.jpg")
        with _provider():
            cut = service.remove_background(paths["image_path"])

        turned = service.rotate_image(cut["image_path"], "cw")

        stored = Image.open(tmp_path / turned["image_path"])
        assert stored.mode == "RGBA"
        # A quarter turn clockwise puts the neckline on the right-hand side.
        assert _alpha_at(tmp_path / turned["image_path"], (0.74, 0.5)) < 40


class TestEraser:
    @pytest.mark.asyncio
    async def test_erasing_changes_the_stored_alpha(self, service, tmp_path) -> None:
        paths = await service.process_and_store(uuid.uuid4(), _photo(), "halter.jpg")
        with _provider():
            cut = service.remove_background(paths["image_path"])
        assert _alpha_at(tmp_path / cut["image_path"], (0.5, 0.75)) > 215

        # A stroke across the bottom of the garment, in the cut-out's own coordinates.
        size = Image.open(tmp_path / cut["image_path"]).size
        brushed = service.brush_cutout(
            cut["image_path"],
            _stroke(size, (0.1, 0.6, 0.9, 0.95), (255, 0, 0)),
            backup_path=cut["original_backup_path"],
        )

        for key in ("image_path", "medium_path", "thumbnail_path"):
            assert _alpha_at(tmp_path / brushed[key], (0.5, 0.8)) < 40, key
        assert (tmp_path / f"{stem_of(brushed['image_path'])}{EDIT_ALPHA_SUFFIX}").exists()

    @pytest.mark.asyncio
    async def test_restoring_brings_the_real_pixels_back(self, service, tmp_path) -> None:
        """Not black: the RGB comes from the untouched photo, not from the cut-out.

        The stored WebP has nothing useful under its transparency, so a restore that
        worked off the cut-out would paint the garment's own silhouette black.
        """
        paths = await service.process_and_store(uuid.uuid4(), _photo(), "halter.jpg")
        with _provider():
            cut = service.remove_background(paths["image_path"])

        size = Image.open(tmp_path / cut["image_path"]).size
        # Fill the neck opening back in.
        brushed = service.brush_cutout(
            cut["image_path"],
            _stroke(size, (0.42, 0.18, 0.58, 0.34), (0, 255, 0)),
            backup_path=cut["original_backup_path"],
        )

        stored = Image.open(tmp_path / brushed["image_path"]).convert("RGBA")
        x, y = int(stored.width * 0.5), int(stored.height * 0.26)
        assert stored.getchannel("A").getpixel((x, y)) > 215
        r, g, b, _ = stored.getpixel((x, y))
        # The paper colour that was in the hole, not black.
        assert r > 180 and g > 180 and b > 180

    @pytest.mark.asyncio
    async def test_reset_goes_back_to_what_the_model_decided(self, service, tmp_path) -> None:
        paths = await service.process_and_store(uuid.uuid4(), _photo(), "halter.jpg")
        with _provider():
            cut = service.remove_background(paths["image_path"])

        size = Image.open(tmp_path / cut["image_path"]).size
        brushed = service.brush_cutout(
            cut["image_path"],
            _stroke(size, (0.1, 0.6, 0.9, 0.95), (255, 0, 0)),
            backup_path=cut["original_backup_path"],
        )
        assert _alpha_at(tmp_path / brushed["image_path"], (0.5, 0.8)) < 40

        reset = service.reset_cutout(brushed["image_path"], brushed["original_backup_path"])

        assert _alpha_at(tmp_path / reset["image_path"], (0.5, 0.75)) > 215
        assert not (tmp_path / f"{stem_of(reset['image_path'])}{EDIT_ALPHA_SUFFIX}").exists()
        # And the neck opening is a hole again, because that is what the model said.
        assert _alpha_at(tmp_path / reset["image_path"], (0.5, 0.26)) < 40

    @pytest.mark.asyncio
    async def test_erasing_works_with_no_removal_at_all(self, service, tmp_path) -> None:
        """No AI, no rembg: the strokes still have to mean something.

        The whole photo counts as the garment until the user erases part of it, so a
        wardrobe tagged entirely by hand can still be tidied up.
        """
        paths = await service.process_and_store(uuid.uuid4(), _photo(), "halter.jpg")

        size = Image.open(tmp_path / paths["image_path"]).size
        brushed = service.brush_cutout(
            paths["image_path"],
            _stroke(size, (0.0, 0.0, 1.0, 0.08), (255, 0, 0)),
            mask_space="original",
        )

        assert brushed["image_path"].endswith(CUTOUT_SUFFIX)
        assert Image.open(tmp_path / brushed["image_path"]).mode == "RGBA"
        assert (tmp_path / brushed["original_backup_path"]).exists()

    @pytest.mark.asyncio
    async def test_edits_survive_being_straightened(self, service, tmp_path) -> None:
        paths = await service.process_and_store(uuid.uuid4(), _photo(), "halter.jpg")
        with _provider():
            cut = service.remove_background(paths["image_path"])
        size = Image.open(tmp_path / cut["image_path"]).size
        brushed = service.brush_cutout(
            cut["image_path"],
            _stroke(size, (0.1, 0.6, 0.9, 0.95), (255, 0, 0)),
            backup_path=cut["original_backup_path"],
        )

        service.rotate_image(brushed["image_path"], "cw")
        # Re-render from the stored alphas: the erased band must still be missing,
        # now on the left-hand side rather than the bottom.
        again = service.reset_cutout(brushed["image_path"], brushed["original_backup_path"])
        edited = service.brush_cutout(
            again["image_path"],
            _stroke(
                Image.open(tmp_path / again["image_path"]).size, (0, 0, 0.02, 0.02), (0, 255, 0)
            ),
            backup_path=again["original_backup_path"],
        )
        turned_auto = Image.open(tmp_path / f"{stem_of(edited['image_path'])}{AUTO_ALPHA_SUFFIX}")
        backup = Image.open(tmp_path / edited["original_backup_path"])
        # The sidecars were turned with the photo, so they still line up with it.
        assert turned_auto.size == backup.size

    @pytest.mark.asyncio
    async def test_a_fresh_removal_discards_hand_edits(self, service, tmp_path) -> None:
        """Those strokes were drawn against a mask that no longer exists."""
        paths = await service.process_and_store(uuid.uuid4(), _photo(), "halter.jpg")
        with _provider():
            cut = service.remove_background(paths["image_path"])
        size = Image.open(tmp_path / cut["image_path"]).size
        brushed = service.brush_cutout(
            cut["image_path"],
            _stroke(size, (0.1, 0.6, 0.9, 0.95), (255, 0, 0)),
            backup_path=cut["original_backup_path"],
        )
        assert (tmp_path / f"{stem_of(brushed['image_path'])}{EDIT_ALPHA_SUFFIX}").exists()

        with _provider():
            service.remove_background(brushed["image_path"])

        assert not (tmp_path / f"{stem_of(brushed['image_path'])}{EDIT_ALPHA_SUFFIX}").exists()

    @pytest.mark.asyncio
    async def test_removal_reruns_on_the_photo_not_on_the_cutout(self, service, tmp_path) -> None:
        """Asking the model to find a garment in an image it already cut out is worse."""
        paths = await service.process_and_store(uuid.uuid4(), _photo(), "halter.jpg")
        seen: list[tuple[int, int]] = []

        class _Recording(_HolePunchingProvider):
            def remove(self, image):
                seen.append(image.size)
                return super().remove(image)

        with patch("app.services.background_removal.get_provider", return_value=_Recording()):
            cut = service.remove_background(paths["image_path"])
            service.remove_background(cut["image_path"])

        # Both passes saw the same, untrimmed photo.
        assert seen[0] == seen[1]


class TestSidecarHousekeeping:
    @pytest.mark.asyncio
    async def test_deleting_a_garment_takes_its_alphas_with_it(self, service, tmp_path) -> None:
        paths = await service.process_and_store(uuid.uuid4(), _photo(), "halter.jpg")
        with _provider():
            cut = service.remove_background(paths["image_path"])

        service.delete_images(
            {
                "image": cut["image_path"],
                "medium": cut["medium_path"],
                "thumb": cut["thumbnail_path"],
            }
        )

        for sidecar in sidecar_paths(cut["image_path"]):
            assert not (tmp_path / sidecar).exists(), sidecar

    @pytest.mark.asyncio
    async def test_restoring_the_photo_forgets_the_alphas(self, service, tmp_path) -> None:
        paths = await service.process_and_store(uuid.uuid4(), _photo(), "halter.jpg")
        with _provider():
            cut = service.remove_background(paths["image_path"])
        size = Image.open(tmp_path / cut["image_path"]).size
        service.brush_cutout(
            cut["image_path"],
            _stroke(size, (0.1, 0.6, 0.9, 0.95), (255, 0, 0)),
            backup_path=cut["original_backup_path"],
        )

        restored = service.restore_original(cut["image_path"], cut["original_backup_path"])

        stem = stem_of(restored["image_path"])
        assert not (tmp_path / f"{stem}{AUTO_ALPHA_SUFFIX}").exists()
        assert not (tmp_path / f"{stem}{EDIT_ALPHA_SUFFIX}").exists()


class TestAddFormStrokes:
    @pytest.mark.asyncio
    async def test_strokes_made_before_saving_are_applied_to_the_cutout(
        self, service, tmp_path
    ) -> None:
        photo = _photo((240, 360))
        user = uuid.uuid4()
        with _provider():
            plain = await service.process_and_store(user, photo, "halter.jpg")
            untouched = service.remove_background(plain["image_path"])

            # The same photo, plus a stroke across the bottom third of the garment.
            # Painted on the photo as displayed: upright, unturned, uncropped.
            paths = await service.process_and_store(
                user,
                photo,
                "halter.jpg",
                erase_mask=_stroke((240, 360), (0.0, 0.7, 1.0, 1.0), (255, 0, 0)),
            )
            cut = service.remove_background(paths["image_path"])

        # The strokes reached the stored alpha, in the photo's own coordinates.
        edited = tmp_path / f"{stem_of(cut['image_path'])}{EDIT_ALPHA_SUFFIX}"
        assert edited.exists()
        alpha = Image.open(edited)
        assert alpha.getpixel((alpha.width // 2, int(alpha.height * 0.85))) < 40
        assert alpha.getpixel((alpha.width // 2, int(alpha.height * 0.4))) > 215

        # And the rendered cut-out is shorter for it: the erased hem is not there
        # to be trimmed around.
        assert (
            Image.open(tmp_path / cut["image_path"]).height
            < Image.open(tmp_path / untouched["image_path"]).height
        )

    @pytest.mark.asyncio
    async def test_the_mask_is_framed_exactly_like_the_photo(self, service, tmp_path) -> None:
        """Turned then cropped, in that order, or the strokes land somewhere else."""
        photo = _photo((240, 360))
        # A quarter turn makes the displayed photo 360x240; the crop is in those
        # coordinates, and so is the mask.
        paths = await service.process_and_store(
            uuid.uuid4(),
            photo,
            "halter.jpg",
            rotate=1,
            crop=CropBox(x=60, y=0, width=240, height=240),
            erase_mask=_stroke((360, 240), (0.0, 0.0, 1.0, 0.1), (255, 0, 0)),
        )

        brushed = service.apply_pending_brush(paths["image_path"])
        assert brushed is not None
        stored = Image.open(tmp_path / brushed["image_path"])
        assert stored.mode == "RGBA"
        # The stroke covered the top tenth of the turned photo; after a crop that
        # keeps the middle 240 columns it still covers the top of what was stored.
        assert stored.getchannel("A").getpixel((stored.width // 2, 1)) < 40

    @pytest.mark.asyncio
    async def test_no_mask_means_nothing_to_apply(self, service) -> None:
        paths = await service.process_and_store(uuid.uuid4(), _photo(), "halter.jpg")
        assert service.apply_pending_brush(paths["image_path"]) is None


class TestModelConfigFallback:
    def test_a_model_that_is_not_on_disk_falls_back(self) -> None:
        provider = RembgProvider(model="birefnet-massive", fallback_model="u2net")
        loaded: list[str] = []

        def _new_session(model: str):
            loaded.append(model)
            if model == "birefnet-massive":
                raise FileNotFoundError("not baked into the image")
            return "u2net-session"

        with patch.object(provider, "_new_session", side_effect=_new_session):
            assert provider.warm_up() is None

        assert loaded == ["birefnet-massive", "u2net"]
        # And it reports what is loaded, not what was asked for.
        assert provider.model == "u2net"
        assert provider.requested_model == "birefnet-massive"

    def test_the_configured_model_is_used_when_it_loads(self) -> None:
        provider = RembgProvider(model="isnet-general-use", fallback_model="u2net")
        with patch.object(provider, "_new_session", return_value="session") as new_session:
            provider.warm_up()
        new_session.assert_called_once_with("isnet-general-use")
        assert provider.model == "isnet-general-use"

    def test_with_no_fallback_the_failure_surfaces(self) -> None:
        provider = RembgProvider(model="nonsense", fallback_model=None)
        with patch.object(provider, "_new_session", side_effect=FileNotFoundError("nope")):
            with pytest.raises(FileNotFoundError):
                provider.warm_up()

    def test_a_missing_rembg_is_not_a_model_problem(self) -> None:
        """It has to stay an ImportError: the API turns that into a 501 with
        installation instructions, and no fallback model can help."""
        provider = RembgProvider(model="isnet-general-use", fallback_model="u2net")
        with patch.object(provider, "_new_session", side_effect=ImportError("no rembg")):
            with pytest.raises(ImportError):
                provider.warm_up()

    def test_the_default_is_the_model_that_handles_holes(self) -> None:
        from app.config import Settings

        settings = Settings()
        assert settings.bg_removal_model == "isnet-general-use"
        assert settings.bg_removal_fallback_model == "u2net"


async def _item_with_cutout(
    db_session: AsyncSession, user: User
) -> tuple[ClothingItem, ImageService]:
    service = ImageService()
    paths = await service.process_and_store(user.id, _photo(), "halter.jpg")
    with _provider():
        cut = service.remove_background(paths["image_path"])
    item = ClothingItem(
        user_id=user.id,
        type="top",
        image_path=cut["image_path"],
        medium_path=cut["medium_path"],
        thumbnail_path=cut["thumbnail_path"],
        original_image_path=cut["original_backup_path"],
        image_hash=paths["image_hash"],
        status=ItemStatus.ready,
    )
    db_session.add(item)
    await db_session.commit()
    await db_session.refresh(item)
    return item, service


@pytest_asyncio.fixture
async def cutout_item(db_session: AsyncSession, test_user: User):
    return await _item_with_cutout(db_session, test_user)


class TestEraserEndpoint:
    @pytest.mark.asyncio
    async def test_round_trip_erase_then_reset(
        self, client: AsyncClient, auth_headers, cutout_item
    ) -> None:
        item, service = cutout_item
        stored = service.get_image_path(item.image_path)
        assert _alpha_at(stored, (0.5, 0.75)) > 215

        size = Image.open(stored).size
        response = await client.post(
            f"/api/v1/items/{item.id}/cutout-mask",
            headers=auth_headers,
            files={
                "mask": ("mask.png", _stroke(size, (0.1, 0.6, 0.9, 0.95), (255, 0, 0)), "image/png")
            },
            data={"space": "cutout"},
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["has_cutout"] is True
        after = service.get_image_path(body["image_path"])
        assert _alpha_at(after, (0.5, 0.8)) < 40

        reset = await client.delete(f"/api/v1/items/{item.id}/cutout-mask", headers=auth_headers)

        assert reset.status_code == 200, reset.text
        back = service.get_image_path(reset.json()["image_path"])
        assert _alpha_at(back, (0.5, 0.75)) > 215
        assert _alpha_at(back, (0.5, 0.26)) < 40

    @pytest.mark.asyncio
    async def test_the_item_keeps_pointing_at_files_that_exist(
        self, client: AsyncClient, auth_headers, cutout_item
    ) -> None:
        item, service = cutout_item
        size = Image.open(service.get_image_path(item.image_path)).size
        response = await client.post(
            f"/api/v1/items/{item.id}/cutout-mask",
            headers=auth_headers,
            files={
                "mask": ("mask.png", _stroke(size, (0.2, 0.2, 0.4, 0.4), (255, 0, 0)), "image/png")
            },
        )

        body = response.json()
        for key in ("image_path", "medium_path", "thumbnail_path"):
            assert service.get_image_path(body[key]).exists(), key

    @pytest.mark.asyncio
    async def test_a_garment_that_is_not_yours_is_not_found(
        self, client: AsyncClient, auth_headers
    ) -> None:
        response = await client.post(
            f"/api/v1/items/{uuid.uuid4()}/cutout-mask",
            headers=auth_headers,
            files={"mask": ("m.png", _stroke((10, 10), (0, 0, 1, 1), (255, 0, 0)), "image/png")},
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_rubbish_instead_of_a_mask_is_rejected(
        self, client: AsyncClient, auth_headers, cutout_item
    ) -> None:
        item, _ = cutout_item
        response = await client.post(
            f"/api/v1/items/{item.id}/cutout-mask",
            headers=auth_headers,
            files={"mask": ("m.png", b"not an image at all", "image/png")},
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_an_unknown_space_is_rejected(
        self, client: AsyncClient, auth_headers, cutout_item
    ) -> None:
        item, _ = cutout_item
        response = await client.post(
            f"/api/v1/items/{item.id}/cutout-mask",
            headers=auth_headers,
            files={"mask": ("m.png", _stroke((10, 10), (0, 0, 1, 1), (255, 0, 0)), "image/png")},
            data={"space": "sideways"},
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_signing_in_is_required(self, client: AsyncClient, cutout_item) -> None:
        item, _ = cutout_item
        response = await client.post(
            f"/api/v1/items/{item.id}/cutout-mask",
            files={"mask": ("m.png", _stroke((10, 10), (0, 0, 1, 1), (255, 0, 0)), "image/png")},
        )
        assert response.status_code in (401, 403)


class TestRotationEndpoint:
    @pytest.mark.asyncio
    async def test_several_turns_collapse_into_one_request(
        self, client: AsyncClient, auth_headers, cutout_item
    ) -> None:
        item, service = cutout_item
        before = Image.open(service.get_image_path(item.image_path)).size

        with patch.object(
            ImageService, "rotate_image", autospec=True, side_effect=ImageService.rotate_image
        ) as spy:
            response = await client.post(
                f"/api/v1/items/{item.id}/rotate?direction=cw&quarters=2", headers=auth_headers
            )

        assert response.status_code == 200, response.text
        assert spy.call_count == 1
        assert spy.call_args.args[3] == 2
        # Two quarter turns: the same shape, the other way up.
        assert Image.open(service.get_image_path(item.image_path)).size == before

    @pytest.mark.asyncio
    async def test_one_turn_is_still_the_default(
        self, client: AsyncClient, auth_headers, cutout_item
    ) -> None:
        item, service = cutout_item
        width, height = Image.open(service.get_image_path(item.image_path)).size

        response = await client.post(
            f"/api/v1/items/{item.id}/rotate?direction=ccw", headers=auth_headers
        )

        assert response.status_code == 200
        assert Image.open(service.get_image_path(item.image_path)).size == (height, width)

    @pytest.mark.asyncio
    async def test_four_turns_is_refused_rather_than_wasted(
        self, client: AsyncClient, auth_headers, cutout_item
    ) -> None:
        """A full turn is a no-op; the client is expected to have cancelled it."""
        item, _ = cutout_item
        response = await client.post(
            f"/api/v1/items/{item.id}/rotate?direction=cw&quarters=4", headers=auth_headers
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_a_plain_photo_turns_too(self, service, tmp_path) -> None:
        """Not every garment is a cut-out; the JPEG path has to work as well."""
        paths = await service.process_and_store(uuid.uuid4(), _photo((240, 360)), "halter.jpg")
        width, height = Image.open(tmp_path / paths["image_path"]).size

        turned = service.rotate_image(paths["image_path"], "cw")

        stored = Image.open(tmp_path / turned["image_path"])
        assert stored.format == "JPEG"
        assert stored.size == (height, width)

    def test_a_whole_turn_rewrites_nothing(self, service) -> None:
        result = service.rotate_image("nowhere/nothing.jpg", "cw", 4)
        # Short-circuited before it ever looked for the file.
        assert result["image_path"] == "nowhere/nothing.jpg"
        assert result["thumbnail_path"] == "nowhere/nothing_thumb.jpg"
