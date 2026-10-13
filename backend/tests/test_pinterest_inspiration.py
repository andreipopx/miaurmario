"""Pinterest boards → Stinky: import cap, the board summary and where it reaches."""

import base64
import io
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from cryptography.fernet import Fernet
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select

from app.config import get_settings
from app.integrations import crypto
from app.integrations.crypto import encrypt_token
from app.models.pinterest import PinterestBoard, PinterestConnection, PinterestPin
from app.services import pinterest_inspiration as pi
from app.services.pinterest_inspiration import (
    build_collage,
    parse_board_answer,
    pinterest_inspiration_lines,
)
from app.utils.style_profile import format_style_profile_for_prompt
from app.workers.pinterest import import_pinterest_board


@pytest.fixture
def pinterest_settings(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "pinterest_client_id", "pid")
    monkeypatch.setattr(settings, "pinterest_client_secret", "psecret")
    monkeypatch.setattr(
        settings, "integrations_token_encryption_key", Fernet.generate_key().decode()
    )
    crypto._fernet.cache_clear()
    yield settings
    crypto._fernet.cache_clear()


def _jpeg(color=(200, 120, 90), size=(60, 90)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="JPEG")
    return buf.getvalue()


def _pin(i: int, day: int) -> dict:
    return {
        "id": str(1000 + i),
        "created_at": f"2026-09-{day:02d}T10:00:00",
        "link": None,
        "description": f"pin {i}",
        "dominant_color": "#aabbcc",
        "media": {
            "images": {
                "600x": {"url": f"https://i.pinimg.com/600x/{i}.jpg"},
                "originals": {"url": f"https://i.pinimg.com/originals/{i}.jpg"},
            }
        },
    }


async def _connect(db_session, user) -> None:
    now = datetime.now(UTC)
    db_session.add(
        PinterestConnection(
            user_id=user.id,
            pinterest_user_id="@me",
            access_token_ct=encrypt_token("a"),
            refresh_token_ct=encrypt_token("r"),
            access_token_expires_at=now + timedelta(hours=1),
            refresh_token_expires_at=now + timedelta(days=60),
            scopes="boards:read,pins:read",
        )
    )
    await db_session.commit()


class TestParse:
    def test_fashion_board(self):
        ok, summary = parse_board_answer(
            'Claro: {"moda": true, "resumen": "«minimalista en crudo:  blazer y vaqueros»"}'
        )
        assert ok is True
        assert summary == "minimalista en crudo: blazer y vaqueros"

    def test_not_fashion_or_garbage(self):
        assert parse_board_answer('{"moda": false, "resumen": ""}') == (False, None)
        assert parse_board_answer("no sé") == (False, None)
        assert parse_board_answer('{"moda": "sí", "resumen": "x"}') == (False, None)

    def test_long_summary_is_capped(self):
        ok, summary = parse_board_answer('{"moda": true, "resumen": "' + "palabra " * 80 + '"}')
        assert ok and len(summary) <= pi.SUMMARY_MAX_CHARS


class TestCollage:
    def test_tiles_into_one_jpeg(self):
        b64 = build_collage([_jpeg(), _jpeg((10, 10, 10)), b"not an image", _jpeg()])
        img = Image.open(io.BytesIO(base64.b64decode(b64)))
        # three decodable images → one row of three tiles
        assert img.size == (3 * pi.TILE_W, pi.TILE_H)

    def test_nothing_readable(self):
        assert build_collage([b"nope"]) is None

    def test_only_pinterest_cdn_is_fetched(self):
        assert pi._allowed("https://i.pinimg.com/600x/a.jpg")
        assert not pi._allowed("http://i.pinimg.com/600x/a.jpg")
        assert not pi._allowed("https://evil.example/pinimg.com.jpg")
        assert not pi._allowed("https://169.254.169.254/latest")


class TestReachesStinky:
    async def test_lines_only_fashion_ready_boards_newest_first(self, db_session, test_user):
        now = datetime.now(UTC)
        for i, (status, fashion, summary) in enumerate(
            [
                ("ready", True, "minimal en camel"),
                ("ready", False, None),  # frases motivacionales
                ("analyzing", None, None),
                ("ready", True, "boho con flecos"),
            ]
        ):
            db_session.add(
                PinterestBoard(
                    user_id=test_user.id,
                    board_id=f"b{i}",
                    name=f"Tablero\n{i}",
                    status=status,
                    is_fashion=fashion,
                    summary=summary,
                    imported_at=now - timedelta(days=i),
                )
            )
        await db_session.commit()
        text = await pinterest_inspiration_lines(db_session, test_user.id)
        assert text.splitlines() == [
            "«Tablero 0»: minimal en camel",
            "«Tablero 3»: boho con flecos",
        ]
        assert await pinterest_inspiration_lines(db_session, test_user.id, max_chars=40) == (
            "«Tablero 0»: minimal en camel"
        )

    def test_style_profile_carries_it(self):
        text = format_style_profile_for_prompt(None, inspiration_text="«Ideas»: minimal en camel")
        assert "Pinterest" in text
        assert "  «Ideas»: minimal en camel" in text
        assert "prendas que SÍ tiene" in text


