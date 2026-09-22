"""Arq jobs for the Música tab: periodic Spotify + Last.fm listening-history sync."""

import asyncio
import logging

from sqlalchemy import select

from app.integrations.lastfm.client import LastfmError, LastfmRateLimited
from app.integrations.lastfm.client import in_cooldown as lastfm_in_cooldown
from app.integrations.spotify.client import SpotifyAPIError
from app.models.lastfm import LastfmConnection
from app.models.spotify import SpotifyConnection
from app.models.user import User
from app.services.lastfm_history import sync_lastfm_history
from app.services.listening_history import sync_listening_history
from app.services.listening_mood import refine_moods_with_ai, user_zone
from app.services.music_source import clear_caches
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


async def _sync_one_lastfm(db, connection: LastfmConnection, user: User) -> int:
    """Sync one Last.fm user; records `last_error` for user-fixable failures.

    Re-raises LastfmError (incl. LastfmRateLimited) so the caller can decide.
    """
    # Rollbacks expire ORM objects: keep plain ids for after them.
    connection_id, user_id, tz_name = connection.id, user.id, user.timezone
    try:
        result = await sync_lastfm_history(db, connection, tz_name=tz_name)
    except LastfmRateLimited:
        await db.rollback()
        raise
    except LastfmError as exc:
        await db.rollback()
        fresh = await db.get(LastfmConnection, connection_id)
        if fresh is not None:
            fresh.last_error = exc.reason
            await db.commit()
        raise
    try:
        await refine_moods_with_ai(db, user, user_zone(tz_name))
        await db.commit()
    except Exception:
        await db.rollback()
        logger.debug("AI mood refinement skipped for %s", user_id, exc_info=True)
    return result.inserted


async def sync_lastfm_history_job(ctx: dict) -> dict:
    """Every 15 min: pull new scrobbles for every Last.fm user.

    Requests go through the shared Redis token bucket; a rate-limit answer
    that survives the client's back-off (error 29) stops the run, as does an
    active cooldown. Private / renamed profiles just skip that user.
    """
    db = get_db_session(ctx)
    synced = inserted = failed = 0
    try:
        if await lastfm_in_cooldown():
            logger.info("Last.fm cooldown active; skipping this sync run")
            return {"synced": 0, "inserted": 0, "failed": 0, "skipped": True}
        ids = (await db.execute(select(LastfmConnection.id))).scalars().all()
        for connection_id in ids:
            connection = await db.get(LastfmConnection, connection_id)
            user = await db.get(User, connection.user_id) if connection else None
            if connection is None or user is None or not user.is_active:
                continue
            user_id = user.id
            try:
                inserted += await _sync_one_lastfm(db, connection, user)
                synced += 1
            except LastfmRateLimited:
                failed += 1
                logger.warning("Last.fm rate limit hit; stopping history sync run")
                break
            except LastfmError as exc:
                failed += 1
                logger.info("Last.fm sync skipped for user %s: %s", user_id, exc)
            except Exception:
                await db.rollback()
                failed += 1
                logger.exception("Last.fm sync failed for user %s", user_id)
            await asyncio.sleep(PAUSE_BETWEEN_USERS_SECONDS)
    finally:
        await db.close()
    logger.info("Last.fm sync: %d users, %d new plays, %d failed", synced, inserted, failed)
    return {"synced": synced, "inserted": inserted, "failed": failed}


async def sync_lastfm_user_job(ctx: dict, user_id: str) -> dict:
    """First import right after connecting (enqueued by the connect endpoint)."""
    db = get_db_session(ctx)
    try:
        connection = (
            await db.execute(select(LastfmConnection).where(LastfmConnection.user_id == user_id))
        ).scalar_one_or_none()
        user = await db.get(User, connection.user_id) if connection else None
        if connection is None or user is None:
            return {"inserted": 0}
        try:
            inserted = await _sync_one_lastfm(db, connection, user)
        except LastfmError as exc:
            logger.info("First Last.fm sync failed for %s: %s", user_id, exc)
            return {"inserted": 0, "error": exc.reason}
        await clear_caches(user_id)
        return {"inserted": inserted}
    finally:
        await db.close()
