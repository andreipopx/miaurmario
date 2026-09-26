"""Delante y detrás: every photo of a garment carries the side it shows.

What these pin down:

* the primary photo is a front photo, and the *second* photo of a garment is its
  back — because that is what a second photo is nearly always for;
* a photo with nothing recorded (every photo from before this existed) reads as a
  front photo rather than blowing up or reading as "unknown";
* whether a photo is a cut-out is a fact about *that photo*, so a cut-out back and
  a white-backed front are a state the renderers can see;
* the vision model never sees anything but the primary photo — adding a back shot
  costs no tagging call and cannot overwrite the tags the front photo earned;
* "esta es la espalda de aquella" in the bulk pass moves a photo across and takes
  the now-empty garment away, without binning the file it just moved.
"""

import uuid
from io import BytesIO
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.items import _default_extra_view
from app.models.item import ClothingItem, ImageView, ItemImage, ItemStatus
from app.schemas.item import ItemImageResponse, ItemResponse
from app.services.image_service import ImageService
from app.utils.image_views import back_photo_paths, normalize_image_view


def _photo_bytes() -> bytes:
    buf = BytesIO()
    Image.new("RGB", (60, 80), (120, 60, 40)).save(buf, format="JPEG")
    return buf.getvalue()


def _upload(name: str = "back.jpg") -> dict:
    return {"image": (name, _photo_bytes(), "image/jpeg")}


