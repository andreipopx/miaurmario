"""User feedback ("Enviar sugerencia o fallo") and the public global announcement."""

import io
import logging
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.admin import FEEDBACK_KINDS, FeedbackReport
from app.models.user import User
from app.services.app_settings import get_active_announcement
from app.utils.auth import get_current_user
from app.utils.rate_limit import rate_limit_by_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Feedback"])

# Pillow format -> file extension. Anything else (GIF, SVG, HEIC...) is refused.
ALLOWED_SCREENSHOT_FORMATS = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}
MAX_TEXT = 5000


class FeedbackCreated(BaseModel):
    id: UUID
    status: str
    created_at: datetime


def _clip(value: str | None, length: int) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value[:length] or None


def _bad_request(code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST, detail={"code": code, "message": message}
    )


async def _read_screenshot(upload: UploadFile) -> tuple[bytes, str]:
    """Validate an uploaded screenshot; returns (bytes, extension)."""
    limit = get_settings().feedback_max_upload_mb * 1024 * 1024
    data = await upload.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={"code": "screenshot_too_large", "message": "Screenshot is too large."},
        )
    if not data:
        raise _bad_request("screenshot_invalid", "Empty file.")
    try:
        with Image.open(io.BytesIO(data)) as img:
            fmt = img.format
            img.verify()
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError):
        raise _bad_request("screenshot_invalid", "The screenshot is not a valid image.") from None
    ext = ALLOWED_SCREENSHOT_FORMATS.get(fmt or "")
    if ext is None:
        raise _bad_request("screenshot_invalid", "Only PNG, JPEG or WebP screenshots.")
    return data, ext


@router.post("/feedback", response_model=FeedbackCreated, status_code=status.HTTP_201_CREATED)
async def submit_feedback(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    kind: Annotated[str, Form()],
    text: Annotated[str, Form()],
    page_url: Annotated[str | None, Form()] = None,
    build_id: Annotated[str | None, Form()] = None,
    screenshot: Annotated[UploadFile | None, File()] = None,
) -> FeedbackCreated:
    await rate_limit_by_user(current_user.id, "feedback_submit", 10, 3600)
    if kind not in FEEDBACK_KINDS:
        raise _bad_request("invalid_kind", "Unknown feedback type.")
    body = text.strip()
    if not body:
        raise _bad_request("text_required", "Please describe your suggestion or problem.")
    if len(body) > MAX_TEXT:
        raise _bad_request("text_too_long", f"At most {MAX_TEXT} characters.")

    screenshot_data: tuple[bytes, str] | None = None
    if screenshot is not None and (screenshot.filename or screenshot.size):
        screenshot_data = await _read_screenshot(screenshot)

    report = FeedbackReport(
        id=uuid4(),
        user_id=current_user.id,
        kind=kind,
        text=body,
        page_url=_clip(page_url, 500),
        build_id=_clip(build_id, 100),
        user_agent=_clip(request.headers.get("user-agent"), 500),
        status="new",
    )
    written: Path | None = None
    if screenshot_data is not None:
        data, ext = screenshot_data
        # Under the user's upload dir (deleted with the account) but in a
        # sub-folder the public /images route can never serve.
        relative = f"{current_user.id}/feedback/{report.id}.{ext}"
        written = Path(get_settings().storage_path) / relative
        written.parent.mkdir(parents=True, exist_ok=True)
        written.write_bytes(data)
        report.screenshot_path = relative

    db.add(report)
    try:
        await db.commit()
    except Exception:
        if written is not None:
            written.unlink(missing_ok=True)
        raise
    await db.refresh(report)
    return FeedbackCreated(id=report.id, status=report.status, created_at=report.created_at)


@router.get("/announcement")
async def get_announcement(
    response: Response, db: Annotated[AsyncSession, Depends(get_db)]
) -> dict[str, Any]:
    """Active global announcement (public; cached 30 s in-process and by clients)."""
    response.headers["Cache-Control"] = "public, max-age=60"
    announcement = await get_active_announcement(db)
    if announcement is None:
        return {"announcement": None}
    return {
        "announcement": {
            "id": announcement.get("id"),
            "text": announcement.get("text"),
            "level": announcement.get("level", "info"),
            "expires_at": announcement.get("expires_at"),
        }
    }
