"""Arq worker jobs for the Pinterest integration.

- `import_pinterest_board`: keeps a board's latest pins in `pinterest_pins`
  (keyed by (user_id, pinterest_pin_id)) and reads the board's style into
  `pinterest_boards.summary` with one vision call (see
  ``app.services.pinterest_inspiration``).
- `refresh_expiring_tokens`: nightly cron that renews any connection whose
  refresh_token window closes within a week.
"""

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from app.integrations.pinterest.client import PinterestAPIError, PinterestClient
from app.models.pinterest import PinterestBoard, PinterestConnection, PinterestPin
from app.models.user import User
from app.services.ai_access import require_ai_client
from app.services.ai_service import AIDisabledError
from app.services.pinterest_inspiration import (
    MAX_PINS_PER_BOARD,
    pick_image,
    summarise_board,
)
from app.workers.db import get_db_session

logger = logging.getLogger(__name__)

#: Pages of 100 read to find the latest pins (a board's order is not guaranteed).
MAX_PAGES = 3


async def _board_row(db, user_id: str, board_id: str) -> PinterestBoard:
    row = (
        await db.execute(
            select(PinterestBoard).where(
                PinterestBoard.user_id == user_id, PinterestBoard.board_id == board_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = PinterestBoard(user_id=user_id, board_id=board_id, status="importing")
        db.add(row)
    return row


async def import_pinterest_board(ctx: dict, user_id: str, board_id: str) -> dict:
    """Keep the board's latest pins and sum up its style for Stinky."""
    db = get_db_session(ctx)
    board: PinterestBoard | None = None
    try:
        connection = (
            await db.execute(
                select(PinterestConnection).where(PinterestConnection.user_id == user_id)
            )
        ).scalar_one_or_none()
        if connection is None:
            logger.warning("import_pinterest_board: no connection for user %s", user_id)
            return {"imported": 0, "reason": "no_connection"}

        board = await _board_row(db, user_id, board_id)
        board.status = "importing"
        await db.commit()

        client = PinterestClient(connection, db)
        try:
            meta = await client.get_board(board_id)
            board.name = (meta.get("name") or board.name or "")[:255] or None
            board.privacy = (meta.get("privacy") or "")[:16] or None
        except PinterestAPIError as exc:
            logger.warning("Could not fetch Pinterest board %s: %s", board_id, exc)

        pins: list[dict] = []
        bookmark: str | None = None
        for _ in range(MAX_PAGES):
            page = await client.list_board_pins(board_id, bookmark=bookmark)
            pins.extend(p for p in page.get("items", []) if pick_image(p))
            bookmark = page.get("bookmark")
            if not bookmark:
                break
        pins.sort(key=lambda p: p.get("created_at") or "", reverse=True)
        kept = pins[:MAX_PINS_PER_BOARD]
        keep_ids = [str(p["id"]) for p in kept]

        # The board's library is exactly its latest pins: older ones leave.
        await db.execute(
            delete(PinterestPin).where(
                PinterestPin.user_id == user_id,
                PinterestPin.board_id == board_id,
                PinterestPin.pinterest_pin_id.not_in(keep_ids),
            )
        )
        for pin in kept:
            values = {
                "board_id": board_id,
                "board_name": board.name,
                "image_url": pick_image(pin),
                "source_link": pin.get("link"),
                "description": pin.get("description"),
                "dominant_color": pin.get("dominant_color"),
            }
            await db.execute(
                insert(PinterestPin)
                .values(user_id=user_id, pinterest_pin_id=str(pin["id"]), **values)
                .on_conflict_do_update(constraint="uq_pinterest_pins_user_pin", set_=values)
            )
        board.pin_count = len(kept)
        board.imported_at = datetime.now(UTC)
        board.status = "analyzing"
        await db.commit()

        board.status, board.is_fashion, board.summary = await _analyse(db, user_id, kept)
        board.analyzed_at = datetime.now(UTC)
        await db.commit()
        logger.info(
            "Imported %d pins from board %s for user %s (%s)",
            len(kept),
            board_id,
            user_id,
            board.status,
        )
        return {"imported": len(kept), "board_id": board_id, "status": board.status}
    except PinterestAPIError as exc:
        logger.exception("Pinterest API error importing board %s: %s", board_id, exc)
        if board is not None:
            board.status = "error"
            await db.commit()
        return {"imported": 0, "error": str(exc)}
    finally:
        await db.close()


async def _analyse(db, user_id: str, pins: list[dict]) -> tuple[str, bool | None, str | None]:
    """(status, is_fashion, summary). Without AI access the board is kept, unread."""
    if not pins:
        return "ready", False, None
    user = await db.get(User, user_id)
    if user is None:
        return "error", None, None
    try:
        ai_service = await require_ai_client(db, user, "vision")
    except AIDisabledError as exc:  # also AIAccessError: no access / quota spent
        logger.info("No AI vision to read board for user %s: %s", user_id, exc)
        return "no_ai", None, None
    try:
        is_fashion, summary = await summarise_board(ai_service, pins)
    except Exception as exc:
        logger.warning("Could not read Pinterest board style for user %s: %s", user_id, exc)
        return "error", None, None
    return "ready", is_fashion, summary


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
