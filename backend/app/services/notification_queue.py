"""Hand notification work to the arq worker (best effort, never fails a request)."""

import logging
from uuid import UUID

from arq import create_pool

from app.workers.settings import get_redis_settings

logger = logging.getLogger(__name__)

QUEUE_NAME = "arq:tagging"  # the single queue the worker consumes


async def enqueue_social_notification(event: str, friendship_id: UUID) -> None:
    try:
        redis = await create_pool(get_redis_settings())
        try:
            await redis.enqueue_job(
                "send_social_notification",
                event,
                str(friendship_id),
                _queue_name=QUEUE_NAME,
                _job_id=f"social:{event}:{friendship_id}",
            )
        finally:
            await redis.aclose()
    except Exception as exc:
        logger.warning("Could not enqueue %s notification for %s: %s", event, friendship_id, exc)


async def enqueue_waitlist_admin_notification(request_id: UUID) -> None:
    try:
        redis = await create_pool(get_redis_settings())
        try:
            await redis.enqueue_job(
                "send_waitlist_admin_notification",
                str(request_id),
                _queue_name=QUEUE_NAME,
                _job_id=f"waitlist-admin:{request_id}",
            )
        finally:
            await redis.aclose()
    except Exception as exc:
        logger.warning("Could not enqueue waitlist admin notification %s: %s", request_id, exc)


async def enqueue_spotify_seat_request(user_id: UUID, spotify_email: str) -> None:
    """Pedir plaza de Spotify -> admin alert. Nothing is stored; the email only
    travels through the job payload."""
    try:
        redis = await create_pool(get_redis_settings())
        try:
            await redis.enqueue_job(
                "send_spotify_seat_request_notification",
                str(user_id),
                spotify_email,
                _queue_name=QUEUE_NAME,
                _job_id=f"spotify-seat:{user_id}:{spotify_email.lower()}",
            )
        finally:
            await redis.aclose()
    except Exception as exc:
        logger.warning("Could not enqueue Spotify seat request for %s: %s", user_id, exc)
