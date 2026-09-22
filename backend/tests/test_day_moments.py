"""Day moments ("Momentos del día"): several looks per day, transitions, no-AI fallback."""

from datetime import UTC, date, datetime, time
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import create_access_token
from app.models import ClothingItem, Outfit, OutfitItem, User
from app.models.item import ItemStatus
from app.models.outfit import OutfitStatus, OutfitVisibility
from app.services.day_moments import NEUTRAL_WEATHER, compose_outfit
from app.services.recommendation_service import (
    MomentSpec,
    format_moment_for_prompt,
    time_of_day_for,
)

API = "/api/v1"


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.external_id)}"}


def _item(user_id, type_: str, formality: str = "casual", name: str | None = None):
    return ClothingItem(
        id=uuid4(),
        user_id=user_id,
        type=type_,
        name=name or type_,
        image_path=f"{user_id}/{uuid4().hex}.jpg",
        status=ItemStatus.ready,
        primary_color="black",
        formality=formality,
        wear_count=0,
        wears_since_wash=0,
        needs_wash=False,
        is_archived=False,
    )


async def _wardrobe(db: AsyncSession, user: User) -> dict[str, ClothingItem]:
    items = {
        "shirt": _item(user.id, "shirt", "smart-casual"),
        "pants": _item(user.id, "pants", "smart-casual"),
        "sneakers": _item(user.id, "sneakers"),
        "boots": _item(user.id, "boots", "smart-casual"),
        "blazer": _item(user.id, "blazer", "business-casual"),
        "jacket": _item(user.id, "jacket", "casual", name="leather jacket"),
        "belt": _item(user.id, "belt", "smart-casual"),
    }
    db.add_all(items.values())
    await db.commit()
    return items


@pytest_asyncio.fixture
async def wardrobe(db_session: AsyncSession, test_user: User) -> dict[str, ClothingItem]:
    return await _wardrobe(db_session, test_user)


# -- Pure helpers ------------------------------------------------------------------


class TestComposeOutfit:
    def _ranked(self, items):
        return [(i, 1.0 - n * 0.01) for n, i in enumerate(items)]

    def test_fresh_look_has_top_bottom_shoes(self):
        uid = uuid4()
        shirt, pants, shoes, dress = (
            _item(uid, "shirt"),
            _item(uid, "pants"),
            _item(uid, "sneakers"),
            _item(uid, "dress"),
        )
        # The dress ranks below the top/bottom pair: separates win.
        composed = compose_outfit(
            self._ranked([shirt, pants, shoes, dress]), NEUTRAL_WEATHER, "casual"
        )
        assert set(composed.item_ids) == {shirt.id, pants.id, shoes.id}

    def test_cold_adds_outer_layer(self):
        uid = uuid4()
        shirt, pants, shoes, coat = (
            _item(uid, "shirt"),
            _item(uid, "pants"),
            _item(uid, "boots"),
            _item(uid, "coat"),
        )
        cold = SimpleNamespace(feels_like=4.0, precipitation_chance=0)
        composed = compose_outfit(self._ranked([shirt, pants, shoes, coat]), cold, "casual")
        assert coat.id in composed.item_ids

    def test_transition_keeps_most_and_swaps_outer_layer(self):
        uid = uuid4()
        shirt, pants, sneakers, blazer = (
            _item(uid, "shirt"),
            _item(uid, "pants"),
            _item(uid, "sneakers"),
            _item(uid, "blazer"),
        )
        jacket, belt = _item(uid, "jacket"), _item(uid, "belt")
        base = [shirt, pants, sneakers, blazer]
        composed = compose_outfit(
            self._ranked([jacket, belt, *base]), NEUTRAL_WEATHER, "date", base=base
        )
        assert composed.removed == [blazer.id]
        assert composed.added == [jacket.id, belt.id]
        assert set(composed.kept) == {shirt.id, pants.id, sneakers.id}
        assert set(composed.item_ids) == {shirt.id, pants.id, sneakers.id, jacket.id, belt.id}

    def test_transition_without_alternatives_keeps_the_look(self):
        uid = uuid4()
        base = [_item(uid, "shirt"), _item(uid, "pants")]
        composed = compose_outfit(self._ranked(base), NEUTRAL_WEATHER, "date", base=base)
        assert composed.item_ids == [i.id for i in base]
        assert composed.added == composed.removed == []


