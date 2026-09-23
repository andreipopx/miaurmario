"""Tests for "selfie -> qué llevas puesto".

Covers the four things that can quietly break: parsing a real-ish vision
answer, the wardrobe matcher, the no-AI path (the feature must be unavailable
with an explained error, never a crash) and the per-user rate limit. Plus the
privacy contract: the sanitizer drops EXIF/GPS and nothing is written to disk.
"""

import io
from datetime import date
from uuid import uuid4

import pytest
from fastapi import HTTPException, status
from httpx import AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import ClothingItem, ItemStatus
from app.models.user import User
from app.services.selfie_outfit import (
    MATCH_THRESHOLD,
    DetectedGarment,
    SelfieImageError,
    build_color_swatch,
    match_garments,
    parse_detections,
    sanitize_selfie,
    score_item,
)

# --- Helpers ---------------------------------------------------------------------


def _item(
    *,
    type: str,
    primary_color: str | None = None,
    colors: list[str] | None = None,
    pattern: str | None = None,
    material: str | None = None,
    subtype: str | None = None,
    name: str | None = None,
    wear_count: int = 0,
) -> ClothingItem:
    return ClothingItem(
        id=uuid4(),
        user_id=uuid4(),
        image_path="u/x.jpg",
        thumbnail_path="u/x_thumb.jpg",
        type=type,
        subtype=subtype,
        primary_color=primary_color,
        colors=colors if colors is not None else ([primary_color] if primary_color else []),
        pattern=pattern,
        material=material,
        name=name,
        wear_count=wear_count,
        status=ItemStatus.ready,
        is_archived=False,
    )


def _image_bytes(size=(600, 900), fmt="JPEG", **save_kwargs) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (120, 140, 180)).save(buf, format=fmt, **save_kwargs)
    return buf.getvalue()


async def _store_item(db: AsyncSession, user: User, **kwargs) -> ClothingItem:
    item = _item(**kwargs)
    item.user_id = user.id
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


# --- Detection parsing -------------------------------------------------------------


class TestParseDetections:
    def test_parses_plain_json_answer(self):
        raw = (
            '{"garments":[{"type":"hoodie","subtype":null,"primary_color":"navy",'
            '"colors":["navy"],"pattern":"solid","material":"cotton"},'
            '{"type":"jeans","subtype":null,"primary_color":"blue","colors":["blue"],'
            '"pattern":"solid","material":"denim"}]}'
        )
        garments = parse_detections(raw)
        assert [g.type for g in garments] == ["hoodie", "jeans"]
        assert garments[0].primary_color == "navy"
        assert garments[0].material == "cotton"
        assert garments[1].pattern == "solid"

    def test_parses_fenced_json_with_prose_around_it(self):
        raw = (
            "Sure, here is the list:\n```json\n"
            '{"garments":[{"type":"t-shirt","primary_color":"white","colors":["white"],'
            '"pattern":"graphic"}]}\n```\nHope it helps!'
        )
        garments = parse_detections(raw)
        assert len(garments) == 1
        assert garments[0].type == "t-shirt"
        assert garments[0].pattern == "graphic"

    def test_accepts_a_bare_array(self):
        raw = '[{"type":"sneakers","primary_color":"white","pattern":"solid"}]'
        assert [g.type for g in parse_detections(raw)] == ["sneakers"]

    def test_drops_values_outside_the_contract(self):
        raw = (
            '{"garments":[{"type":"kimono","primary_color":"turquoise"},'
            '{"type":"Shirt","primary_color":"CHARTREUSE","pattern":"swirly",'
            '"material":"unobtanium","colors":["navy","chartreuse"]}]}'
        )
        garments = parse_detections(raw)
        # "kimono" is not a known type -> the whole entry is unusable.
        assert len(garments) == 1
        g = garments[0]
        assert g.type == "shirt"
        assert g.pattern is None
        assert g.material is None
        # Unknown colours are dropped; the known secondary becomes the primary.
        assert g.primary_color == "navy"
        assert g.colors == ["navy"]

    def test_empty_and_garbage_answers_yield_no_garments(self):
        assert parse_detections("") == []
        assert parse_detections("I cannot help with that.") == []
        assert parse_detections('{"garments":[]}') == []

    def test_caps_the_number_of_garments(self):
        raw = '{"garments":[' + ",".join(['{"type":"shirt","primary_color":"red"}'] * 20) + "]}"
        assert len(parse_detections(raw)) == 8


# --- Matching ------------------------------------------------------------------------


