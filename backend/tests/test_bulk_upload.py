"""Bulk intake: POST /items/bulk, plus the manual "tipo + color" pass.

The point of these is the batch's failure modes, because an empty wardrobe is
filled in one sitting or not at all: a photo without AI must still land, a dead
background remover must not cost the garment, a duplicate must not read as an
error, and the per-photo limits must let a whole 30-photo batch through.

The UI sends one photo per request so every queue row has its own state, so most
of these post a single image; the endpoint still takes a list and the last tests
cover that.
"""

import random
from io import BytesIO
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.items import BULK_UPLOAD_BURST
from app.config import get_settings
from app.models.item import ClothingItem, ItemStatus, TaggedBy, TaggingStatus
from app.services.recommendation_service import MIN_CANDIDATES_FOR_OUTFIT


def _image_bytes(seed: int = 0, size=(64, 64)) -> bytes:
    """A photo the perceptual hash can tell apart from the others.

    A flat colour will not do: every solid image has the same perceptual hash, so
    the second one would come back as a duplicate of the first.
    """
    rng = random.Random(seed)
    image = Image.new("RGB", size, (240, 240, 240))
    pixels = image.load()
    for x in range(size[0]):
        for y in range(size[1]):
            pixels[x, y] = (rng.randrange(256), rng.randrange(256), rng.randrange(256))
    buf = BytesIO()
    image.save(buf, format="JPEG")
    return buf.getvalue()


def _photo(name: str = "shirt.jpg", seed: int = 0) -> list[tuple[str, tuple]]:
    """One photo, shaped the way the bulk UI sends it: a list of one."""
    return [("images", (name, _image_bytes(seed), "image/jpeg"))]


def _only(response) -> dict:
    """The single result of a one-photo bulk call."""
    body = response.json()
    assert len(body["results"]) == 1, body
    return body["results"][0]


def _redis_patch(job_id: str = "fake-job-id"):
    """Patch the arq pool so nothing actually enqueues."""
    mock_redis = AsyncMock()
    mock_redis.enqueue_job.return_value.job_id = job_id
    return patch(
        "app.api.items.create_pool", new_callable=AsyncMock, return_value=mock_redis
    ), mock_redis


@pytest.fixture(autouse=True)
def _no_background_removal():
    """rembg is not installed in the test image; assert on it being attempted instead."""
    with patch("app.api.items.ImageService.remove_background") as remove_bg:
        # A real cut-out is WebP under a new name, so the item's paths change too.
        remove_bg.return_value = {
            "image_path": "user/photo.webp",
            "medium_path": "user/photo_medium.webp",
            "thumbnail_path": "user/photo_thumb.webp",
            "original_backup_path": "user/photo_orig.jpg",
        }
        yield remove_bg