async def _make_item(db: AsyncSession, user, **over) -> ClothingItem:
    item = ClothingItem(
        user_id=user.id,
        type=over.pop("type", "sweater"),
        image_path=over.pop("image_path", f"test/{uuid.uuid4()}.jpg"),
        status=ItemStatus.ready,
        **over,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def _reload(db: AsyncSession, item_id) -> ClothingItem:
    result = await db.execute(
        select(ClothingItem)
        .where(ClothingItem.id == item_id)
        .options(selectinload(ClothingItem.additional_images))
    )
    return result.scalar_one()


class TestTheLabelItself:
    def test_nothing_recorded_reads_as_a_front_photo(self) -> None:
        """Nobody is going back to label years of photos; front is the honest guess."""
        assert normalize_image_view(None) == "front"
        assert normalize_image_view("") == "front"

    def test_a_label_we_never_write_reads_as_front_rather_than_raising(self) -> None:
        """One bad row must not take a wardrobe down."""
        assert normalize_image_view("sideways") == "front"
        assert normalize_image_view(7) == "front"

    def test_the_three_real_labels_survive_the_round_trip(self) -> None:
        for view in ("front", "back", "detail"):
            assert normalize_image_view(view) == view
        assert normalize_image_view(ImageView.back) == "back"

    def test_the_second_photo_of_a_garment_is_its_back(self) -> None:
        assert _default_extra_view(0, None) == "back"

    def test_and_everything_after_it_is_a_detail(self) -> None:
        assert _default_extra_view(1, None) == "detail"
        assert _default_extra_view(3, None) == "detail"

    def test_a_client_that_knows_better_is_believed(self) -> None:
        assert _default_extra_view(0, "detail") == "detail"
        assert _default_extra_view(2, "back") == "back"

    def test_but_not_when_it_sends_nonsense(self) -> None:
        assert _default_extra_view(0, "sideways") == "back"


class TestDefaultsOnUpload:
    @pytest.mark.asyncio
    async def test_a_new_garment_starts_as_a_front_photo(
        self, client: AsyncClient, auth_headers, platform_ai_user
    ) -> None:
        with patch("app.api.items.create_pool", new_callable=AsyncMock) as pool:
            pool.return_value = AsyncMock()
            response = await client.post(
                "/api/v1/items/bulk",
                files=[("images", ("front.jpg", _photo_bytes(), "image/jpeg"))],
                data={"skip_ai": "true", "remove_background": "false"},
                headers=auth_headers,
            )
        assert response.status_code == 201, response.text
        assert response.json()["results"][0]["item"]["image_view"] == "front"

    @pytest.mark.asyncio
    async def test_the_second_photo_becomes_the_back(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        item = await _make_item(db_session, test_user)

        response = await client.post(
            f"/api/v1/items/{item.id}/images",
            files=_upload(),
            data={"remove_background": "false"},
            headers=auth_headers,
        )

        assert response.status_code == 201, response.text
        assert response.json()["image_view"] == "back"

    @pytest.mark.asyncio
    async def test_the_third_photo_is_a_detail(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        item = await _make_item(db_session, test_user)

        for _ in range(2):
            response = await client.post(
                f"/api/v1/items/{item.id}/images",
                files=_upload(),
                data={"remove_background": "false"},
                headers=auth_headers,
            )
            assert response.status_code == 201, response.text

        assert response.json()["image_view"] == "detail"

    @pytest.mark.asyncio
    async def test_the_client_may_label_it_outright(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        item = await _make_item(db_session, test_user)

        response = await client.post(
            f"/api/v1/items/{item.id}/images",
            files=_upload(),
            data={"image_view": "detail", "remove_background": "false"},
            headers=auth_headers,
        )

        assert response.status_code == 201
        assert response.json()["image_view"] == "detail"


class TestRelabelling:
    @pytest.mark.asyncio
    async def test_the_owner_can_relabel_an_extra_photo(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        item = await _make_item(db_session, test_user)
        added = await client.post(
            f"/api/v1/items/{item.id}/images",
            files=_upload(),
            data={"remove_background": "false"},
            headers=auth_headers,
        )
        image_id = added.json()["id"]

        response = await client.patch(
            f"/api/v1/items/{item.id}/images/{image_id}/view",
            json={"image_view": "detail"},
            headers=auth_headers,
        )

        assert response.status_code == 200
        assert response.json()["image_view"] == "detail"

    @pytest.mark.asyncio
    async def test_a_relabel_refuses_a_label_that_is_not_a_view(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        item = await _make_item(db_session, test_user)
        added = await client.post(
            f"/api/v1/items/{item.id}/images",
            files=_upload(),
            data={"remove_background": "false"},
            headers=auth_headers,
        )

        response = await client.patch(
            f"/api/v1/items/{item.id}/images/{added.json()['id']}/view",
            json={"image_view": "sideways"},
            headers=auth_headers,
        )

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_the_owner_can_relabel_the_primary_photo(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        """A garment whose only photo is its back is a real thing to say."""
        item = await _make_item(db_session, test_user)

        response = await client.patch(
            f"/api/v1/items/{item.id}",
            json={"image_view": "back"},
            headers=auth_headers,
        )

        assert response.status_code == 200
        body = response.json()
        assert body["image_view"] == "back"
        # …and that garment now has a behind: its own photo.
        assert body["back_image"]["image_url"]

    @pytest.mark.asyncio
    async def test_promoting_the_back_photo_carries_its_label_with_it(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        """The label belongs to the photo, not to the slot it sits in."""
        item = await _make_item(db_session, test_user)
        added = await client.post(
            f"/api/v1/items/{item.id}/images",
            files=_upload(),
            data={"remove_background": "false"},
            headers=auth_headers,
        )
        image_id = added.json()["id"]

        response = await client.post(
            f"/api/v1/items/{item.id}/images/{image_id}/set-primary",
            headers=auth_headers,
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["image_view"] == "back"
        assert [img["image_view"] for img in body["additional_images"]] == ["front"]


class TestTheBackPhotoOfAGarment:
    @pytest.mark.asyncio
    async def test_a_garment_with_one_photo_has_no_behind(
        self, test_user, db_session: AsyncSession
    ) -> None:
        item = await _reload(db_session, (await _make_item(db_session, test_user)).id)
        assert back_photo_paths(item) is None
        assert ItemResponse.model_validate(item).back_image is None

    @pytest.mark.asyncio
    async def test_the_back_photo_is_found_among_the_extra_ones(
        self, test_user, db_session: AsyncSession
    ) -> None:
        item = await _make_item(db_session, test_user)
        db_session.add(
            ItemImage(
                item_id=item.id,
                image_path="test/back.webp",
                thumbnail_path="test/back_thumb.webp",
                position=0,
                image_view="back",
            )
        )
        await db_session.commit()

        fresh = await _reload(db_session, item.id)
        assert back_photo_paths(fresh) == ("test/back.webp", "test/back_thumb.webp")

        back = ItemResponse.model_validate(fresh).back_image
        assert back is not None
        assert back.has_cutout is True

    @pytest.mark.asyncio
    async def test_a_detail_shot_is_not_a_behind(self, test_user, db_session: AsyncSession) -> None:
        item = await _make_item(db_session, test_user)
        db_session.add(
            ItemImage(item_id=item.id, image_path="test/label.jpg", position=0, image_view="detail")
        )
        await db_session.commit()

        assert back_photo_paths(await _reload(db_session, item.id)) is None

    @pytest.mark.asyncio
    async def test_an_unlabelled_extra_photo_is_not_guessed_to_be_a_behind(
        self, test_user, db_session: AsyncSession
    ) -> None:
        """Old photos have no label, and inventing one puts words in the user's mouth."""
        item = await _make_item(db_session, test_user)
        db_session.add(ItemImage(item_id=item.id, image_path="test/old.jpg", position=0))
        await db_session.commit()

        fresh = await _reload(db_session, item.id)
        assert back_photo_paths(fresh) is None
        assert [i.image_view for i in ItemResponse.model_validate(fresh).additional_images] == [
            "front"
        ]

    def test_an_unloaded_gallery_answers_no_rather_than_lazy_loading(self) -> None:
        """A lazy load here would be a MissingGreenlet in an async request."""
        item = ClothingItem(user_id=uuid.uuid4(), type="shirt", image_path="a.jpg")
        # A brand-new instance has never loaded the relationship from the database.
        assert back_photo_paths(item) is None


class TestTheCutOutFlagIsPerPhoto:
    @pytest.mark.asyncio
    async def test_a_white_backed_front_and_a_cut_out_back_are_both_visible(
        self, test_user, db_session: AsyncSession
    ) -> None:
        """The state that makes a per-item flag wrong: one garment, two answers."""
        item = await _make_item(db_session, test_user, image_path="test/front.jpg")
        db_session.add(
            ItemImage(item_id=item.id, image_path="test/back.webp", position=0, image_view="back")
        )
        await db_session.commit()

        body = ItemResponse.model_validate(await _reload(db_session, item.id))
        assert body.has_cutout is False
        assert body.additional_images[0].has_cutout is True
        assert body.back_image is not None and body.back_image.has_cutout is True

    def test_an_extra_photo_answers_for_itself(self) -> None:
        cut_out = ItemImageResponse.model_validate(
            {
                "id": uuid.uuid4(),
                "item_id": uuid.uuid4(),
                "image_path": "u/back.webp",
                "thumbnail_path": "u/back_thumb.webp",
                "position": 0,
                "image_view": "back",
                "created_at": "2026-09-26T10:00:00Z",
            }
        )
        flat = ItemImageResponse.model_validate(
            {
                "id": uuid.uuid4(),
                "item_id": uuid.uuid4(),
                "image_path": "u/back.jpg",
                "position": 1,
                "image_view": "detail",
                "created_at": "2026-09-26T10:00:00Z",
            }
        )
        assert cut_out.has_cutout is True
        assert flat.has_cutout is False

    @pytest.mark.asyncio
    async def test_an_extra_photo_gets_its_background_removed_like_the_rest(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        item = await _make_item(db_session, test_user)

        class _Provider:
            def remove(self, image: Image.Image) -> Image.Image:
                out = image.convert("RGBA")
                out.putalpha(200)
                return out

        with patch("app.services.background_removal.get_provider", return_value=_Provider()):
            response = await client.post(
                f"/api/v1/items/{item.id}/images",
                files=_upload(),
                headers=auth_headers,
            )

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["image_path"].endswith(".webp")
        assert body["has_cutout"] is True
        assert body["image_view"] == "back"

    @pytest.mark.asyncio
    async def test_a_photo_survives_a_background_removal_that_cannot_run(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        """No rembg on this box is not a reason to lose the user's photo."""
        with patch(
            "app.services.background_removal.get_provider", side_effect=ImportError("no rembg")
        ):
            item = await _make_item(db_session, test_user)
            response = await client.post(
                f"/api/v1/items/{item.id}/images",
                files=_upload(),
                headers=auth_headers,
            )

        assert response.status_code == 201, response.text
        assert response.json()["has_cutout"] is False


class TestTheVisionModelNeverSeesTheExtraPhotos:
    @pytest.mark.asyncio
    async def test_adding_a_back_photo_queues_no_tagging_job(
        self, client: AsyncClient, auth_headers, platform_ai_user, db_session: AsyncSession
    ) -> None:
        """Tagging is the front photo's business, and only the front photo's."""
        item = await _make_item(db_session, platform_ai_user)

        with (
            patch("app.api.items.create_pool", new_callable=AsyncMock) as pool,
            patch("app.services.ai_service.AIService.analyze_image", new_callable=AsyncMock) as ai,
        ):
            redis = AsyncMock()
            pool.return_value = redis
            response = await client.post(
                f"/api/v1/items/{item.id}/images",
                files=_upload(),
                data={"remove_background": "false"},
                headers=auth_headers,
            )

        assert response.status_code == 201, response.text
        ai.assert_not_called()
        redis.enqueue_job.assert_not_called()

    @pytest.mark.asyncio
    async def test_relabelling_a_photo_queues_no_tagging_job_either(
        self, client: AsyncClient, auth_headers, platform_ai_user, db_session: AsyncSession
    ) -> None:
        item = await _make_item(db_session, platform_ai_user)
        added = await client.post(
            f"/api/v1/items/{item.id}/images",
            files=_upload(),
            data={"remove_background": "false"},
            headers=auth_headers,
        )

        with (
            patch("app.api.items.create_pool", new_callable=AsyncMock) as pool,
            patch("app.services.ai_service.AIService.analyze_image", new_callable=AsyncMock) as ai,
        ):
            redis = AsyncMock()
            pool.return_value = redis
            response = await client.patch(
                f"/api/v1/items/{item.id}/images/{added.json()['id']}/view",
                json={"image_view": "detail"},
                headers=auth_headers,
            )

        assert response.status_code == 200
        ai.assert_not_called()
        redis.enqueue_job.assert_not_called()

    def test_the_tagging_worker_only_ever_reads_the_primary_photo(self) -> None:
        """A grep-level guard: nothing in the worker knows about extra photos.

        If a future change wants to send more than the primary photo to the model,
        it has to delete this test on purpose rather than by accident.
        """
        source = Path(__file__).resolve().parents[1] / "app" / "workers" / "tagging.py"
        text = source.read_text()
        assert "additional_images" not in text
        assert "ItemImage" not in text


class TestEsLaEspaldaDeAquella:
    """Folding one garment's photos into another. The user's call, never a guess.

    Two screens ask for it — the quick pass after a batch, and any garment already in
    the wardrobe, uploaded long before views existed — and both go through the one
    endpoint.

    The shape of the promise, which every test here is a corner of: the garment we
    keep keeps *everything* of its own, only the photos move, and a garment with a
    past is refused rather than being either lost or written onto the keeper.
    """

    @pytest.mark.asyncio
    async def test_the_photo_moves_across_and_the_empty_garment_goes_away(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        front = await _make_item(db_session, test_user, image_path="test/front.jpg")
        back = await _make_item(db_session, test_user, image_path="test/loose-back.jpg")

        response = await client.post(
            f"/api/v1/items/{front.id}/merge-from",
            json={"item_id": str(back.id)},
            headers=auth_headers,
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["merged"] is True
        assert body["moved_images"] == 1
        assert [img["image_view"] for img in body["item"]["additional_images"]] == ["back"]
        assert body["item"]["back_image"]["image_url"]
        # The garment that was only ever a stray photo is gone.
        gone = await client.get(f"/api/v1/items/{back.id}", headers=auth_headers)
        assert gone.status_code == 404

    @pytest.mark.asyncio
    async def test_the_garment_we_keep_keeps_every_bit_of_its_own_data(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        """Not a two-way merge of two records: one garment gaining a photo.

        The folded-in garment's tags describe a photo the user has just told us is the
        *back* of something already tagged, so they are discarded, not merged. Nothing
        from it may reach the keeper — not the name, not the type, not the colour, not
        a single counter.
        """
        from decimal import Decimal

        keeper = await _make_item(
            db_session,
            test_user,
            type="sweater",
            subtype="cardigan",
            name="La de rayas",
            brand="Mine",
            primary_color="navy",
            primary_color_hex="#1b2a4a",
            formality="casual",
            style=["classic"],
            season=["winter"],
            usage_preference="more",
            purchase_price=Decimal("40.00"),
            wear_count=4,
            suggestion_count=7,
        )
        source = await _make_item(
            db_session,
            test_user,
            type="jeans",
            subtype="bootcut",
            name="Otra cosa",
            brand="Theirs",
            primary_color="red",
            primary_color_hex="#aa0000",
            formality="formal",
            style=["sporty"],
            season=["summer"],
            usage_preference="rest",
            purchase_price=Decimal("5.00"),
        )

        response = await client.post(
            f"/api/v1/items/{keeper.id}/merge-from",
            json={"item_id": str(source.id)},
            headers=auth_headers,
        )

        assert response.status_code == 200, response.text
        kept = response.json()["item"]
        assert kept["type"] == "sweater"
        assert kept["subtype"] == "cardigan"
        assert kept["name"] == "La de rayas"
        assert kept["brand"] == "Mine"
        assert kept["primary_color"] == "navy"
        assert kept["primary_color_hex"] == "#1b2a4a"
        assert kept["formality"] == "casual"
        assert kept["style"] == ["classic"]
        assert kept["season"] == ["winter"]
        assert kept["usage_preference"] == "more"
        assert kept["purchase_price"] == "40.00"
        # The counters are the keeper's own, not a sum: its history did not change.
        assert kept["wear_count"] == 4
        assert kept["suggestion_count"] == 7

    @pytest.mark.asyncio
    async def test_the_user_may_call_it_a_detail_instead(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        keeper = await _make_item(db_session, test_user)
        other = await _make_item(db_session, test_user)

        response = await client.post(
            f"/api/v1/items/{keeper.id}/merge-from",
            json={"item_id": str(other.id), "image_view": "detail"},
            headers=auth_headers,
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert [img["image_view"] for img in body["item"]["additional_images"]] == ["detail"]
        # …and a detail is not a behind.
        assert body["item"]["back_image"] is None

    @pytest.mark.asyncio
    async def test_every_photo_comes_across_keeping_the_label_it_had(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        """The labels on the other one's own extras are the owner's words, not ours."""
        keeper = await _make_item(db_session, test_user)
        source = await _make_item(db_session, test_user, image_path="test/source-main.jpg")
        db_session.add_all(
            [
                ItemImage(
                    item_id=source.id,
                    image_path="test/source-detail.jpg",
                    position=0,
                    image_view="detail",
                ),
                ItemImage(
                    item_id=source.id,
                    image_path="test/source-unlabelled.jpg",
                    position=1,
                ),
            ]
        )
        await db_session.commit()

        response = await client.post(
            f"/api/v1/items/{keeper.id}/merge-from",
            json={"item_id": str(source.id)},
            headers=auth_headers,
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["moved_images"] == 3
        views = [img["image_view"] for img in body["item"]["additional_images"]]
        # The main photo took the label the user chose; its own extras kept theirs, and
        # the one with nothing recorded still reads as a front.
        assert views == ["back", "detail", "front"]

    @pytest.mark.asyncio
    async def test_a_photos_own_cut_out_state_travels_with_it(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        """A bad cut-out on the back is the back's problem, and stays that way."""
        keeper = await _make_item(db_session, test_user, image_path="test/front.jpg")
        source = await _make_item(
            db_session,
            test_user,
            image_path="test/back.webp",
            original_image_path="test/back_orig.jpg",
        )

        response = await client.post(
            f"/api/v1/items/{keeper.id}/merge-from",
            json={"item_id": str(source.id)},
            headers=auth_headers,
        )

        assert response.status_code == 200, response.text
        kept = response.json()["item"]
        moved = kept["additional_images"][0]
        assert moved["has_cutout"] is True
        # Its own untouched original came along, so undoing the eraser on this photo
        # undoes this photo.
        assert moved["can_restore_original"] is True
        # And the keeper's own photo is untouched by any of it.
        assert kept["has_cutout"] is False
        assert kept["original_image_path"] is None

    @pytest.mark.asyncio
    async def test_it_refuses_rather_than_dropping_photos_that_will_not_fit(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        keeper = await _make_item(db_session, test_user)
        db_session.add_all(
            [
                ItemImage(item_id=keeper.id, image_path=f"test/k{i}.jpg", position=i)
                for i in range(4)
            ]
        )
        source = await _make_item(db_session, test_user)
        await db_session.commit()

        response = await client.post(
            f"/api/v1/items/{keeper.id}/merge-from",
            json={"item_id": str(source.id)},
            headers=auth_headers,
        )

        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "too_many_images"
        # Nothing half-done: the garment we tried to fold in is still there.
        still = await client.get(f"/api/v1/items/{source.id}", headers=auth_headers)
        assert still.status_code == 200

    @pytest.mark.asyncio
    async def test_the_files_it_moved_are_not_deleted_with_the_garment(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        storage = Path("/tmp/wardrobe_test")
        storage.mkdir(parents=True, exist_ok=True)
        photo = storage / f"merge-{uuid.uuid4()}.jpg"
        photo.write_bytes(_photo_bytes())

        keeper = await _make_item(db_session, test_user, image_path="test/front.jpg")
        source = await _make_item(db_session, test_user, image_path=photo.name)

        response = await client.post(
            f"/api/v1/items/{keeper.id}/merge-from",
            json={"item_id": str(source.id)},
            headers=auth_headers,
        )

        assert response.status_code == 200, response.text
        assert photo.exists(), "the photo now belongs to the other garment"
        photo.unlink()

    @pytest.mark.asyncio
    async def test_a_garment_with_a_wear_history_is_refused_not_thrown_away(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        """Refusing keeps both promises: the keeper untouched, the past not binned."""
        from datetime import date

        from app.models.item import ItemHistory

        keeper = await _make_item(db_session, test_user)
        source = await _make_item(db_session, test_user)
        db_session.add(ItemHistory(item_id=source.id, worn_at=date(2026, 9, 18)))
        await db_session.commit()

        response = await client.post(
            f"/api/v1/items/{keeper.id}/merge-from",
            json={"item_id": str(source.id)},
            headers=auth_headers,
        )

        assert response.status_code == 400
        detail = response.json()["detail"]
        assert detail["code"] == "source_in_use"
        assert "wear_history" in detail["blockers"]
        # Neither garment moved.
        assert (await _reload(db_session, source.id)) is not None
        assert (await _reload(db_session, keeper.id)).additional_images == []

    @pytest.mark.asyncio
    async def test_a_worn_garment_is_refused_even_with_no_history_rows(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        keeper = await _make_item(db_session, test_user)
        source = await _make_item(db_session, test_user, wear_count=2)

        response = await client.post(
            f"/api/v1/items/{keeper.id}/merge-from",
            json={"item_id": str(source.id)},
            headers=auth_headers,
        )

        assert response.status_code == 400
        assert "wear_history" in response.json()["detail"]["blockers"]

    @pytest.mark.asyncio
    async def test_a_garment_with_a_wash_history_is_refused(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        from datetime import date

        from app.models.item import WashHistory

        keeper = await _make_item(db_session, test_user)
        source = await _make_item(db_session, test_user)
        db_session.add(WashHistory(item_id=source.id, washed_at=date(2026, 9, 10)))
        await db_session.commit()

        response = await client.post(
            f"/api/v1/items/{keeper.id}/merge-from",
            json={"item_id": str(source.id)},
            headers=auth_headers,
        )

        assert response.status_code == 400
        assert "wash_history" in response.json()["detail"]["blockers"]

    @pytest.mark.asyncio
    async def test_a_garment_a_look_is_built_on_is_refused(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        from app.models.outfit import Outfit, OutfitItem

        keeper = await _make_item(db_session, test_user, type="sweater")
        source = await _make_item(db_session, test_user, type="sweater")
        outfit = Outfit(user_id=test_user.id, name="look", occasion="casual")
        db_session.add(outfit)
        await db_session.flush()
        db_session.add(OutfitItem(outfit_id=outfit.id, item_id=source.id, position=0))
        await db_session.commit()

        response = await client.post(
            f"/api/v1/items/{keeper.id}/merge-from",
            json={"item_id": str(source.id)},
            headers=auth_headers,
        )

        assert response.status_code == 400
        assert "outfits" in response.json()["detail"]["blockers"]
        # The look still has the garment it was built on.
        look = await client.get(f"/api/v1/outfits/{outfit.id}", headers=auth_headers)
        assert [i["id"] for i in look.json()["items"]] == [str(source.id)]

    @pytest.mark.asyncio
    async def test_a_garment_a_pairing_was_built_from_is_refused(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        from app.models.outfit import Outfit

        keeper = await _make_item(db_session, test_user)
        source = await _make_item(db_session, test_user)
        db_session.add(
            Outfit(
                user_id=test_user.id,
                name="pairing",
                occasion="casual",
                source_item_id=source.id,
            )
        )
        await db_session.commit()

        response = await client.post(
            f"/api/v1/items/{keeper.id}/merge-from",
            json={"item_id": str(source.id)},
            headers=auth_headers,
        )

        assert response.status_code == 400
        assert "pairings" in response.json()["detail"]["blockers"]

    @pytest.mark.asyncio
    async def test_a_retry_is_a_success_and_changes_nothing_further(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        """A lost response must not turn into an error the user has to think about."""
        keeper = await _make_item(db_session, test_user)
        source = await _make_item(db_session, test_user)

        first = await client.post(
            f"/api/v1/items/{keeper.id}/merge-from",
            json={"item_id": str(source.id)},
            headers=auth_headers,
        )
        again = await client.post(
            f"/api/v1/items/{keeper.id}/merge-from",
            json={"item_id": str(source.id)},
            headers=auth_headers,
        )

        assert first.status_code == 200, first.text
        assert first.json()["merged"] is True
        assert again.status_code == 200, again.text
        assert again.json()["merged"] is False
        # Still one extra photo, not two.
        assert len(again.json()["item"]["additional_images"]) == 1

    @pytest.mark.asyncio
    async def test_a_garment_cannot_be_its_own_back(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        item = await _make_item(db_session, test_user)

        response = await client.post(
            f"/api/v1/items/{item.id}/merge-from",
            json={"item_id": str(item.id)},
            headers=auth_headers,
        )

        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "same_item"

    @pytest.mark.asyncio
    async def test_someone_elses_garment_is_left_entirely_alone(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        """Answered like a retry, so the reply says nothing about whose it was."""
        from app.models.user import User

        other = uuid.uuid4()
        stranger = User(
            id=other,
            external_id=f"stranger-{other}",
            email=f"stranger-{other}@example.com",
            display_name="Someone Else",
        )
        db_session.add(stranger)
        await db_session.commit()
        mine = await _make_item(db_session, test_user)
        theirs = await _make_item(db_session, stranger)

        response = await client.post(
            f"/api/v1/items/{mine.id}/merge-from",
            json={"item_id": str(theirs.id)},
            headers=auth_headers,
        )

        assert response.status_code == 200, response.text
        assert response.json()["merged"] is False
        assert response.json()["item"]["additional_images"] == []
        # And their garment is untouched.
        assert await _reload(db_session, theirs.id) is not None

    @pytest.mark.asyncio
    async def test_no_ai_is_called_to_decide_it_and_none_to_re_tag_after(
        self, client: AsyncClient, auth_headers, platform_ai_user, db_session: AsyncSession
    ) -> None:
        keeper = await _make_item(db_session, platform_ai_user)
        source = await _make_item(db_session, platform_ai_user)

        with (
            patch("app.api.items.create_pool", new_callable=AsyncMock) as pool,
            patch("app.services.ai_service.AIService.analyze_image", new_callable=AsyncMock) as ai,
        ):
            redis = AsyncMock()
            pool.return_value = redis
            response = await client.post(
                f"/api/v1/items/{keeper.id}/merge-from",
                json={"item_id": str(source.id)},
                headers=auth_headers,
            )

        assert response.status_code == 200, response.text
        ai.assert_not_called()
        redis.enqueue_job.assert_not_called()


class TestFixingOnePhotoTouchesOnlyThatPhoto:
    @pytest.mark.asyncio
    async def test_the_eraser_on_an_extra_photo_leaves_the_garment_alone(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        service = ImageService()
        stored = await service.process_and_store(test_user.id, _photo_bytes(), "back.jpg")
        item = await _make_item(db_session, test_user, image_path="test/front.jpg")
        image = ItemImage(
            item_id=item.id,
            image_path=stored["image_path"],
            thumbnail_path=stored.get("thumbnail_path"),
            medium_path=stored.get("medium_path"),
            position=0,
            image_view="back",
        )
        db_session.add(image)
        await db_session.commit()
        await db_session.refresh(image)

        class _Provider:
            def remove(self, img: Image.Image) -> Image.Image:
                out = img.convert("RGBA")
                out.putalpha(180)
                return out

        with patch("app.services.background_removal.get_provider", return_value=_Provider()):
            response = await client.post(
                f"/api/v1/items/{item.id}/images/{image.id}/remove-background",
                headers=auth_headers,
            )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["has_cutout"] is True
        assert body["can_restore_original"] is True
        # The garment's own photo, and the garment, are exactly as they were.
        kept = await client.get(f"/api/v1/items/{item.id}", headers=auth_headers)
        assert kept.json()["image_path"] == "test/front.jpg"
        assert kept.json()["has_cutout"] is False

    @pytest.mark.asyncio
    async def test_and_undoing_it_puts_that_one_photo_back(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        service = ImageService()
        stored = await service.process_and_store(test_user.id, _photo_bytes(), "back.jpg")
        item = await _make_item(db_session, test_user, image_path="test/front.jpg")
        image = ItemImage(
            item_id=item.id,
            image_path=stored["image_path"],
            thumbnail_path=stored.get("thumbnail_path"),
            medium_path=stored.get("medium_path"),
            position=0,
            image_view="back",
        )
        db_session.add(image)
        await db_session.commit()
        await db_session.refresh(image)

        class _Provider:
            def remove(self, img: Image.Image) -> Image.Image:
                out = img.convert("RGBA")
                out.putalpha(180)
                return out

        with patch("app.services.background_removal.get_provider", return_value=_Provider()):
            await client.post(
                f"/api/v1/items/{item.id}/images/{image.id}/remove-background",
                headers=auth_headers,
            )

        response = await client.post(
            f"/api/v1/items/{item.id}/images/{image.id}/restore-original",
            headers=auth_headers,
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["has_cutout"] is False
        assert body["can_restore_original"] is False
        # Still labelled the back: undoing a cut-out is not undoing a label.
        assert body["image_view"] == "back"

    @pytest.mark.asyncio
    async def test_there_is_nothing_to_undo_when_nothing_was_erased(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        item = await _make_item(db_session, test_user)
        image = ItemImage(item_id=item.id, image_path="test/x.jpg", position=0, image_view="back")
        db_session.add(image)
        await db_session.commit()
        await db_session.refresh(image)

        response = await client.post(
            f"/api/v1/items/{item.id}/images/{image.id}/restore-original",
            headers=auth_headers,
        )

        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "no_original"


class TestTheMigrationGoesBothWays:
    """Up and back down again on a database of its own, not the shared test one."""

    @pytest.mark.asyncio
    async def test_upgrade_then_downgrade_then_upgrade(self) -> None:
        import os
        import subprocess

        import asyncpg

        backend_dir = Path(__file__).resolve().parents[1]
        name = f"wardrobe_imgview_{uuid.uuid4().hex[:10]}"
        test_url = os.environ["TEST_DATABASE_URL"]
        admin_dsn = test_url.replace("+asyncpg", "").rsplit("/", 1)[0] + "/postgres"
        scratch_url = test_url.rsplit("/", 1)[0] + "/" + name

        conn = await asyncpg.connect(admin_dsn)
        try:
            await conn.execute(f'CREATE DATABASE "{name}"')
        finally:
            await conn.close()

        def alembic(*args: str) -> None:
            subprocess.run(
                ["python", "-m", "alembic", *args],
                cwd=backend_dir,
                env={**os.environ, "DATABASE_URL": scratch_url},
                check=True,
                capture_output=True,
            )

        async def columns() -> set[tuple[str, str]]:
            db = await asyncpg.connect(scratch_url.replace("+asyncpg", ""))
            try:
                rows = await db.fetch(
                    "SELECT table_name, column_name FROM information_schema.columns "
                    "WHERE column_name = 'image_view'"
                )
            finally:
                await db.close()
            return {(r["table_name"], r["column_name"]) for r in rows}

        try:
            alembic("upgrade", "head")
            assert await columns() == {
                ("clothing_items", "image_view"),
                ("item_images", "image_view"),
            }

            alembic("downgrade", "-1")
            assert await columns() == set()

            # And straight back up, because that is what a redeploy does.
            alembic("upgrade", "head")
            assert await columns() == {
                ("clothing_items", "image_view"),
                ("item_images", "image_view"),
            }
        finally:
            conn = await asyncpg.connect(admin_dsn)
            try:
                await conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
            finally:
                await conn.close()


class TestTheLookSeenFromBehind:
    @pytest.mark.asyncio
    async def test_an_outfit_item_carries_the_garments_back_photo(
        self, client: AsyncClient, auth_headers, test_user, db_session: AsyncSession
    ) -> None:
        from app.models.outfit import Outfit, OutfitItem

        with_back = await _make_item(db_session, test_user, type="sweater")
        without = await _make_item(db_session, test_user, type="jeans")
        db_session.add(
            ItemImage(
                item_id=with_back.id,
                image_path="test/sweater-back.webp",
                position=0,
                image_view="back",
            )
        )
        outfit = Outfit(user_id=test_user.id, name="look", occasion="casual")
        db_session.add(outfit)
        await db_session.flush()
        db_session.add_all(
            [
                OutfitItem(outfit_id=outfit.id, item_id=with_back.id, position=0),
                OutfitItem(outfit_id=outfit.id, item_id=without.id, position=1),
            ]
        )
        await db_session.commit()

        response = await client.get(f"/api/v1/outfits/{outfit.id}", headers=auth_headers)

        assert response.status_code == 200, response.text
        by_type = {i["type"]: i for i in response.json()["items"]}
        assert by_type["sweater"]["back_image"]["image_url"]
        assert by_type["sweater"]["back_image"]["has_cutout"] is True
        assert by_type["sweater"]["image_view"] == "front"
        # The trousers have no behind, and say so rather than guessing.
        assert by_type["jeans"]["back_image"] is None