class TestMatching:
    def test_same_type_and_colour_is_a_confident_match(self):
        detected = DetectedGarment(
            type="hoodie", primary_color="navy", colors=["navy"], pattern="solid"
        )
        item = _item(type="hoodie", primary_color="navy", pattern="solid")
        score, confident = score_item(detected, item)
        assert confident is True
        assert score >= MATCH_THRESHOLD

    def test_same_type_wrong_colour_is_not_a_match(self):
        detected = DetectedGarment(type="hoodie", primary_color="red", colors=["red"])
        item = _item(type="hoodie", primary_color="navy")
        score, confident = score_item(detected, item)
        assert confident is False
        assert score > 0  # still offered as an alternative

    def test_nearby_colour_still_matches(self):
        detected = DetectedGarment(
            type="jeans", primary_color="navy", colors=["navy"], pattern="solid"
        )
        item = _item(type="jeans", primary_color="blue", pattern="solid")
        score, confident = score_item(detected, item)
        assert confident is True

    def test_different_body_slot_never_scores(self):
        detected = DetectedGarment(type="sneakers", primary_color="white")
        item = _item(type="shirt", primary_color="white")
        assert score_item(detected, item) == (0.0, False)

    def test_related_type_is_a_candidate_but_not_a_confident_match(self):
        detected = DetectedGarment(type="sneakers", primary_color="white", pattern="solid")
        item = _item(type="boots", primary_color="white", pattern="solid")
        score, confident = score_item(detected, item)
        assert score > 0
        assert confident is False

    def test_pattern_mismatch_is_penalised(self):
        detected = DetectedGarment(type="shirt", primary_color="blue", pattern="striped")
        plain = _item(type="shirt", primary_color="blue", pattern="solid")
        striped = _item(type="shirt", primary_color="blue", pattern="striped")
        assert score_item(detected, striped)[0] > score_item(detected, plain)[0]

    def test_match_garments_picks_best_and_lists_alternatives(self):
        detected = [
            DetectedGarment(type="hoodie", primary_color="navy", colors=["navy"], pattern="solid")
        ]
        exact = _item(type="hoodie", primary_color="navy", pattern="solid", name="Sudadera azul")
        other = _item(type="hoodie", primary_color="red", pattern="solid", name="Sudadera roja")
        results = match_garments(detected, [other, exact])
        assert results[0].match is exact
        assert [i.name for i in results[0].alternatives] == ["Sudadera roja"]

    def test_one_wardrobe_item_is_never_matched_twice(self):
        # Two very similar detections, a single matching item in the wardrobe.
        detected = [
            DetectedGarment(type="t-shirt", primary_color="white", colors=["white"]),
            DetectedGarment(type="t-shirt", primary_color="white", colors=["white"]),
        ]
        only = _item(type="t-shirt", primary_color="white", pattern="solid")
        results = match_garments(detected, [only])
        assigned = [r for r in results if r.match is not None]
        assert len(assigned) == 1
        assert results[1].match is None or results[0].match is None
        # The unmatched one does not offer the taken item either.
        unassigned = next(r for r in results if r.match is None)
        assert only.id not in [i.id for i in unassigned.alternatives]

    def test_unmatched_garment_has_no_match(self):
        detected = [DetectedGarment(type="scarf", primary_color="green")]
        results = match_garments(detected, [_item(type="jeans", primary_color="blue")])
        assert results[0].match is None
        assert results[0].alternatives == []

    def test_item_without_colour_is_only_an_alternative(self):
        detected = DetectedGarment(type="shirt", primary_color="green", pattern="solid")
        item = _item(type="shirt", primary_color=None, colors=[], pattern="solid")
        score, confident = score_item(detected, item)
        assert score > 0
        assert confident is False


# --- Privacy: the photo itself --------------------------------------------------------