class TestBulkUpload:
    @pytest.mark.asyncio
    async def test_photo_without_ai_lands_ready_and_untagged(
        self, client: AsyncClient, auth_headers, db_session: AsyncSession
    ):
        """A user with no AI is the default: the item must still be usable."""
        pool_patch, mock_redis = _redis_patch()
        with pool_patch:
            response = await client.post("/api/v1/items/bulk", files=_photo(), headers=auth_headers)

        assert response.status_code == 201, response.text
        body = _only(response)
        assert body["state"] == "created"
        assert body["success"] is True
        assert body["tagging"] == "skipped"
        assert body["item"]["status"] == "ready"
        assert body["item"]["tagging_status"] == "pending"
        mock_redis.enqueue_job.assert_not_called()

    @pytest.mark.asyncio
    async def test_photo_with_ai_is_queued_not_tagged_in_the_request(
        self, client: AsyncClient, auth_headers, platform_ai_user, db_session: AsyncSession
    ):
        pool_patch, mock_redis = _redis_patch()
        with pool_patch:
            response = await client.post("/api/v1/items/bulk", files=_photo(), headers=auth_headers)

        assert response.status_code == 201, response.text
        body = _only(response)
        assert body["tagging"] == "queued"
        assert body["item"]["status"] == "processing"
        mock_redis.enqueue_job.assert_called_once()
        assert mock_redis.enqueue_job.call_args.kwargs["_queue_name"] == "arq:tagging"

        item_id = body["item"]["id"]
        result = await db_session.execute(select(ClothingItem).where(ClothingItem.id == item_id))
        assert result.scalar_one().ai_job_id == "fake-job-id"

    @pytest.mark.asyncio
    async def test_skip_ai_opts_out_even_with_ai_available(
        self, client: AsyncClient, auth_headers, platform_ai_user
    ):
        pool_patch, mock_redis = _redis_patch()
        with pool_patch:
            response = await client.post(
                "/api/v1/items/bulk",
                files=_photo(),
                data={"skip_ai": "true"},
                headers=auth_headers,
            )

        assert response.status_code == 201
        assert _only(response)["tagging"] == "skipped"
        mock_redis.enqueue_job.assert_not_called()

    @pytest.mark.asyncio
    async def test_background_is_removed_before_tagging_is_queued(
        self, client: AsyncClient, auth_headers, platform_ai_user, _no_background_removal
    ):
        """The worker must see the cut-out, not the bedroom floor behind it."""
        pool_patch, mock_redis = _redis_patch()
        with pool_patch:
            response = await client.post("/api/v1/items/bulk", files=_photo(), headers=auth_headers)

        assert response.status_code == 201
        body = _only(response)
        assert body["background_removed"] is True
        _no_background_removal.assert_called_once()
        assert mock_redis.enqueue_job.called
        # The item now points at the cut-out, and the tagger was pointed at the
        # same file rather than at the photo the cut-out replaced.
        assert body["item"]["image_path"] == "user/photo.webp"
        assert body["item"]["has_cutout"] is True
        assert mock_redis.enqueue_job.call_args.args[2].endswith("user/photo.webp")

    @pytest.mark.asyncio
    async def test_remove_background_false_leaves_the_photo_alone(
        self, client: AsyncClient, auth_headers, _no_background_removal
    ):
        pool_patch, _ = _redis_patch()
        with pool_patch:
            response = await client.post(
                "/api/v1/items/bulk",
                files=_photo(),
                data={"remove_background": "false"},
                headers=auth_headers,
            )

        assert response.status_code == 201
        assert _only(response)["background_removed"] is False
        _no_background_removal.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_dead_background_remover_still_saves_the_garment(
        self, client: AsyncClient, auth_headers, _no_background_removal
    ):
        """No rembg installed is the self-hosted default; it must not fail the upload."""
        _no_background_removal.side_effect = ImportError("no rembg")
        pool_patch, _ = _redis_patch()
        with pool_patch:
            response = await client.post("/api/v1/items/bulk", files=_photo(), headers=auth_headers)

        assert response.status_code == 201, response.text
        body = _only(response)
        assert body["state"] == "created"
        assert body["background_removed"] is False
        assert body["item"]["status"] == "ready"

    @pytest.mark.asyncio
    async def test_a_dead_queue_leaves_the_item_ready_not_stuck_processing(
        self, client: AsyncClient, auth_headers, platform_ai_user
    ):
        """An item stuck in "processing" forever is worse than an untagged one."""
        with patch(
            "app.api.items.create_pool", new_callable=AsyncMock, side_effect=OSError("no redis")
        ):
            response = await client.post("/api/v1/items/bulk", files=_photo(), headers=auth_headers)

        assert response.status_code == 201, response.text
        body = _only(response)
        assert body["tagging"] == "skipped"
        assert body["item"]["status"] == "ready"
        assert body["item"]["tagging_status"] == "pending"

    @pytest.mark.asyncio
    async def test_the_same_photo_twice_reads_as_duplicate_not_as_error(
        self, client: AsyncClient, auth_headers
    ):
        pool_patch, _ = _redis_patch()
        with pool_patch:
            first = await client.post("/api/v1/items/bulk", files=_photo(), headers=auth_headers)
            second = await client.post("/api/v1/items/bulk", files=_photo(), headers=auth_headers)

        assert first.status_code == 201
        assert second.status_code == 201, second.text
        body = _only(second)
        assert body["state"] == "duplicate"
        assert body["error_code"] == "duplicate"
        # It points at the garment already in the wardrobe, so the UI can show it.
        assert body["item"]["id"] == _only(first)["item"]["id"]

    @pytest.mark.asyncio
    async def test_a_file_that_is_not_an_image_fails_only_that_photo(
        self, client: AsyncClient, auth_headers
    ):
        """One bad file in a camera-roll selection must not cost the batch."""
        pool_patch, _ = _redis_patch()
        with pool_patch:
            response = await client.post(
                "/api/v1/items/bulk",
                files=[
                    ("images", ("notes.txt", b"not an image at all", "text/plain")),
                    ("images", ("shirt.jpg", _image_bytes(3), "image/jpeg")),
                ],
                headers=auth_headers,
            )

        assert response.status_code == 201, response.text
        body = response.json()
        assert (body["successful"], body["failed"]) == (1, 1)
        assert body["results"][0]["error_code"] == "invalid_format"
        assert body["results"][1]["state"] == "created"

    @pytest.mark.asyncio
    async def test_an_oversized_photo_says_so_instead_of_blaming_the_format(
        self, client: AsyncClient, auth_headers, monkeypatch
    ):
        """ "Too big" and "not a photo" are different problems with different fixes."""
        monkeypatch.setattr(get_settings(), "max_upload_size_mb", 0)
        response = await client.post("/api/v1/items/bulk", files=_photo(), headers=auth_headers)

        assert response.status_code == 201, response.text
        body = _only(response)
        assert body["state"] == "error"
        assert body["error_code"] == "too_big"

    @pytest.mark.asyncio
    async def test_bulk_upload_requires_auth(self, client: AsyncClient):
        response = await client.post("/api/v1/items/bulk", files=_photo())
        assert response.status_code in (401, 403)


