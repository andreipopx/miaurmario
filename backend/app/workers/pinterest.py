"""Arq worker jobs for the Pinterest integration.

- `import_pinterest_board`: paginates a board's pins and upserts them into
  `pinterest_pins`, keyed by (user_id, pinterest_pin_id).
- `refresh_expiring_tokens`: nightly cron that renews any connection whose
  refresh_token window closes within a week.
"""

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.integrations.pinterest.client import PinterestAPIError, PinterestClient
from app.models.pinterest import PinterestConnection, PinterestPin
from app.workers.db import get_db_session

logger = logging.getLogger(__name__)


def _pick_original_image(pin: dict) -> str | None:
    images = (pin.get("media") or {}).get("images") or {}
    candidate = images.get("originals") or images.get("1200x") or images.get("600x")
    if isinstance(candidate, dict):
        return candidate.get("url")
    return None


async def import_pinterest_board(ctx: dict, user_id: str, board_id: str) -> dict:
    """Import every pin from a board into `pinterest_pins`."""
    db = get_db_session(ctx)
    imported = 0
    try:
        connection = (
            await db.execute(
                select(PinterestConnection).where(PinterestConnection.user_id == user_id)
            )
        ).scalar_one_or_none()
        if connection is None:
            logger.warning("import_pinterest_board: no connection for user %s", user_id)
            return {"imported": 0, "reason": "no_connection"}

        client = PinterestClient(connection, db)
        bookmark: str | None = None
        board_name: str | None = None
        while True:
            page = await client.list_board_pins(board_id, bookmark=bookmark)
            for pin in page.get("items", []):
                image_url = _pick_original_image(pin)
                if not image_url:
                    continue
                stmt = (
                    insert(PinterestPin)
                    .values(
                        user_id=user_id,
                        pinterest_pin_id=str(pin["id"]),
                        board_id=board_id,
                        board_name=board_name,
                        image_url=image_url,
                        source_link=pin.get("link"),
                        description=pin.get("description"),
                        dominant_color=pin.get("dominant_color"),
                    )
                    .on_conflict_do_nothing(constraint="uq_pinterest_pins_user_pin")
                )
                await db.execute(stmt)
                imported += 1
            await db.commit()
            bookmark = page.get("bookmark")
            if not bookmark:
                break
        logger.info("Imported %d pins from board %s for user %s", imported, board_id, user_id)
        return {"imported": imported, "board_id": board_id}
    except PinterestAPIError as exc:
        logger.exception("Pinterest API error importing board %s: %s", board_id, exc)
        return {"imported": imported, "error": str(exc)}
    finally:
        await db.close()


async def refresh_expiring_tokens(ctx: dict) -> dict:
    """Renew Pinterest tokens whose refresh window closes within a week."""
    db = get_db_session(ctx)
    refreshed = 0
    failures = 0
    try:
        cutoff = datetime.now(UTC) + timedelta(days=7)
        rows = (
            (
                await db.execute(
                    select(PinterestConnection).where(
                        PinterestConnection.refresh_token_expires_at < cutoff
                    )
                )
            )
            .scalars()
            .all()
        )
        for connection in rows:
            try:
                await PinterestClient(connection, db)._ensure_fresh()
                refreshed += 1
            except PinterestAPIError as exc:
                failures += 1
                logger.warning(
                    "Failed to refresh Pinterest token for user %s: %s",
                    connection.user_id,
                    exc,
                )
        return {"refreshed": refreshed, "failures": failures}
    finally:
        await db.close()