class TestSanitizeSelfie:
    def test_strips_exif_and_gps(self):
        exif = Image.Exif()
        exif[0x0110] = "TestPhone"  # Model
        exif[0x0112] = 1  # Orientation
        exif[0x8825] = {1: "N", 2: (41.0, 23.0, 0.0), 3: "E", 4: (2.0, 10.0, 0.0)}  # GPSInfo
        source = _image_bytes(exif=exif.tobytes())
        assert Image.open(io.BytesIO(source)).getexif(), "fixture should carry EXIF"

        out = base64_to_bytes(sanitize_selfie(source))
        with Image.open(io.BytesIO(out)) as img:
            assert dict(img.getexif()) == {}
            assert img.format == "JPEG"

    def test_applies_orientation_then_discards_it(self):
        exif = Image.Exif()
        exif[0x0112] = 6  # rotate 90°: the long edge changes side
        source = _image_bytes(size=(400, 200), exif=exif.tobytes())
        with Image.open(io.BytesIO(base64_to_bytes(sanitize_selfie(source)))) as img:
            assert img.size == (200, 400)

    def test_downscales_large_photos(self):
        out = base64_to_bytes(sanitize_selfie(_image_bytes(size=(3000, 4000))))
        with Image.open(io.BytesIO(out)) as img:
            assert max(img.size) == 768

    def test_rejects_garbage_and_empty_uploads(self):
        with pytest.raises(SelfieImageError):
            sanitize_selfie(b"not an image at all")
        with pytest.raises(SelfieImageError):
            sanitize_selfie(b"")

    def test_rejects_oversized_uploads(self):
        with pytest.raises(SelfieImageError):
            sanitize_selfie(b"\x00" * (16 * 1024 * 1024))

    def test_swatch_is_a_flat_tile_in_the_detected_colour(self):
        with Image.open(io.BytesIO(build_color_swatch("navy"))) as img:
            assert img.size == (800, 800)
            colors = img.convert("RGB").getcolors(maxcolors=100)
            assert colors is not None and len(colors) <= 3


def base64_to_bytes(data: str) -> bytes:
    import base64

    return base64.b64decode(data)


# --- API ------------------------------------------------------------------------------


class _FakeAI:
    def __init__(self, answer: str):
        self.answer = answer
        self.calls = 0

    async def analyze_vision_json(self, image_base64: str, prompt: str, task_name: str = "") -> str:
        self.calls += 1
        assert image_base64, "the sanitized photo should reach the model"
        return self.answer


@pytest.fixture
def fake_ai(monkeypatch):
    def install(answer: str) -> _FakeAI:
        ai = _FakeAI(answer)

        async def _require(db, user, capability):
            assert capability == "vision"
            return ai

        monkeypatch.setattr("app.api.selfie.require_ai_client", _require)
        return ai

    return install


SELFIE_ANSWER = (
    '{"garments":[{"type":"hoodie","primary_color":"navy","colors":["navy"],'
    '"pattern":"solid","material":"cotton"},'
    '{"type":"sneakers","primary_color":"white","colors":["white"],"pattern":"solid"}]}'
)