class TestBulkUploadLimits:
    @pytest.mark.asyncio
    async def test_a_full_batch_fits_inside_the_burst_budget(self):
        """A 30-photo batch plus a retry pass must never trip the per-minute limit."""
        settings = get_settings()
        assert settings.max_bulk_upload_count <= BULK_UPLOAD_BURST[0]

    @pytest.mark.asyncio
    async def test_the_burst_budget_is_enforced_per_photo(
        self, client: AsyncClient, auth_headers, monkeypatch
    ):
        monkeypatch.setattr("app.api.items.BULK_UPLOAD_BURST", (2, 60))
        pool_patch, _ = _redis_patch()
        with pool_patch:
            codes = [
                (
                    await client.post(
                        "/api/v1/items/bulk",
                        files=_photo(f"p{i}.jpg", seed=i),
                        headers=auth_headers,
                    )
                ).status_code
                for i in range(1, 4)
            ]

        assert codes[:2] == [201, 201]
        assert codes[2] == 429

    @pytest.mark.asyncio
    async def test_a_multi_photo_bulk_call_is_charged_per_photo(
        self, client: AsyncClient, auth_headers, monkeypatch
    ):
        """One photo per request must not be a way around the per-photo budget."""
        monkeypatch.setattr("app.api.items.BULK_UPLOAD_BURST", (2, 60))
        pool_patch, _ = _redis_patch()
        with pool_patch:
            bulk = await client.post(
                "/api/v1/items/bulk",
                files=[
                    ("images", ("a.jpg", _image_bytes(11), "image/jpeg")),
                    ("images", ("b.jpg", _image_bytes(12), "image/jpeg")),
                ],
                headers=auth_headers,
            )
            after = await client.post(
                "/api/v1/items/bulk",
                files=_photo("c.jpg", seed=7),
                headers=auth_headers,
            )

        assert bulk.status_code == 201, bulk.text
        assert after.status_code == 429

    @pytest.mark.asyncio
    async def test_bulk_still_refuses_more_than_its_own_maximum(
        self, client: AsyncClient, auth_headers
    ):
        settings = get_settings()
        files = [
            ("images", (f"p{i}.jpg", _image_bytes(100 + i), "image/jpeg"))
            for i in range(settings.max_bulk_upload_count + 1)
        ]
        response = await client.post("/api/v1/items/bulk", files=files, headers=auth_headers)
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "too_many_images"


