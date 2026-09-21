"""Arq jobs for the Música tab: periodic Spotify listening-history sync."""

import asyncio
import logging

from sqlalchemy import select

from app.integrations.spotify.client import SpotifyAPIError
from app.models.spotify import SpotifyConnection
from app.models.user import User
from app.services.listening_history import sync_listening_history
from app.services.listening_mood import refine_moods_with_ai, user_zone
from app.workers.db import get_db_session

logger = logging.getLogger(__name__)

PAUSE_BETWEEN_USERS_SECONDS = 0.5


async def sync_listening_history_job(ctx: dict) -> dict:
    """Every ~30 min: pull recently-played for every connected user.

    A 429 that survives the client's own Retry-After retry stops the run (the
    rate limit is per app, so hammering other users would only make it worse);
    auth failures (revoked / not allow-listed) just skip that user.
    """
    db = get_db_session(ctx)
    synced = inserted = failed = refined = 0
    try:
        user_ids = (await db.execute(select(SpotifyConnection.user_id))).scalars().all()
        for user_id in user_ids:
            connection = (
                await db.execute(
                    select(SpotifyConnection).where(SpotifyConnection.user_id == user_id)
                )
            ).scalar_one_or_none()
            user = await db.get(User, user_id)
            if connection is None or user is None or not user.is_active:
                continue
            try:
                result = await sync_listening_history(db, connection, tz_name=user.timezone)
                synced += 1
                inserted += result.inserted
            except SpotifyAPIError as exc:
                await db.rollback()
                failed += 1
                if exc.status_code == 429:
                    logger.warning("Spotify rate limit hit; stopping history sync run")
                    break
                logger.info("History sync skipped for user %s: %s", user_id, exc)
                continue
            except Exception:
                await db.rollback()
                failed += 1
                logger.exception("History sync failed for user %s", user_id)
                continue
            try:
                refined += await refine_moods_with_ai(db, user, user_zone(user.timezone))
                await db.commit()
            except Exception:
                await db.rollback()
                logger.debug("AI mood refinement skipped for %s", user_id, exc_info=True)
            await asyncio.sleep(PAUSE_BETWEEN_USERS_SECONDS)
    finally:
        await db.close()
    logger.info(
        "Listening history sync: %d users, %d new plays, %d failed, %d AI-refined days",
        synced,
        inserted,
        failed,
        refined,
    )
    return {"synced": synced, "inserted": inserted, "failed": failed, "refined": refined}