def test_time_of_day_for():
    assert time_of_day_for(None) is None
    assert time_of_day_for(time(8, 0)) == "morning"
    assert time_of_day_for(time(13, 0)) == "afternoon"
    assert time_of_day_for(time(19, 30)) == "evening"
    assert time_of_day_for(time(23, 0)) == "night"


def test_transition_prompt_references_previous_items():
    a, b, c = uuid4(), uuid4(), uuid4()
    base = SimpleNamespace(
        id=uuid4(), items=[SimpleNamespace(item_id=a), SimpleNamespace(item_id=b)]
    )
    spec = MomentSpec(
        order=1, label="Cita", at=time(20, 0), transition_from=base, transition_from_label="Trabajo"
    )
    text = format_moment_for_prompt(spec, {1: c, 2: a, 3: b})
    assert "Cita (20:00)" in text
    assert "TRANSICIÓN" in text and "Trabajo: [2], [3]" in text
    assert format_moment_for_prompt(None, {}) == ""
    assert format_moment_for_prompt(MomentSpec(), {}) == ""


# -- API -----------------------------------------------------------------------------


@pytest.mark.usefixtures("wardrobe")
class TestDayMomentsWithoutAI:
    """test_user has no AI (new users default to 'none'): the heuristic composer answers."""

    async def test_add_moments_and_transition(self, client: AsyncClient, test_user: User):
        h = _headers(test_user)
        r = await client.get(f"{API}/days/today", headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["moments"] == []

        r = await client.post(
            f"{API}/days/today/moments",
            json={"label": "Trabajo", "occasion": "office", "time": "09:00"},
            headers=h,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["engine"] == "heuristic"
        [work] = body["day"]["moments"]
        assert work["order"] == 0 and work["label"] == "Trabajo" and work["time"] == "09:00:00"
        assert work["outfit"]["moment_label"] == "Trabajo"
        assert len(work["outfit"]["items"]) >= 3

        r = await client.post(
            f"{API}/days/today/moments",
            json={"label": "Cita", "occasion": "date", "time": "20:30", "transition": True},
            headers=h,
        )
        assert r.status_code == 200, r.text
        work, date_night = r.json()["day"]["moments"]
        assert date_night["order"] == 1
        assert date_night["transition_from_order"] == 0
        assert date_night["outfit"]["transition_from_outfit_id"] == work["outfit"]["id"]
        work_ids = {i["id"] for i in work["outfit"]["items"]}
        night_ids = {i["id"] for i in date_night["outfit"]["items"]}
        # A transition, not a full change: most pieces stay, one or two change.
        assert len(work_ids & night_ids) >= len(work_ids) - 1
        assert 1 <= len(night_ids - work_ids) <= 2
        assert set(date_night["shared_item_ids"]) == work_ids & night_ids

    async def test_regenerate_moment_skips_previous_look(
        self, client: AsyncClient, db_session: AsyncSession, test_user: User
    ):
        h = _headers(test_user)
        first = (
            await client.post(f"{API}/days/today/moments", json={"label": "Mañana"}, headers=h)
        ).json()
        r = await client.post(f"{API}/days/today/moments", json={"order": 0}, headers=h)
        assert r.status_code == 200, r.text
        [moment] = r.json()["day"]["moments"]
        assert moment["look_count"] == 2
        assert moment["label"] == "Mañana"
        assert moment["outfit"]["id"] == r.json()["outfit_id"] != first["outfit_id"]
        old = await db_session.get(Outfit, UUID(first["outfit_id"]), populate_existing=True)
        assert old.status == OutfitStatus.skipped

    async def test_worn_moment_is_locked_and_counts_shared_pieces_once(
        self, client: AsyncClient, db_session: AsyncSession, test_user: User
    ):
        h = _headers(test_user)
        work = (
            await client.post(
                f"{API}/days/today/moments",
                json={"label": "Trabajo", "occasion": "office"},
                headers=h,
            )
        ).json()
        night = (
            await client.post(
                f"{API}/days/today/moments",
                json={"label": "Noche", "occasion": "date", "transition": True},
                headers=h,
            )
        ).json()
        for oid in (work["outfit_id"], night["outfit_id"]):
            r = await client.post(
                f"{API}/outfits/{oid}/feedback", json={"accepted": True, "worn": True}, headers=h
            )
            assert r.status_code == 200, r.text

        day = (await client.get(f"{API}/days/today", headers=h)).json()
        assert all(m["is_worn"] for m in day["moments"])
        shared = day["moments"][1]["shared_item_ids"]
        assert shared
        items = (
            await db_session.execute(
                select(ClothingItem)
                .where(ClothingItem.user_id == test_user.id)
                .execution_options(populate_existing=True)
            )
        ).scalars()
        wear = {str(i.id): i.wear_count for i in items}
        assert all(wear[i] == 1 for i in shared)

        r = await client.delete(f"{API}/days/today/moments/0", headers=h)
        assert r.status_code == 409
        r = await client.post(f"{API}/days/today/moments", json={"order": 1}, headers=h)
        assert r.status_code == 409

    async def test_delete_moment(self, client: AsyncClient, test_user: User):
        h = _headers(test_user)
        await client.post(f"{API}/days/today/moments", json={"label": "A"}, headers=h)
        await client.post(f"{API}/days/today/moments", json={"label": "B"}, headers=h)
        r = await client.delete(f"{API}/days/today/moments/1", headers=h)
        assert r.status_code == 204
        day = (await client.get(f"{API}/days/today", headers=h)).json()
        assert [m["label"] for m in day["moments"]] == ["A"]
        r = await client.delete(f"{API}/days/today/moments/7", headers=h)
        assert r.status_code == 404

    async def test_validation(self, client: AsyncClient, test_user: User):
        h = _headers(test_user)
        r = await client.post(f"{API}/days/today/moments", json={"occasion": "nope"}, headers=h)
        assert r.status_code == 422
        r = await client.post(f"{API}/days/today/moments", json={"label": "x" * 41}, headers=h)
        assert r.status_code == 422
        r = await client.get(f"{API}/days/not-a-day", headers=h)
        assert r.status_code == 422
        r = await client.get(f"{API}/days/today")
        assert r.status_code in (401, 403)


async def test_legacy_outfits_are_the_default_moment(
    client: AsyncClient, db_session: AsyncSession, test_user: User, wardrobe
):
    """Outfits created before moments existed show up as one unlabeled moment."""
    day = date(2026, 1, 15)
    old = Outfit(
        user_id=test_user.id, occasion="casual", scheduled_for=day, status=OutfitStatus.rejected
    )
    kept = Outfit(
        user_id=test_user.id, occasion="casual", scheduled_for=day, status=OutfitStatus.accepted
    )
    db_session.add_all([old, kept])
    await db_session.flush()
    db_session.add(OutfitItem(outfit_id=kept.id, item_id=wardrobe["shirt"].id, position=0))
    await db_session.commit()

    r = await client.get(f"{API}/days/2026-01-15", headers=_headers(test_user))
    assert r.status_code == 200, r.text
    [moment] = r.json()["moments"]
    assert moment["order"] == 0 and moment["label"] is None
    assert moment["outfit"]["id"] == str(kept.id)
    assert moment["look_count"] == 2

    # The plain outfit endpoints keep working and report the default moment.
    detail = (await client.get(f"{API}/outfits/{kept.id}", headers=_headers(test_user))).json()
    assert detail["moment_order"] == 0 and detail["moment_label"] is None


async def test_ai_transition_prompt_and_moment_fields(
    client: AsyncClient, db_session: AsyncSession, platform_ai_user: User, wardrobe
):
    """With AI, the transition goes in the prompt and the look lands in its moment."""
    h = _headers(platform_ai_user)
    prompts: list[str] = []

    async def fake_generate(prompt, return_metadata=True):
        prompts.append(prompt)
        # Number every item listed in the prompt; answer with the first three.
        return SimpleNamespace(
            content='{"outfits": [{"items": [1, 2, 3], "headline": "Del día a la noche"}]}',
            model="fake",
            endpoint="fake",
        )

    fake_ai = SimpleNamespace(generate_text=fake_generate)
    with (
        patch(
            "app.services.recommendation_service.require_ai_client",
            new=AsyncMock(return_value=fake_ai),
        ),
        patch(
            "app.services.recommendation_service.RecommendationService.resolve_weather",
            new=AsyncMock(return_value=NEUTRAL_WEATHER),
        ),
        patch(
            "app.services.recommendation_service.pop_suggestion", new=AsyncMock(return_value=None)
        ),
        patch("app.services.recommendation_service.push_suggestions", new=AsyncMock()),
    ):
        r = await client.post(
            f"{API}/days/today/moments",
            json={"label": "Trabajo", "occasion": "office"},
            headers=h,
        )
        assert r.status_code == 200, r.text
        assert r.json()["engine"] == "ai"
        r = await client.post(
            f"{API}/days/today/moments",
            json={"label": "Cita", "occasion": "date", "time": "20:00", "transition": True},
            headers=h,
        )
        assert r.status_code == 200, r.text

    assert "TRANSICIÓN" not in prompts[0]
    assert "Este look es para: Trabajo" in prompts[0]
    assert "TRANSICIÓN: viene de su look de Trabajo" in prompts[1]
    assert "Momento del día: evening" in prompts[1]
    body = r.json()
    assert body["engine"] == "ai"
    night = body["day"]["moments"][1]
    assert night["label"] == "Cita" and night["transition_from_order"] == 0
    assert night["outfit"]["reasoning"] == "Del día a la noche"


async def test_ai_failure_falls_back_to_heuristic(
    client: AsyncClient, platform_ai_user: User, wardrobe
):
    from app.services.recommendation_service import AIRecommendationError

    with patch(
        "app.services.recommendation_service.RecommendationService.generate_recommendation",
        new=AsyncMock(side_effect=AIRecommendationError("provider down")),
    ):
        r = await client.post(
            f"{API}/days/today/moments",
            json={"label": "Mañana"},
            headers=_headers(platform_ai_user),
        )
    assert r.status_code == 200, r.text
    assert r.json()["engine"] == "heuristic"


async def test_feed_orders_a_shared_day_by_moment(
    client: AsyncClient, db_session: AsyncSession, wardrobe, test_user: User
):
    """A friend's day with several moments comes as one group, in moment order."""
    uid = uuid4()
    friend = User(
        id=uid,
        external_id=f"friend-{uid}",
        email=f"friend-{uid}@example.com",
        username=f"friend_{uid.hex[:6]}",
        display_name="Friend",
        timezone="UTC",
        is_active=True,
        onboarding_completed=True,
    )
    test_user.username = f"me_{uid.hex[:6]}"
    db_session.add(friend)
    await db_session.commit()
    r = await client.post(
        f"{API}/friends/requests", json={"username": friend.username}, headers=_headers(test_user)
    )
    await client.post(f"{API}/friends/{r.json()['id']}/accept", headers=_headers(friend))

    today = date.today()
    now = datetime.now(UTC)
    night = Outfit(
        user_id=test_user.id,
        occasion="date",
        scheduled_for=today,
        status=OutfitStatus.accepted,
        moment_order=1,
        moment_label="Noche",
        moment_time=time(21, 0),
        visibility=OutfitVisibility.friends,
        shared_at=now,
        responded_at=now,  # accepted before the morning one: moment order still wins
    )
    morning = Outfit(
        user_id=test_user.id,
        occasion="office",
        scheduled_for=today,
        status=OutfitStatus.accepted,
        moment_order=0,
        moment_label="Mañana",
        visibility=OutfitVisibility.friends,
        shared_at=now,
        responded_at=datetime(2099, 1, 1, tzinfo=UTC),
    )
    db_session.add_all([night, morning])
    await db_session.flush()
    for o in (night, morning):
        db_session.add(OutfitItem(outfit_id=o.id, item_id=wardrobe["shirt"].id, position=0))
    await db_session.commit()

    feed = (await client.get(f"{API}/social/feed", headers=_headers(friend))).json()
    [group] = feed["groups"]
    assert [o["moment_label"] for o in group["outfits"]] == ["Mañana", "Noche"]
    assert group["outfits"][1]["moment_time"] == "21:00:00"