class TestBulkTagging:
    async def _upload(self, client: AsyncClient, auth_headers, seed: int = 0) -> str:
        pool_patch, _ = _redis_patch()
        with pool_patch:
            response = await client.post(
                "/api/v1/items/bulk", files=_photo("x.jpg", seed), headers=auth_headers
            )
        assert response.status_code == 201, response.text
        return _only(response)["item"]["id"]

    @pytest.mark.asyncio
    async def test_manual_pass_tags_several_items_at_once(
        self, client: AsyncClient, auth_headers, db_session: AsyncSession
    ):
        first = await self._upload(client, auth_headers, seed=21)
        second = await self._upload(client, auth_headers, seed=22)

        response = await client.post(
            "/api/v1/items/bulk/tag",
            json={
                "items": [
                    {"item_id": first, "type": "t-shirt", "primary_color": "black"},
                    {"item_id": second, "type": "jeans", "primary_color": "blue"},
                ]
            },
            headers=auth_headers,
        )

        assert response.status_code == 200, response.text
        assert response.json() == {"updated": 2, "failed": 0, "errors": []}

        db_session.expire_all()
        result = await db_session.execute(select(ClothingItem).where(ClothingItem.id == first))
        item = result.scalar_one()
        assert item.type == "t-shirt"
        assert item.primary_color == "black"
        # A colour the user typed belongs in the colour list the rest of the app reads.
        assert item.colors == ["black"]
        assert item.tagging_status == TaggingStatus.tagged
        assert item.tagged_by == TaggedBy.manual
        assert item.tagged_at is not None

    @pytest.mark.asyncio
    async def test_confirming_an_ai_guess_without_changes_marks_it_reviewed(
        self, client: AsyncClient, auth_headers, db_session: AsyncSession
    ):
        item_id = await self._upload(client, auth_headers)

        response = await client.post(
            "/api/v1/items/bulk/tag",
            json={"items": [{"item_id": item_id}]},
            headers=auth_headers,
        )

        assert response.status_code == 200
        assert response.json()["updated"] == 1
        db_session.expire_all()
        result = await db_session.execute(select(ClothingItem).where(ClothingItem.id == item_id))
        assert result.scalar_one().tagging_status == TaggingStatus.tagged

    @pytest.mark.asyncio
    async def test_tagging_rescues_an_item_whose_ai_job_died(
        self, client: AsyncClient, auth_headers, db_session: AsyncSession
    ):
        item_id = await self._upload(client, auth_headers)
        result = await db_session.execute(select(ClothingItem).where(ClothingItem.id == item_id))
        item = result.scalar_one()
        item.status = ItemStatus.error
        await db_session.commit()

        response = await client.post(
            "/api/v1/items/bulk/tag",
            json={"items": [{"item_id": item_id, "type": "coat", "primary_color": "grey"}]},
            headers=auth_headers,
        )

        assert response.status_code == 200
        db_session.expire_all()
        result = await db_session.execute(select(ClothingItem).where(ClothingItem.id == item_id))
        assert result.scalar_one().status == ItemStatus.ready

    @pytest.mark.asyncio
    async def test_another_users_item_is_reported_not_written(
        self, client: AsyncClient, auth_headers
    ):
        response = await client.post(
            "/api/v1/items/bulk/tag",
            json={"items": [{"item_id": str(uuid4()), "type": "t-shirt"}]},
            headers=auth_headers,
        )
        assert response.status_code == 200
        body = response.json()
        assert body == {"updated": 0, "failed": 1, "errors": body["errors"]}
        assert "not found" in body["errors"][0]

    @pytest.mark.asyncio
    async def test_an_empty_pass_is_rejected(self, client: AsyncClient, auth_headers):
        response = await client.post(
            "/api/v1/items/bulk/tag", json={"items": []}, headers=auth_headers
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_tagging_requires_auth(self, client: AsyncClient):
        response = await client.post(
            "/api/v1/items/bulk/tag", json={"items": [{"item_id": str(uuid4())}]}
        )
        assert response.status_code in (401, 403)


class TestWardrobeStats:
    """What the "your wardrobe is still small" nudge is allowed to claim."""

    @pytest.mark.asyncio
    async def test_untagged_photos_do_not_count_as_usable(
        self, client: AsyncClient, auth_headers, db_session: AsyncSession, test_user
    ):
        """Thirty untagged photos look like a full wardrobe and suggest nothing."""
        db_session.add_all(
            [
                ClothingItem(
                    user_id=test_user.id,
                    type="unknown",
                    image_path="a.jpg",
                    status=ItemStatus.ready,
                ),
                ClothingItem(
                    user_id=test_user.id,
                    type="t-shirt",
                    image_path="b.jpg",
                    status=ItemStatus.ready,
                ),
                ClothingItem(
                    user_id=test_user.id,
                    type="jeans",
                    image_path="c.jpg",
                    status=ItemStatus.processing,
                ),
            ]
        )
        await db_session.commit()

        response = await client.get("/api/v1/items/stats", headers=auth_headers)

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["total"] == 3
        assert body["usable"] == 1
        assert body["untyped"] == 1
        assert body["processing"] == 1

    @pytest.mark.asyncio
    async def test_thresholds_come_from_the_engine_not_from_the_ui(
        self, client: AsyncClient, auth_headers
    ):
        response = await client.get("/api/v1/items/stats", headers=auth_headers)
        assert response.status_code == 200
        body = response.json()
        assert body["min_for_looks"] == MIN_CANDIDATES_FOR_OUTFIT
        assert body["max_batch"] == get_settings().max_bulk_upload_count
        # The goal is a goal, not a second gate.
        assert body["variety_target"] > body["min_for_looks"]

    @pytest.mark.asyncio
    async def test_an_empty_wardrobe_is_all_zeroes(self, client: AsyncClient, auth_headers):
        response = await client.get("/api/v1/items/stats", headers=auth_headers)
        assert response.status_code == 200
        body = response.json()
        assert (body["total"], body["usable"], body["untyped"]) == (0, 0, 0)

    @pytest.mark.asyncio
    async def test_stats_require_auth(self, client: AsyncClient):
        response = await client.get("/api/v1/items/stats")
        assert response.status_code in (401, 403)


class TestBulkReviewListing:
    """The review grid reloads its batch by id, so ?ids= has to actually filter."""

    @pytest.mark.asyncio
    async def test_ids_filter_returns_only_the_batch(
        self, client: AsyncClient, auth_headers, db_session: AsyncSession, test_user
    ):
        items = [
            ClothingItem(
                user_id=test_user.id,
                type=t,
                image_path=f"{t}.jpg",
                status=ItemStatus.ready,
            )
            for t in ("t-shirt", "jeans", "coat")
        ]
        db_session.add_all(items)
        await db_session.commit()
        wanted = [str(items[0].id), str(items[2].id)]

        response = await client.get(
            "/api/v1/items", params={"ids": ",".join(wanted)}, headers=auth_headers
        )

        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 2
        assert {item["id"] for item in body["items"]} == set(wanted)

    @pytest.mark.asyncio
    async def test_a_malformed_ids_filter_is_a_400(self, client: AsyncClient, auth_headers):
        response = await client.get(
            "/api/v1/items", params={"ids": "not-a-uuid"}, headers=auth_headers
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_ids"
