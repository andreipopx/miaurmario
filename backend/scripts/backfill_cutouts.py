#!/usr/bin/env python3
"""Re-cut existing garments so they keep their transparency.

Background removal used to composite the cut-out onto solid white and store a
JPEG, so every "processed" garment in the wardrobe is really a photo of a white
card. Nothing downstream can float such an image on a tinted tile or lay it out
on a flat-lay canvas. This walks the wardrobe and re-runs the removal, writing
WebP with an alpha channel and pointing each item at the new files.

By default it only touches garments whose background was already removed (they
have a backup, so the untouched photo is still on disk and the cut-out is made
from that — never from an image that has been cut out once already). ``--all``
also processes garments that never had it done.

Usage:
    docker compose exec backend python scripts/backfill_cutouts.py --dry-run
    docker compose exec backend python scripts/backfill_cutouts.py
    docker compose exec backend python scripts/backfill_cutouts.py --all --limit 50
    docker compose exec backend python scripts/backfill_cutouts.py --user <uuid>
"""

import argparse
import asyncio
import sys
from pathlib import Path
from uuid import UUID

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.models.item import ClothingItem, ItemStatus
from app.services.image_service import ImageService
from app.utils.image_formats import is_cutout_path


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--all",
        action="store_true",
        help="Also cut out garments whose background was never removed",
    )
    parser.add_argument("--user", help="Only this user's wardrobe (UUID)")
    parser.add_argument("--limit", type=int, help="Stop after this many garments")
    parser.add_argument(
        "--dry-run", action="store_true", help="Say what would happen and change nothing"
    )
    return parser.parse_args()


async def backfill(args: argparse.Namespace) -> int:
    settings = get_settings()
    image_service = ImageService()

    engine = create_async_engine(str(settings.database_url))
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    done = skipped = failed = 0
    try:
        async with async_session() as db:
            query = select(ClothingItem).where(
                ClothingItem.image_path.isnot(None),
                ClothingItem.status != ItemStatus.archived,
            )
            if not args.all:
                query = query.where(ClothingItem.original_image_path.isnot(None))
            if args.user:
                query = query.where(ClothingItem.user_id == UUID(args.user))
            query = query.order_by(ClothingItem.created_at)

            items = (await db.execute(query)).scalars().all()
            print(f"Found {len(items)} garment(s) to look at")

            for item in items:
                if args.limit is not None and done >= args.limit:
                    break

                label = item.name or item.type or str(item.id)

                if is_cutout_path(item.image_path):
                    print(f"  [{item.id}] already a cut-out: {label}")
                    skipped += 1
                    continue

                # Cut out from the untouched photo when we kept one, so a garment
                # is never cut out twice.
                source = item.original_image_path or item.image_path
                if not (image_service.storage_path / source).exists():
                    print(f"  [{item.id}] file missing ({source}): {label}")
                    skipped += 1
                    continue

                if args.dry_run:
                    print(f"  [{item.id}] would re-cut from {source}: {label}")
                    done += 1
                    continue

                try:
                    result = await asyncio.to_thread(image_service.remove_background, source)
                except Exception as exc:  # noqa: BLE001 - one bad photo must not stop the run
                    print(f"  [{item.id}] failed: {exc}")
                    failed += 1
                    continue

                previous = [item.image_path, item.medium_path, item.thumbnail_path]
                item.image_path = result["image_path"]
                item.medium_path = result.get("medium_path")
                item.thumbnail_path = result.get("thumbnail_path")
                item.original_image_path = result["original_backup_path"]
                await db.commit()
                # Only once the new paths are committed: a crash in between must
                # leave the item pointing at a file that exists.
                image_service.delete_replaced(
                    previous, [item.image_path, item.medium_path, item.thumbnail_path]
                )
                print(f"  [{item.id}] cut out: {label}")
                done += 1
    finally:
        await engine.dispose()

    verb = "would re-cut" if args.dry_run else "re-cut"
    print(f"\nDone. {verb}: {done}, skipped: {skipped}, failed: {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(backfill(_parse_args())))
