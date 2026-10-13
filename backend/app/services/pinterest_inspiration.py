"""Pinterest boards → a few words of taste for Stinky.

A board the person imports is read once: its latest pins are tiled into one
mosaic and a single vision call says whether the board is about clothes and,
if so, sums up its style in one sentence. Only that sentence ever reaches the
stylist prompts (recommendations, pairings, chat), never the photos, so having
boards connected costs nothing per look.
"""

import asyncio
import base64
import io
import json
import logging
import math
import re
from urllib.parse import urlparse
from uuid import UUID

import httpx
from PIL import Image, ImageOps
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pinterest import PinterestBoard
from app.utils.prompts import load_prompt

logger = logging.getLogger(__name__)

BOARD_PROMPT = load_prompt("pinterest_board")

#: Pins kept per board: the latest ones, i.e. their taste now.
MAX_PINS_PER_BOARD = 50
#: Pins tiled into the mosaic the model sees.
COLLAGE_PINS = 16
COLLAGE_COLS = 4
TILE_W, TILE_H = 256, 320
#: A pin image larger than this is skipped rather than decoded.
MAX_IMAGE_BYTES = 6 * 1024 * 1024
#: Only Pinterest's own image CDN is fetched (the URLs come from their API).
IMAGE_HOST_SUFFIX = ".pinimg.com"
SUMMARY_MAX_CHARS = 240
#: What the prompts get from all boards together.
INSPIRATION_MAX_CHARS = 600

# Sizes Pinterest offers per pin, smallest useful first for the mosaic.
ANALYSIS_SIZES = ("600x", "400x300", "1200x", "originals")
DISPLAY_SIZES = ("originals", "1200x", "600x")


def pick_image(pin: dict, sizes: tuple[str, ...] = DISPLAY_SIZES) -> str | None:
    images = (pin.get("media") or {}).get("images") or {}
    for size in sizes:
        candidate = images.get(size)
        if isinstance(candidate, dict) and candidate.get("url"):
            return candidate["url"]
    return None


def _allowed(url: str) -> bool:
    parsed = urlparse(url)
    host = parsed.hostname or ""
    return parsed.scheme == "https" and (host == "pinimg.com" or host.endswith(IMAGE_HOST_SUFFIX))


async def _download(urls: list[str]) -> list[bytes]:
    """Fetch the pin images (Pinterest CDN only); a failed one is just left out."""
    sem = asyncio.Semaphore(6)

    async def one(client: httpx.AsyncClient, url: str) -> bytes | None:
        if not _allowed(url):
            return None
        async with sem:
            try:
                resp = await client.get(url)
                resp.raise_for_status()
            except httpx.HTTPError as exc:
                logger.info("Pin image skipped (%s): %s", url, exc)
                return None
        return resp.content if len(resp.content) <= MAX_IMAGE_BYTES else None

    async with httpx.AsyncClient(timeout=12, follow_redirects=False) as client:
        got = await asyncio.gather(*(one(client, u) for u in urls))
    return [g for g in got if g]


def build_collage(images: list[bytes]) -> str | None:
    """Tile the images (cover-cropped) into one JPEG; base64, or None if none decode."""
    tiles: list[Image.Image] = []
    for raw in images:
        try:
            with Image.open(io.BytesIO(raw)) as img:
                img = ImageOps.exif_transpose(img).convert("RGB")
                tiles.append(ImageOps.fit(img, (TILE_W, TILE_H), Image.Resampling.LANCZOS))
        except Exception as exc:  # a broken image must not sink the board
            logger.info("Pin image could not be decoded: %s", exc)
    if not tiles:
        return None
    cols = min(COLLAGE_COLS, len(tiles))
    rows = math.ceil(len(tiles) / cols)
    sheet = Image.new("RGB", (cols * TILE_W, rows * TILE_H), (255, 255, 255))
    for i, tile in enumerate(tiles):
        sheet.paste(tile, ((i % cols) * TILE_W, (i // cols) * TILE_H))
    buffer = io.BytesIO()
    sheet.save(buffer, format="JPEG", quality=82)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def parse_board_answer(raw: str) -> tuple[bool, str | None]:
    """The model's JSON → (is_fashion, summary). Anything unreadable → (False, None)."""
    match = re.search(r"\{.*\}", raw or "", re.DOTALL)
    if not match:
        return False, None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return False, None
    is_fashion = data.get("moda") is True
    summary = data.get("resumen")
    if not is_fashion or not isinstance(summary, str):
        return False, None
    summary = " ".join(summary.split()).strip(" «»\"'")
    if not summary:
        return False, None
    if len(summary) > SUMMARY_MAX_CHARS:
        summary = summary[: SUMMARY_MAX_CHARS - 1].rsplit(" ", 1)[0] + "…"
    return True, summary


async def summarise_board(ai_service, pins: list[dict]) -> tuple[bool, str | None]:
    """One vision call over a mosaic of the board's latest pins."""
    urls = [u for u in (pick_image(p, ANALYSIS_SIZES) for p in pins[:COLLAGE_PINS]) if u]
    images = await _download(urls)
    collage = await asyncio.to_thread(build_collage, images)
    if collage is None:
        raise ValueError("no pin image could be read")
    raw = await ai_service.analyze_vision_json(collage, BOARD_PROMPT, task_name="pinterest-board")
    return parse_board_answer(raw)


def _clean_name(name: str | None) -> str:
    return " ".join((name or "").split())[:60] or "Sin nombre"


async def pinterest_inspiration_lines(
    db: AsyncSession, user_id: UUID, *, max_chars: int = INSPIRATION_MAX_CHARS
) -> str:
    """One line per fashion board («name»: summary), newest first, capped for the prompt."""
    rows = (
        (
            await db.execute(
                select(PinterestBoard)
                .where(
                    PinterestBoard.user_id == user_id,
                    PinterestBoard.status == "ready",
                    PinterestBoard.is_fashion.is_(True),
                    PinterestBoard.summary.is_not(None),
                )
                .order_by(PinterestBoard.imported_at.desc())
            )
        )
        .scalars()
        .all()
    )
    lines: list[str] = []
    used = 0
    for row in rows:
        line = f"«{_clean_name(row.name)}»: {row.summary}"
        if used + len(line) > max_chars:
            break
        lines.append(line)
        used += len(line) + 1
    return "\n".join(lines)
