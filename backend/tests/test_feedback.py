"""User feedback submission (validation, storage) and the admin inbox."""

import io
from pathlib import Path

import pytest_asyncio
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.admin import AdminAuditLog, FeedbackReport
from app.models.user import User
from tests.test_admin_panel import ADMIN_PREFIX, headers_for, make_user

URL = "/api/v1/feedback"


def _png(size=(8, 8)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (255, 126, 182)).save(buf, format="PNG")
    return buf.getvalue()


@pytest_asyncio.fixture
async def admin_user(db_session: AsyncSession, monkeypatch) -> User:
    user = await make_user(db_session)
    monkeypatch.setattr(get_settings(), "admin_emails", user.email)
    return user


@pytest_asyncio.fixture
async def storage(monkeypatch, tmp_path):
    monkeypatch.setattr(get_settings(), "storage_path", str(tmp_path))
    return tmp_path


class TestSubmit:
    async def test_text_only(self, client, db_session, test_user, auth_headers, storage):
        r = await client.post(
            URL,
            data={
                "kind": "suggestion",
                "text": "  Modo oscuro para el calendario  ",
                "page_url": "https://app/dashboard",
                "build_id": "abc123",
            },
            headers={**auth_headers, "User-Agent": "TestUA/1.0"},
        )
        assert r.status_code == 201, r.text
        fb = await db_session.get(FeedbackReport, r.json()["id"])
        assert fb.text == "Modo oscuro para el calendario"
        assert fb.status == "new"
        assert fb.user_agent == "TestUA/1.0"
        assert fb.build_id == "abc123"
        assert fb.screenshot_path is None

    async def test_with_screenshot_stored_privately(
        self, client, db_session, test_user, auth_headers, storage
    ):
        r = await client.post(
            URL,
            data={"kind": "bug", "text": "Se cuelga"},
            files={"screenshot": ("shot.png", _png(), "image/png")},
            headers=auth_headers,
        )
        assert r.status_code == 201, r.text
        fb = await db_session.get(FeedbackReport, r.json()["id"])
        assert fb.screenshot_path == f"{test_user.id}/feedback/{fb.id}.png"
        assert (Path(storage) / fb.screenshot_path).read_bytes() == _png()

        # Not reachable through the public images route (sub-folder).
        r = await client.get(
            f"/api/v1/images/{test_user.id}/feedback/{fb.id}.png", headers=auth_headers
        )
        assert r.status_code == 404

    async def test_rejects_non_image(self, client, auth_headers, storage):
        r = await client.post(
            URL,
            data={"kind": "bug", "text": "x"},
            files={"screenshot": ("shot.png", b"<svg onload=alert(1)>", "image/png")},
            headers=auth_headers,
        )
        assert r.status_code == 400
        assert r.json()["detail"]["code"] == "screenshot_invalid"

    async def test_rejects_gif(self, client, auth_headers, storage):
        buf = io.BytesIO()
        Image.new("RGB", (4, 4)).save(buf, format="GIF")
        r = await client.post(
            URL,
            data={"kind": "bug", "text": "x"},
            files={"screenshot": ("a.gif", buf.getvalue(), "image/gif")},
            headers=auth_headers,
        )
        assert r.status_code == 400

    async def test_rejects_too_large(self, client, auth_headers, storage, monkeypatch):
        monkeypatch.setattr(get_settings(), "feedback_max_upload_mb", 1)
        big = _png() + b"\0" * (1024 * 1024 + 10)
        r = await client.post(
            URL,
            data={"kind": "bug", "text": "x"},
            files={"screenshot": ("a.png", big, "image/png")},
            headers=auth_headers,
        )
        assert r.status_code == 413
        assert not any(Path(storage).rglob("*.png"))

    async def test_rejects_bad_kind_and_empty_text(self, client, auth_headers, storage):
        r = await client.post(URL, data={"kind": "rant", "text": "x"}, headers=auth_headers)
        assert r.status_code == 400
        assert r.json()["detail"]["code"] == "invalid_kind"
        r = await client.post(URL, data={"kind": "other", "text": "   "}, headers=auth_headers)
        assert r.status_code == 400
        assert r.json()["detail"]["code"] == "text_required"

    async def test_requires_auth(self, client, storage):
        r = await client.post(URL, data={"kind": "other", "text": "x"})
        assert r.status_code in (401, 403)


class TestInbox:
    async def test_admin_lists_updates_and_sees_screenshot(
        self, client, db_session, test_user, auth_headers, admin_user, storage
    ):
        r = await client.post(
            URL,
            data={"kind": "bug", "text": "Algo falla"},
            files={"screenshot": ("s.png", _png(), "image/png")},
            headers=auth_headers,
        )
        fid = r.json()["id"]
        admin_h = headers_for(admin_user)

        badge = await client.get(f"{ADMIN_PREFIX}/badge", headers=admin_h)
        assert badge.json()["feedback_new"] >= 1

        listing = await client.get(
            f"{ADMIN_PREFIX}/feedback", params={"status": "new"}, headers=admin_h
        )
        assert listing.status_code == 200
        entry = next(i for i in listing.json()["items"] if i["id"] == fid)
        assert entry["has_screenshot"] is True
        assert "email" not in entry

        shot = await client.get(f"{ADMIN_PREFIX}/feedback/{fid}/screenshot", headers=admin_h)
        assert shot.status_code == 200
        assert shot.content == _png()
        assert "no-store" in shot.headers["cache-control"]

        # The author cannot read the admin inbox or the screenshot endpoint.
        denied = await client.get(f"{ADMIN_PREFIX}/feedback/{fid}/screenshot", headers=auth_headers)
        assert denied.status_code == 403

        upd = await client.patch(
            f"{ADMIN_PREFIX}/feedback/{fid}",
            json={"status": "done", "admin_note": "Arreglado en 2.1"},
            headers=admin_h,
        )
        assert upd.status_code == 200
        assert upd.json()["status"] == "done"
        assert upd.json()["admin_note"] == "Arreglado en 2.1"
        log = (
            await db_session.execute(
                select(AdminAuditLog).where(
                    AdminAuditLog.action == "feedback.update",
                    AdminAuditLog.admin_id == admin_user.id,
                )
            )
        ).scalar_one()
        assert log.details["status"] == {"from": "new", "to": "done"}