@pytest.mark.asyncio
class TestSelfieAnalyzeEndpoint:
    async def test_matches_wardrobe_items_and_flags_the_rest(
        self, client: AsyncClient, db_session, test_user, auth_headers, fake_ai
    ):
        fake_ai(SELFIE_ANSWER)
        hoodie = await _store_item(
            db_session,
            test_user,
            type="hoodie",
            primary_color="navy",
            pattern="solid",
            name="Sudadera azul",
        )

        response = await client.post(
            "/api/v1/selfie/analyze",
            files={"image": ("selfie.jpg", _image_bytes(), "image/jpeg")},
            headers=auth_headers,
        )

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["photo_stored"] is False
        assert data["matched_count"] == 1
        assert [g["type"] for g in data["garments"]] == ["hoodie", "sneakers"]
        assert data["garments"][0]["match"]["id"] == str(hoodie.id)
        assert data["garments"][0]["match"]["name"] == "Sudadera azul"
        assert data["garments"][1]["match"] is None

    async def test_empty_answer_is_not_an_error(
        self, client: AsyncClient, test_user, auth_headers, fake_ai
    ):
        fake_ai('{"garments":[]}')
        response = await client.post(
            "/api/v1/selfie/analyze",
            files={"image": ("selfie.jpg", _image_bytes(), "image/jpeg")},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["garments"] == []

    async def test_invalid_image_is_rejected_before_the_model(
        self, client: AsyncClient, test_user, auth_headers, fake_ai
    ):
        ai = fake_ai(SELFIE_ANSWER)
        response = await client.post(
            "/api/v1/selfie/analyze",
            files={"image": ("selfie.jpg", b"definitely not a jpeg", "image/jpeg")},
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "selfie_invalid_image"
        assert ai.calls == 0

    async def test_without_ai_the_feature_is_unavailable_but_explained(
        self, client: AsyncClient, test_user, auth_headers
    ):
        # test_user has no user_ai_settings row -> access "none".
        response = await client.post(
            "/api/v1/selfie/analyze",
            files={"image": ("selfie.jpg", _image_bytes(), "image/jpeg")},
            headers=auth_headers,
        )
        assert response.status_code == 403
        detail = response.json()["detail"]
        assert detail["code"] == "ai_not_enabled"
        assert detail["message"]

    async def test_rate_limited_per_user(
        self, client: AsyncClient, test_user, auth_headers, fake_ai, monkeypatch
    ):
        ai = fake_ai(SELFIE_ANSWER)
        seen: list[tuple] = []

        async def _limiter(user_id, action, max_requests, window_seconds):
            seen.append((action, max_requests, window_seconds))
            if len(seen) > 1:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many requests. Please try again later.",
                )

        monkeypatch.setattr("app.api.selfie.rate_limit_by_user", _limiter)
        response = await client.post(
            "/api/v1/selfie/analyze",
            files={"image": ("selfie.jpg", _image_bytes(), "image/jpeg")},
            headers=auth_headers,
        )
        assert response.status_code == 429
        assert ai.calls == 0
        assert seen[0][0] == "selfie_analyze_burst"

    async def test_requires_authentication(self, client: AsyncClient):
        response = await client.post(
            "/api/v1/selfie/analyze",
            files={"image": ("selfie.jpg", _image_bytes(), "image/jpeg")},
        )
        assert response.status_code in (401, 403)

    async def test_other_users_items_are_never_offered(
        self, client: AsyncClient, db_session, test_user, auth_headers, fake_ai
    ):
        fake_ai(SELFIE_ANSWER)
        stranger = User(
            id=uuid4(),
            external_id=f"stranger-{uuid4()}",
            email=f"stranger-{uuid4()}@example.com",
            display_name="Stranger",
            timezone="UTC",
            is_active=True,
        )
        db_session.add(stranger)
        await db_session.commit()
        await _store_item(
            db_session, stranger, type="hoodie", primary_color="navy", pattern="solid"
        )

        response = await client.post(
            "/api/v1/selfie/analyze",
            files={"image": ("selfie.jpg", _image_bytes(), "image/jpeg")},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["matched_count"] == 0


@pytest.mark.asyncio
class TestSelfieItemCreation:
    async def test_creates_a_prefilled_item_with_a_placeholder_photo(
        self, client: AsyncClient, test_user, auth_headers
    ):
        response = await client.post(
            "/api/v1/selfie/items",
            json={
                "type": "hoodie",
                "primary_color": "navy",
                "colors": ["navy"],
                "pattern": "solid",
                "material": "cotton",
                "name": "Sudadera nueva",
            },
            headers=auth_headers,
        )
        assert response.status_code == 201, response.text
        item = response.json()
        assert item["type"] == "hoodie"
        assert item["primary_color"] == "navy"
        assert item["pattern"] == "solid"
        assert item["material"] == "cotton"
        assert item["status"] == "ready"
        assert item["name"] == "Sudadera nueva"
        assert item["image_url"]

    async def test_rejects_an_unknown_type(self, client: AsyncClient, test_user, auth_headers):
        response = await client.post(
            "/api/v1/selfie/items",
            json={"type": "kimono", "primary_color": "navy"},
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "selfie_invalid_type"

    async def test_drops_values_outside_the_contract(
        self, client: AsyncClient, test_user, auth_headers
    ):
        response = await client.post(
            "/api/v1/selfie/items",
            json={
                "type": "jeans",
                "primary_color": "chartreuse",
                "colors": ["chartreuse"],
                "pattern": "swirly",
            },
            headers=auth_headers,
        )
        assert response.status_code == 201, response.text
        item = response.json()
        assert item["primary_color"] is None
        assert item["pattern"] is None

    async def test_new_item_is_matchable_afterwards(
        self, client: AsyncClient, db_session, test_user, auth_headers, fake_ai
    ):
        created = await client.post(
            "/api/v1/selfie/items",
            json={"type": "hoodie", "primary_color": "navy", "pattern": "solid"},
            headers=auth_headers,
        )
        assert created.status_code == 201
        fake_ai(SELFIE_ANSWER)
        response = await client.post(
            "/api/v1/selfie/analyze",
            files={"image": ("selfie.jpg", _image_bytes(), "image/jpeg")},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["garments"][0]["match"]["id"] == created.json()["id"]


@pytest.mark.asyncio
async def test_worn_today_uses_the_existing_studio_endpoint(
    client: AsyncClient, db_session, test_user, auth_headers
):
    """The result screen logs the look through /outfits/studio; no new writer."""
    item = await _store_item(db_session, test_user, type="hoodie", primary_color="navy")
    response = await client.post(
        "/api/v1/outfits/studio",
        json={
            "items": [str(item.id)],
            "occasion": "casual",
            "mark_worn": True,
            "scheduled_for": date.today().isoformat(),
        },
        headers=auth_headers,
    )
    assert response.status_code == 201, response.text
    assert len(response.json()["items"]) == 1