class TestImportWorker:
    async def test_keeps_latest_50_and_reads_the_board(
        self, db_session, test_user, pinterest_settings
    ):
        await _connect(db_session, test_user)
        # an old pin from an earlier import that is no longer among the latest
        db_session.add(
            PinterestPin(
                user_id=test_user.id,
                pinterest_pin_id="old",
                board_id="B1",
                image_url="https://i.pinimg.com/x.jpg",
            )
        )
        await db_session.commit()
        pins = [_pin(i, 1 + i % 28) for i in range(120)]
        client = AsyncMock()
        client.get_board.return_value = {"name": "Looks otoño", "privacy": "SECRET"}
        client.list_board_pins.side_effect = [
            {"items": pins[:100], "bookmark": "n"},
            {"items": pins[100:], "bookmark": None},
        ]
        summarise = AsyncMock(return_value=(True, "otoño en marrones: gabardina y botas"))
        with (
            patch("app.workers.pinterest.get_db_session", return_value=db_session),
            patch("app.workers.pinterest.PinterestClient", return_value=client),
            patch("app.workers.pinterest.require_ai_client", AsyncMock(return_value=object())),
            patch("app.workers.pinterest.summarise_board", summarise),
        ):
            out = await import_pinterest_board({}, str(test_user.id), "B1")

        assert out == {"imported": 50, "board_id": "B1", "status": "ready"}
        kept = (
            (
                await db_session.execute(
                    select(PinterestPin).where(
                        PinterestPin.user_id == test_user.id, PinterestPin.board_id == "B1"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(kept) == 50
        assert "old" not in {p.pinterest_pin_id for p in kept}
        # the newest pins (by created_at) are the ones handed to the model
        handed = summarise.await_args.args[1]
        assert handed[0]["created_at"] >= handed[-1]["created_at"]
        board = (
            await db_session.execute(
                select(PinterestBoard).where(
                    PinterestBoard.user_id == test_user.id, PinterestBoard.board_id == "B1"
                )
            )
        ).scalar_one()
        assert (board.name, board.privacy, board.pin_count) == ("Looks otoño", "SECRET", 50)
        assert board.is_fashion is True
        assert board.summary == "otoño en marrones: gabardina y botas"

    async def test_without_ai_the_board_is_kept_unread(
        self, db_session, test_user, pinterest_settings
    ):
        from app.services.ai_access import AIAccessError

        await _connect(db_session, test_user)
        client = AsyncMock()
        client.get_board.return_value = {"name": "Ideas"}
        client.list_board_pins.return_value = {"items": [_pin(1, 3)], "bookmark": None}
        with (
            patch("app.workers.pinterest.get_db_session", return_value=db_session),
            patch("app.workers.pinterest.PinterestClient", return_value=client),
            patch(
                "app.workers.pinterest.require_ai_client",
                AsyncMock(side_effect=AIAccessError("no access")),
            ),
        ):
            out = await import_pinterest_board({}, str(test_user.id), "B2")
        assert out["status"] == "no_ai"


class TestBoardsAPI:
    async def test_list_marks_shared_boards_and_remove_forgets_them(
        self,
        client: AsyncClient,
        auth_headers,
        db_session,
        test_user,
        pinterest_settings,
    ):
        await _connect(db_session, test_user)
        db_session.add(
            PinterestBoard(
                user_id=test_user.id,
                board_id="B1",
                status="ready",
                is_fashion=True,
                summary="minimal",
                pin_count=12,
            )
        )
        db_session.add(
            PinterestPin(
                user_id=test_user.id,
                pinterest_pin_id="p1",
                board_id="B1",
                image_url="https://i.pinimg.com/x.jpg",
            )
        )
        await db_session.commit()
        page = {"items": [{"id": "B1", "name": "Uno"}, {"id": "B2", "name": "Dos"}]}
        with patch(
            "app.api.integrations.pinterest.PinterestClient.list_boards",
            AsyncMock(return_value=page),
        ):
            resp = await client.get("/api/v1/integrations/pinterest/boards", headers=auth_headers)
        items = resp.json()["items"]
        assert items[0]["stinky"]["summary"] == "minimal"
        assert items[0]["stinky"]["pin_count"] == 12
        assert items[1]["stinky"] is None

        resp = await client.delete("/api/v1/integrations/pinterest/boards/B1", headers=auth_headers)
        assert resp.status_code == 204
        mine_b1 = (PinterestBoard.user_id == test_user.id, PinterestBoard.board_id == "B1")
        assert (await db_session.execute(select(PinterestBoard).where(*mine_b1))).all() == []
        pins = select(PinterestPin).where(PinterestPin.user_id == test_user.id)
        assert (await db_session.execute(pins)).all() == []

    async def test_import_rejects_odd_board_ids(
        self,
        client: AsyncClient,
        auth_headers,
        pinterest_settings,
    ):
        resp = await client.post(
            "/api/v1/integrations/pinterest/boards/..%2Fx/import", headers=auth_headers
        )
        assert resp.status_code in (404, 422)


@pytest.fixture(autouse=True)
def _no_real_rate_limit():
    with patch("app.api.integrations.pinterest.rate_limit_by_user", AsyncMock()):
        yield
