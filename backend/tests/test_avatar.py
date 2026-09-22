"""Profile photo: upload/replace/delete, metadata stripping, crop, visibility, deletion."""

from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

from httpx import AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin import AccountDeletion
from app.models.user import User
from app.services.account_deletion import email_sha256, run_account_deletion
from app.services.avatar_service import MAX_AVATAR_BYTES, CropBox, render_avatar
from tests.test_social import _befriend, _headers, _make_user

API = "/api/v1"
STORAGE = Path("/tmp/wardrobe_test")


def _jpeg_with_gps(size=(300, 200), orientation: int | None = None, color="red") -> bytes:
    img = Image.new("RGB", size, color)
    exif = Image.Exif()
    exif[0x010F] = "SpyCam"  # Make
    gps = exif.get_ifd(0x8825)
    gps[1] = "N"
    gps[2] = (40.0, 25.0, 1.5)
    if orientation:
        exif[0x0112] = orientation
    out = BytesIO()
    img.save(out, format="JPEG", exif=exif.tobytes())
    return out.getvalue()


def _two_halves_png(size=(200, 100)) -> bytes:
    """Left half red, right half blue."""
    img = Image.new("RGB", size, "red")
    img.paste(Image.new("RGB", (size[0] // 2, size[1]), "blue"), (size[0] // 2, 0))
    out = BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


async def _upload(client: AsyncClient, user: User, data: bytes, ctype: str, **form):
    return await client.put(
        f"{API}/users/me/avatar",
        headers=_headers(user),
        files={"image": ("photo", data, ctype)},
        data={k: str(v) for k, v in form.items()},
    )


def _path_from_url(url: str) -> str:
    return urlparse(url).path.removeprefix(f"{API}/images/")


class TestRender:
    def test_strips_metadata_and_is_square_webp(self):
        full, thumb = render_avatar(_jpeg_with_gps())
        for data, side in ((full, 200), (thumb, 128)):
            assert b"SpyCam" not in data
            img = Image.open(BytesIO(data))
            assert img.format == "WEBP"
            assert img.size == (side, side)
            assert len(img.getexif()) == 0
            assert "exif" not in img.info and "xmp" not in img.info

    def test_caps_at_512(self):
        full, _ = render_avatar(_jpeg_with_gps(size=(1600, 1200)))
        assert Image.open(BytesIO(full)).size == (512, 512)

    def test_crop_is_applied(self):
        full, _ = render_avatar(_two_halves_png(), CropBox(x=100, y=0, size=100))
        r, g, b = Image.open(BytesIO(full)).convert("RGB").getpixel((50, 50))
        assert b > 200 and r < 60

    def test_crop_is_clamped_inside_the_image(self):
        full, _ = render_avatar(_two_halves_png(), CropBox(x=5000, y=5000, size=5000))
        assert Image.open(BytesIO(full)).size == (100, 100)

    def test_exif_orientation_applied_before_crop(self):
        # 300x200 stored, orientation 6 (rotate 90 CW) -> upright is 200x300.
        img = Image.new("RGB", (300, 200), "red")
        img.paste(Image.new("RGB", (150, 200), "blue"), (150, 0))  # right half blue
        exif = Image.Exif()
        exif[0x0112] = 6
        out = BytesIO()
        img.save(out, format="JPEG", exif=exif.tobytes())
        # After rotating CW, the stored right half ends up at the bottom.
        full, _ = render_avatar(out.getvalue(), CropBox(x=0, y=150, size=150))
        r, g, b = Image.open(BytesIO(full)).convert("RGB").getpixel((75, 75))
        assert b > 180 and r < 80


class TestEndpoints:
    async def test_upload_replace_delete(self, client, db_session: AsyncSession):
        me = await _make_user(db_session, "pic")
        r = await _upload(client, me, _jpeg_with_gps(), "image/jpeg")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["has_avatar_photo"] is True
        assert "/avatar_" in body["avatar_url"] and body["avatar_url"].split("?")[0].endswith(
            ".webp"
        )
        first_full = STORAGE / _path_from_url(body["avatar_url"])
        first_thumb = STORAGE / _path_from_url(body["avatar_thumb_url"])
        assert first_full.exists() and first_thumb.exists()
        assert b"SpyCam" not in first_full.read_bytes()

        # The signed URL serves the image without a bearer token.
        img = await client.get(body["avatar_url"])
        assert img.status_code == 200
        assert img.headers["content-type"] == "image/webp"
        # ...but not without the signature.
        bare = await client.get(body["avatar_url"].split("?")[0])
        assert bare.status_code == 401

        # Replace: old files are removed.
        r = await _upload(
            client, me, _two_halves_png(), "image/png", crop_x=0, crop_y=0, crop_size=100
        )
        assert r.status_code == 200, r.text
        second_full = STORAGE / _path_from_url(r.json()["avatar_url"])
        assert second_full.exists() and second_full != first_full
        assert not first_full.exists() and not first_thumb.exists()

        me_resp = (await client.get(f"{API}/users/me", headers=_headers(me))).json()
        assert me_resp["avatar_url"] == r.json()["avatar_url"]  # stable (cache-friendly) URL

        r = await client.delete(f"{API}/users/me/avatar", headers=_headers(me))
        assert r.status_code == 200
        assert r.json()["avatar_url"] is None
        assert r.json()["has_avatar_photo"] is False
        assert not second_full.exists()
        await db_session.refresh(me)
        assert me.avatar_path is None and me.avatar_thumb_path is None

        # Idempotent
        r = await client.delete(f"{API}/users/me/avatar", headers=_headers(me))
        assert r.status_code == 200

    async def test_rejects_bad_type(self, client, db_session):
        me = await _make_user(db_session, "pic")
        r = await _upload(client, me, b"hello", "text/plain")
        assert r.status_code == 415
        assert r.json()["detail"] == "unsupported_image_type"

    async def test_rejects_non_image_bytes(self, client, db_session):
        me = await _make_user(db_session, "pic")
        r = await _upload(client, me, b"not really a png", "image/png")
        assert r.status_code == 400
        assert r.json()["detail"] == "invalid_image"

    async def test_rejects_disallowed_real_format(self, client, db_session):
        me = await _make_user(db_session, "pic")
        out = BytesIO()
        Image.new("RGB", (50, 50), "red").save(out, format="GIF")
        r = await _upload(client, me, out.getvalue(), "image/png")
        assert r.status_code == 400
        assert r.json()["detail"] == "unsupported_image_type"

    async def test_rejects_too_large(self, client, db_session):
        me = await _make_user(db_session, "pic")
        r = await _upload(client, me, b"\xff" * (MAX_AVATAR_BYTES + 1), "image/jpeg")
        assert r.status_code == 413
        assert r.json()["detail"] == "image_too_large"

    async def test_requires_auth(self, client):
        r = await client.put(
            f"{API}/users/me/avatar", files={"image": ("p", _two_halves_png(), "image/png")}
        )
        assert r.status_code in (401, 403)


class TestVisibility:
    async def test_friends_search_and_profile_show_photo_not_private_fields(
        self, client, db_session
    ):
        ana = await _make_user(db_session, "ana")
        bea = await _make_user(db_session, "bea")
        r = await _upload(client, ana, _jpeg_with_gps(), "image/jpeg")
        assert r.status_code == 200

        # Profile card (any signed-in user, as today) carries a signed photo.
        prof = (
            await client.get(f"{API}/social/users/{ana.username}", headers=_headers(bea))
        ).json()
        assert prof["user"]["avatar_url"] and prof["user"]["avatar_thumb_url"]
        assert prof["user"]["display_name"] == ana.username
        assert "email" not in prof["user"]
        qs = parse_qs(urlparse(prof["user"]["avatar_thumb_url"]).query)
        assert qs["sig"] and qs["expires"]
        assert (await client.get(prof["user"]["avatar_thumb_url"])).status_code == 200

        results = (
            await client.get(
                f"{API}/friends/search", params={"q": ana.username[:5]}, headers=_headers(bea)
            )
        ).json()
        hit = next(x for x in results if x["user"]["username"] == ana.username)
        assert hit["user"]["avatar_thumb_url"]

        await _befriend(client, bea, ana)
        overview = (await client.get(f"{API}/friends", headers=_headers(bea))).json()
        assert overview["friends"][0]["user"]["avatar_thumb_url"]

    async def test_blocked_user_cannot_see_photo(self, client, db_session):
        ana = await _make_user(db_session, "ana")
        eve = await _make_user(db_session, "eve")
        await _upload(client, ana, _jpeg_with_gps(), "image/jpeg")
        r = await client.post(
            f"{API}/friends/block", json={"username": eve.username}, headers=_headers(ana)
        )
        assert r.status_code == 204
        r = await client.get(f"{API}/social/users/{ana.username}", headers=_headers(eve))
        assert r.status_code == 404
        results = (
            await client.get(
                f"{API}/friends/search", params={"q": ana.username[:5]}, headers=_headers(eve)
            )
        ).json()
        assert all(x["user"]["username"] != ana.username for x in results)

    async def test_no_photo_falls_back_to_none(self, client, db_session):
        ana = await _make_user(db_session, "ana")
        bea = await _make_user(db_session, "bea")
        prof = (
            await client.get(f"{API}/social/users/{ana.username}", headers=_headers(bea))
        ).json()
        assert prof["user"]["avatar_url"] is None
        assert prof["user"]["avatar_thumb_url"] is None


class TestAccountDeletion:
    async def test_admin_deletion_removes_avatar_files(self, client, db_session):
        target = await _make_user(db_session, "gone")
        admin = await _make_user(db_session, "boss")
        r = await _upload(client, target, _jpeg_with_gps(), "image/jpeg")
        assert r.status_code == 200
        full = STORAGE / _path_from_url(r.json()["avatar_url"])
        thumb = STORAGE / _path_from_url(r.json()["avatar_thumb_url"])
        assert full.exists() and thumb.exists()

        deletion = AccountDeletion(
            id=uuid4(),
            user_id=target.id,
            email_sha256=email_sha256(target.email),
            requested_by=admin.id,
        )
        db_session.add(deletion)
        await db_session.commit()
        db_session.expunge_all()

        result = await run_account_deletion(db_session, deletion.id)
        assert result.status == "done", result.error
        assert not full.exists() and not thumb.exists()
