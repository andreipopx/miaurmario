from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import ClothingItem, ItemStatus
from app.workers.tagging import update_item_status_to_error


async def _get_item(db_session: AsyncSession, item_id) -> ClothingItem:
    result = await db_session.execute(select(ClothingItem).where(ClothingItem.id == item_id))
    return result.scalar_one()


class TestUpdateItemStatusToError:
    @pytest.mark.asyncio
    async def test_flips_processing_item_to_error(self, db_session: AsyncSession, test_user):
        item = ClothingItem(
            user_id=test_user.id,
            type="shirt",
            image_path="test/a.jpg",
            status=ItemStatus.processing,
        )
        db_session.add(item)
        await db_session.commit()

        ctx: dict = {}
        with (
            patch("app.workers.tagging.get_db_session", return_value=db_session),
            patch.object(db_session, "close", new_callable=AsyncMock),
        ):
            await update_item_status_to_error(ctx, str(item.id), "boom")

        refreshed = await _get_item(db_session, item.id)
        assert refreshed.status == ItemStatus.error
        assert refreshed.ai_raw_response == {"error": "boom"}

    @pytest.mark.asyncio
    async def test_noop_when_item_already_moved_past_processing(
        self, db_session: AsyncSession, test_user
    ):
        item = ClothingItem(
            user_id=test_user.id,
            type="shirt",
            image_path="test/b.jpg",
            status=ItemStatus.ready,
        )
        db_session.add(item)
        await db_session.commit()

        ctx: dict = {}
        with (
            patch("app.workers.tagging.get_db_session", return_value=db_session),
            patch.object(db_session, "close", new_callable=AsyncMock),
        ):
            await update_item_status_to_error(ctx, str(item.id), "boom")

        refreshed = await _get_item(db_session, item.id)
        assert refreshed.status == ItemStatus.ready
        assert refreshed.ai_raw_response is None


class TestTaggingImages:
    """Which file the model sees and which one the colour comes from."""

    @staticmethod
    def _item(image: str | None, original: str | None = None):
        from types import SimpleNamespace

        return SimpleNamespace(image_path=image, original_image_path=original)

    @pytest.fixture
    def storage(self, tmp_path, monkeypatch):
        from app.config import get_settings

        monkeypatch.setattr(get_settings(), "storage_path", str(tmp_path))
        return tmp_path

    def test_original_photo_for_the_model_cutout_for_the_colour(self, storage):
        from app.workers.tagging import tagging_images

        (storage / "cut.webp").write_bytes(b"x")
        (storage / "orig.jpg").write_bytes(b"x")
        ai, colour = tagging_images(self._item("cut.webp", "orig.jpg"), str(storage / "cut.webp"))
        assert ai == storage / "orig.jpg"
        assert colour == storage / "cut.webp"

    def test_queued_file_deleted_by_the_eraser_is_not_needed(self, storage):
        """Upload with the eraser: the job names the pre-brush file, which is gone."""
        from app.workers.tagging import tagging_images

        (storage / "brushed.webp").write_bytes(b"x")
        (storage / "backup.jpg").write_bytes(b"x")
        ai, colour = tagging_images(
            self._item("brushed.webp", "backup.jpg"), str(storage / "deleted.jpg")
        )
        assert ai == storage / "backup.jpg"
        assert colour == storage / "brushed.webp"

    def test_no_original_uses_the_current_image(self, storage):
        from app.workers.tagging import tagging_images

        (storage / "photo.jpg").write_bytes(b"x")
        ai, colour = tagging_images(self._item("photo.jpg"), str(storage / "photo.jpg"))
        assert ai == colour == storage / "photo.jpg"

    def test_nothing_on_disk(self, storage):
        from app.workers.tagging import tagging_images

        assert tagging_images(self._item("gone.jpg"), str(storage / "gone.jpg")) == (None, None)
