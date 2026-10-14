"""Arq job for «Modo viaje»: plan a trip off the request (one AI call can take a while)."""

import logging
from uuid import UUID

from app.models.trip import Trip
from app.services.trip_service import plan_trip
from app.workers.db import get_db_session

logger = logging.getLogger(__name__)


async def plan_trip_job(ctx: dict, trip_id: str) -> dict:
    db = get_db_session(ctx)
    trip: Trip | None = None
    try:
        trip = await db.get(Trip, UUID(trip_id))
        if trip is None:
            return {"status": "missing"}
        await plan_trip(db, trip)
        return {"status": trip.status, "engine": trip.engine, "days": len(trip.days)}
    except Exception:
        logger.exception("Failed to plan trip %s", trip_id)
        await db.rollback()
        if trip is not None:
            trip.status, trip.error = "error", "failed"
            await db.commit()
        raise
    finally:
        await db.close()
