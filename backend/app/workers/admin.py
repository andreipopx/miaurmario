"""Admin background jobs (GDPR account deletion)."""

import logging
import uuid

from app.services.account_deletion import run_account_deletion
from app.workers.db import get_db_session

logger = logging.getLogger(__name__)

QUEUE_NAME = "arq:tagging"  # the single queue the worker consumes


async def delete_user_account(ctx: dict, deletion_id: str) -> dict:
    db = get_db_session(ctx)
    try:
        deletion = await run_account_deletion(db, uuid.UUID(deletion_id))
        status = deletion.status if deletion is not None else "missing"
        logger.info("Account deletion %s finished: %s", deletion_id, status)
        return {"deletion_id": deletion_id, "status": status}
    finally:
        await db.close()
