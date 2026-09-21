"""Pinterest integration API — OAuth connect, board browse, pin import."""

import logging
import uuid
from typing import Annotated, Any
from urllib.parse import urlencode

from arq import create_pool
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.integrations.pinterest import (
    OAuthStateError,
    PinterestAPIError,
    PinterestClient,
    build_authorize_url,
    consume_state,
    create_state,
    encrypt_token,
    exchange_code,
)
from app.models.pinterest import PinterestConnection, PinterestPin
from app.models.user import User
from app.utils.auth import get_current_user
from app.workers.settings import get_redis_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integrations/pinterest", tags=["integrations"])
pins_router = APIRouter(prefix="/pins", tags=["pins"])


async def _get_connection(
    user_id: uuid.UUID | str, db: AsyncSession
) -> PinterestConnection | None:
    return (
        await db.execute(
            select(PinterestConnection).where(PinterestConnection.user_id == user_id)
        )
    ).scalar_one_or_none()


@router.get("/connect")
async def connect(
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict[str, str]:
    settings = get_settings()
    if not settings.pinterest_client_id or not settings.pinterest_client_secret:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Pinterest not configured")
    state = await create_state(str(current_user.id))
    return {"authorize_url": build_authorize_url(state)}


@router.get("/callback")
async def callback(
    code: Annotated[str, Query()],
    state: Annotated[str, Query()],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RedirectResponse:
    settings = get_settings()
    try:
        user_id_str = await consume_state(state)
        user_id = uuid.UUID(user_id_str)
    except (OAuthStateError, ValueError) as exc:
        logger.warning("Pinterest OAuth state rejected: %s", exc)
        params = urlencode({"error": "invalid_state"})
        return RedirectResponse(
            url=f"{settings.magic_link_base_url or ''}/dashboard/settings/integrations/pinterest?{params}",
            status_code=302,
        )
    try:
        tokens = await exchange_code(code)
    except OAuthStateError as exc:
        logger.warning("Pinterest OAuth token exchange failed: %s", exc)
        params = urlencode({"error": "exchange_failed"})
        return RedirectResponse(
            url=f"{settings.magic_link_base_url or ''}/dashboard/settings/integrations/pinterest?{params}",
            status_code=302,
        )

    existing = await _get_connection(user_id, db)
    pinterest_user_id = "unknown"
    # Try to fetch the account id — best-effort.
    try:
        placeholder = PinterestConnection(
            user_id=user_id,
            pinterest_user_id="pending",
            access_token_ct=encrypt_token(tokens["access_token"]),
            refresh_token_ct=encrypt_token(tokens["refresh_token"]),
            access_token_expires_at=tokens["access_token_expires_at"],
            refresh_token_expires_at=tokens["refresh_token_expires_at"],
            scopes=tokens.get("scope", "boards:read,pins:read"),
        )
        client = PinterestClient(placeholder, db)
        account = await client.get_user_account()
        pinterest_user_id = str(account.get("id") or account.get("username") or "unknown")
    except PinterestAPIError as exc:
        logger.warning("Could not fetch Pinterest user_account: %s", exc)

    if existing:
        existing.access_token_ct = encrypt_token(tokens["access_token"])
        existing.refresh_token_ct = encrypt_token(tokens["refresh_token"])
        existing.access_token_expires_at = tokens["access_token_expires_at"]
        existing.refresh_token_expires_at = tokens["refresh_token_expires_at"]
        existing.scopes = tokens.get("scope", existing.scopes)
        existing.pinterest_user_id = pinterest_user_id
    else:
        db.add(
            PinterestConnection(
                user_id=user_id,
                pinterest_user_id=pinterest_user_id,
                access_token_ct=encrypt_token(tokens["access_token"]),
                refresh_token_ct=encrypt_token(tokens["refresh_token"]),
                access_token_expires_at=tokens["access_token_expires_at"],
                refresh_token_expires_at=tokens["refresh_token_expires_at"],
                scopes=tokens.get("scope", "boards:read,pins:read"),
            )
        )
    await db.commit()
    return RedirectResponse(
        url=f"{settings.magic_link_base_url or ''}/dashboard/settings/integrations/pinterest?connected=1",
        status_code=302,
    )


@router.get("/boards")
async def list_boards(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    bookmark: str | None = None,
) -> dict[str, Any]:
    connection = await _get_connection(str(current_user.id), db)
    if not connection:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pinterest not connected")
    try:
        return await PinterestClient(connection, db).list_boards(bookmark=bookmark)
    except PinterestAPIError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.post("/boards/{board_id}/import", status_code=status.HTTP_202_ACCEPTED)
async def import_board(
    board_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, str]:
    connection = await _get_connection(str(current_user.id), db)
    if not connection:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pinterest not connected")
    redis = await create_pool(get_redis_settings())
    try:
        job = await redis.enqueue_job(
            "import_pinterest_board",
            str(current_user.id),
            board_id,
            _queue_name="arq:tagging",
        )
    finally:
        await redis.aclose()
    if job is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Import already queued")
    return {"job_id": job.job_id}


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    await db.execute(delete(PinterestPin).where(PinterestPin.user_id == current_user.id))
    await db.execute(
        delete(PinterestConnection).where(PinterestConnection.user_id == current_user.id)
    )
    await db.commit()


@pins_router.get("")
async def list_pins(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    board_id: str | None = None,
) -> dict[str, Any]:
    stmt = select(PinterestPin).where(PinterestPin.user_id == current_user.id)
    if board_id:
        stmt = stmt.where(PinterestPin.board_id == board_id)
    stmt = stmt.order_by(PinterestPin.imported_at.desc()).offset(offset).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "items": [
            {
                "id": str(pin.id),
                "pinterest_pin_id": pin.pinterest_pin_id,
                "board_id": pin.board_id,
                "board_name": pin.board_name,
                "image_url": pin.image_url,
                "source_link": pin.source_link,
                "description": pin.description,
                "dominant_color": pin.dominant_color,
                "imported_at": pin.imported_at.isoformat(),
            }
            for pin in rows
        ],
        "limit": limit,
        "offset": offset,
    }
