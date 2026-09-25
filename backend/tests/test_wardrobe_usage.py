"""Usage maths, co-wear, «Rescátala» and the per-garment usage preference.

The promise these tests hold the code to:

* the numbers are honest — a wardrobe too new to say anything says so, and a
  cost-per-use with no price or no wears is None rather than a made-up figure;
* co-wear only counts looks the user confirmed as worn;
* a rescue produces a look with the garment in it, with the AI stylist or with
  the heuristic composer;
* «déjala tranquila» stops the nudging without ever hiding a garment.
"""

from datetime import date, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from app.models.item import ClothingItem, ItemHistory, ItemStatus
from app.models.outfit import Outfit, OutfitItem, OutfitStatus, UserFeedback
from app.models.preference import UserPreference
from app.services.item_rescue import ItemRescueService
from app.services.item_scorer import USAGE_PREFERENCE_BOOST, _usage_score, score_items
from app.services.recommendation_service import AIRecommendationError
from app.services.wardrobe_usage import (
    IDLE_DAYS,
    LONG_IDLE_DAYS,
    MIN_TRACKING_DAYS,
    cost_per_wear,
    item_usage,
    wardrobe_usage,
    worn_together,
)
from app.services.weather_service import WeatherData

TODAY = date(2026, 9, 25)


def _scorer_item(**kwargs) -> ClothingItem:
    defaults = {
        "id": uuid4(),
        "user_id": uuid4(),
        "type": "shirt",
        "image_path": "test.jpg",
        "colors": [],
        "style": [],
        "season": [],
        "formality": "casual",
        "needs_wash": False,
        "is_archived": False,
        "wear_count": 0,
    }
    defaults.update(kwargs)
    return ClothingItem(**defaults)


def _weather(temp=20) -> WeatherData:
    return WeatherData(
        temperature=temp,
        feels_like=temp,
        humidity=50,
        precipitation_chance=0,
        precipitation_mm=0,
        wind_speed=10,
        condition="clear",
        condition_code=0,
        is_day=True,
        uv_index=5,
        timestamp=datetime(2026, 9, 25, 12, 0),
    )


async def _add_item(db_session, user, **kwargs) -> ClothingItem:
    defaults = {
        "user_id": user.id,
        "type": "shirt",
        "image_path": f"test/{uuid4()}.jpg",
        "status": ItemStatus.ready,
        "primary_color": "blue",
        "colors": ["blue"],
        "formality": "casual",
    }
    defaults.update(kwargs)
    item = ClothingItem(**defaults)
    db_session.add(item)
    await db_session.commit()
    # No refresh(): it would drop the eager-load options the API relies on for
    # this same identity-mapped instance.
    return item


async def _age_items(db_session, user, days: int) -> None:
    """Backdate every garment's ``created_at`` so the wardrobe reads as lived-in."""
    from sqlalchemy import update

    await db_session.execute(
        update(ClothingItem)
        .where(ClothingItem.user_id == user.id)
        .values(created_at=datetime(2026, 9, 25) - timedelta(days=days))
    )
    await db_session.commit()


async def _worn_look(db_session, user, items, worn_at: date | None = TODAY) -> Outfit:
    """An outfit, marked worn when ``worn_at`` is given and merely accepted when not."""
    outfit = Outfit(
        user_id=user.id,
        occasion="casual",
        status=OutfitStatus.accepted,
        scheduled_for=worn_at or TODAY,
    )
    db_session.add(outfit)
    await db_session.flush()
    for position, item in enumerate(items):
        db_session.add(OutfitItem(outfit_id=outfit.id, item_id=item.id, position=position))
    db_session.add(UserFeedback(outfit_id=outfit.id, accepted=True, worn_at=worn_at))
    await db_session.commit()
    return outfit


# --- Cost per use ----------------------------------------------------------------


class TestCostPerWear:
    def test_no_price_means_no_figure(self):
        assert cost_per_wear(None, 10) is None

    def test_never_worn_has_no_cost_per_use(self):
        # "Aún sin estrenar" is the honest answer; dividing by zero is not.
        assert cost_per_wear(Decimal("49.90"), 0) is None

    def test_a_free_or_zero_price_garment_is_not_a_figure_either(self):
        assert cost_per_wear(Decimal("0"), 5) is None

    def test_divides_price_by_wears_to_the_cent(self):
        assert cost_per_wear(Decimal("49.90"), 4) == Decimal("12.48")
        assert cost_per_wear(Decimal("30"), 3) == Decimal("10.00")

    def test_one_wear_costs_the_whole_price(self):
        assert cost_per_wear(Decimal("120.00"), 1) == Decimal("120.00")


# --- Wardrobe in numbers ---------------------------------------------------------


@pytest.mark.asyncio
class TestWardrobeUsage:
    async def test_empty_wardrobe_says_nothing_rather_than_zero_percent(
        self, db_session, test_user
    ):
        usage = await wardrobe_usage(db_session, test_user.id, TODAY)
        assert usage.tracked_items == 0
        assert usage.idle_percentage == 0.0
        assert usage.enough_data is False

    async def test_a_brand_new_wardrobe_is_not_enough_data(self, db_session, test_user):
        await _add_item(db_session, test_user, wear_count=3, last_worn_at=TODAY)
        usage = await wardrobe_usage(db_session, test_user.id, TODAY)
        assert usage.tracking_days < MIN_TRACKING_DAYS
        assert usage.enough_data is False

    async def test_counts_never_worn_and_the_three_and_six_month_marks(self, db_session, test_user):
        await _add_item(db_session, test_user, type="shirt")  # never worn
        await _add_item(db_session, test_user, type="pants", wear_count=1, last_worn_at=TODAY)
        await _add_item(
            db_session,
            test_user,
            type="jeans",
            wear_count=2,
            last_worn_at=TODAY - timedelta(days=IDLE_DAYS + 1),
        )
        await _add_item(
            db_session,
            test_user,
            type="coat",
            wear_count=1,
            last_worn_at=TODAY - timedelta(days=LONG_IDLE_DAYS + 1),
        )
        await _age_items(db_session, test_user, days=400)

        usage = await wardrobe_usage(db_session, test_user.id, TODAY)
        assert usage.tracked_items == 4
        assert usage.never_worn == 1
        # Never worn + past three months + past six months.
        assert usage.idle_3m == 3
        assert usage.idle_6m == 2
        assert usage.worn_recently == 1
        assert usage.idle_percentage == 75.0
        assert usage.total_wears == 4
        assert usage.enough_data is True

    async def test_archived_and_unready_garments_are_not_counted(self, db_session, test_user):
        await _add_item(db_session, test_user, wear_count=1, last_worn_at=TODAY)
        await _add_item(db_session, test_user, is_archived=True, status=ItemStatus.archived)
        await _add_item(db_session, test_user, status=ItemStatus.processing)
        await _age_items(db_session, test_user, days=400)

        usage = await wardrobe_usage(db_session, test_user.id, TODAY)
        assert usage.tracked_items == 1
        assert usage.never_worn == 0

    async def test_analytics_endpoint_carries_the_numbers_and_the_thresholds(
        self, client, test_user, auth_headers, db_session
    ):
        await _add_item(db_session, test_user, wear_count=2, last_worn_at=TODAY)
        response = await client.get("/api/v1/analytics", headers=auth_headers)
        assert response.status_code == 200, response.text
        usage = response.json()["usage"]
        assert usage["tracked_items"] == 1
        assert usage["idle_days"] == IDLE_DAYS
        assert usage["long_idle_days"] == LONG_IDLE_DAYS
        assert usage["min_tracking_days"] == MIN_TRACKING_DAYS

    async def test_a_thin_wardrobe_gets_the_honest_insight_not_a_conclusion(
        self, client, test_user, auth_headers, db_session
    ):
        await _add_item(db_session, test_user, wear_count=1, last_worn_at=TODAY)
        response = await client.get("/api/v1/analytics", headers=auth_headers)
        body = response.json()
        assert body["usage"]["enough_data"] is False
        assert any("dos semanas" in line for line in body["insights"])

    async def test_no_insight_tells_the_owner_to_buy_anything(
        self, client, test_user, auth_headers, db_session
    ):
        for item_type in ("shirt", "blouse", "t-shirt", "top", "pants"):
            await _add_item(db_session, test_user, type=item_type, wear_count=1, last_worn_at=TODAY)
        await _age_items(db_session, test_user, days=400)
        response = await client.get("/api/v1/analytics", headers=auth_headers)
        text = " ".join(response.json()["insights"]).lower()
        for nudge in ("compra", "comprar", "considera añadir", "invierte", "hazte con"):
            assert nudge not in text, text


# --- Co-wear ---------------------------------------------------------------------


@pytest.mark.asyncio
class TestWornTogether:
    async def test_nothing_worn_yet_means_no_claim_at_all(self, db_session, test_user):
        shirt = await _add_item(db_session, test_user, type="shirt")
        co_worn, looks = await worn_together(db_session, shirt)
        assert co_worn == []
        assert looks == 0

    async def test_only_looks_the_owner_confirmed_as_worn_count(self, db_session, test_user):
        shirt = await _add_item(db_session, test_user, type="shirt")
        jeans = await _add_item(db_session, test_user, type="jeans")
        boots = await _add_item(db_session, test_user, type="boots")
        # Accepted but never confirmed as worn: not evidence of anything.
        await _worn_look(db_session, test_user, [shirt, boots], worn_at=None)
        await _worn_look(db_session, test_user, [shirt, jeans])

        co_worn, looks = await worn_together(db_session, shirt)
        assert looks == 1
        assert [c.id for c in co_worn] == [jeans.id]
        assert co_worn[0].times == 1

    async def test_the_most_frequent_partner_comes_first(self, db_session, test_user):
        shirt = await _add_item(db_session, test_user, type="shirt")
        jeans = await _add_item(db_session, test_user, type="jeans")
        chinos = await _add_item(db_session, test_user, type="pants")
        await _worn_look(db_session, test_user, [shirt, jeans])
        await _worn_look(db_session, test_user, [shirt, jeans], worn_at=TODAY - timedelta(days=1))
        await _worn_look(db_session, test_user, [shirt, chinos], worn_at=TODAY - timedelta(days=2))

        co_worn, looks = await worn_together(db_session, shirt)
        assert looks == 3
        assert [(c.id, c.times) for c in co_worn] == [(jeans.id, 2), (chinos.id, 1)]

    async def test_a_garment_is_never_its_own_partner(self, db_session, test_user):
        shirt = await _add_item(db_session, test_user, type="shirt")
        jeans = await _add_item(db_session, test_user, type="jeans")
        await _worn_look(db_session, test_user, [shirt, jeans])
        co_worn, _ = await worn_together(db_session, shirt)
        assert shirt.id not in {c.id for c in co_worn}

    async def test_another_users_look_is_not_counted(self, db_session, test_user):
        from app.models.user import User

        stranger = User(
            external_id=f"other-{uuid4()}",
            email=f"other-{uuid4()}@example.com",
            display_name="Other",
            timezone="UTC",
            is_active=True,
        )
        db_session.add(stranger)
        await db_session.commit()

        shirt = await _add_item(db_session, test_user, type="shirt")
        theirs = await _add_item(db_session, stranger, type="jeans")
        # A look filed under the stranger holding both garments.
        await _worn_look(db_session, stranger, [shirt, theirs])

        co_worn, looks = await worn_together(db_session, shirt)
        assert looks == 0
        assert co_worn == []


@pytest.mark.asyncio
class TestItemUsage:
    async def test_the_endpoint_reports_wears_cost_per_use_and_partners(
        self, client, test_user, auth_headers, db_session
    ):
        shirt = await _add_item(
            db_session,
            test_user,
            type="shirt",
            wear_count=4,
            last_worn_at=TODAY - timedelta(days=2),
            purchase_price=Decimal("49.90"),
        )
        jeans = await _add_item(db_session, test_user, type="jeans")
        await _worn_look(db_session, test_user, [shirt, jeans])

        response = await client.get(f"/api/v1/items/{shirt.id}/usage", headers=auth_headers)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["wear_count"] == 4
        assert Decimal(body["cost_per_wear"]) == Decimal("12.48")
        assert body["usage_preference"] == "normal"
        assert [c["id"] for c in body["co_worn"]] == [str(jeans.id)]
        assert body["co_worn_looks"] == 1

    async def test_an_unworn_garment_has_no_cost_per_use(self, db_session, test_user):
        shirt = await _add_item(db_session, test_user, purchase_price=Decimal("80.00"))
        usage = await item_usage(db_session, shirt, TODAY)
        assert usage.wear_count == 0
        assert usage.cost_per_wear is None
        assert usage.days_since_last_worn is None

    async def test_days_since_last_worn_is_counted_in_the_owners_today(self, db_session, test_user):
        shirt = await _add_item(
            db_session, test_user, wear_count=1, last_worn_at=TODAY - timedelta(days=12)
        )
        usage = await item_usage(db_session, shirt, TODAY)
        assert usage.days_since_last_worn == 12

    async def test_another_users_garment_is_not_readable(
        self, client, auth_headers, db_session, test_user
    ):
        from app.models.user import User

        stranger = User(
            external_id=f"other-{uuid4()}",
            email=f"other-{uuid4()}@example.com",
            display_name="Other",
            timezone="UTC",
            is_active=True,
        )
        db_session.add(stranger)
        await db_session.commit()
        theirs = await _add_item(db_session, stranger)

        response = await client.get(f"/api/v1/items/{theirs.id}/usage", headers=auth_headers)
        assert response.status_code == 404


# --- The per-garment setting and the scorer --------------------------------------


class TestUsagePreferenceScore:
    def test_the_default_leaves_the_median_nudge_in_charge(self):
        forgotten = _scorer_item(wear_count=1)
        favourite = _scorer_item(wear_count=20)
        assert _usage_score(forgotten, median_wear=10) == 1.15
        assert _usage_score(favourite, median_wear=10) == 0.9

    def test_sacala_mas_boosts_harder_than_the_median_nudge_ever_does(self):
        item = _scorer_item(wear_count=20, usage_preference="more")
        assert _usage_score(item, median_wear=10) == USAGE_PREFERENCE_BOOST
        assert USAGE_PREFERENCE_BOOST > 1.15

    def test_dejala_tranquila_stops_the_nudge_in_both_directions(self):
        forgotten = _scorer_item(wear_count=0, usage_preference="rest")
        favourite = _scorer_item(wear_count=99, usage_preference="rest")
        assert _usage_score(forgotten, median_wear=10) == 1.0
        assert _usage_score(favourite, median_wear=10) == 1.0

    def test_no_setting_ever_zeroes_an_item_out_of_the_suggestions(self):
        for preference in ("more", "normal", "rest"):
            item = _scorer_item(wear_count=50, usage_preference=preference)
            assert _usage_score(item, median_wear=1000) > 0

    def test_the_per_garment_setting_outranks_the_wardrobe_wide_switch(self):
        item = _scorer_item(wear_count=5, usage_preference="more")
        assert _usage_score(item, median_wear=5, use_median=False) == USAGE_PREFERENCE_BOOST
        plain = _scorer_item(wear_count=0)
        assert _usage_score(plain, median_wear=10, use_median=False) == 1.0

    def test_score_items_ranks_a_boosted_garment_above_its_identical_twin(self):
        # Two garments alike in everything but the owner's instruction.
        items = [
            _scorer_item(type="shirt", wear_count=5, usage_preference="normal"),
            _scorer_item(type="shirt", wear_count=5, usage_preference="more"),
        ]
        # Filler so the scorer actually scores instead of deferring to the AI.
        items += [_scorer_item(type="shirt", wear_count=5) for _ in range(60)]
        boosted = items[1].id

        scored = score_items(
            items=items,
            weather=_weather(),
            occasion="casual",
            preferences=None,
            user_today=TODAY,
            current_season="fall",
            learned_prefs=None,
            good_pairs={},
            recently_worn_dates={},
        )
        assert scored[0].item.id == boosted
        assert scored[0].usage_score == USAGE_PREFERENCE_BOOST

    def test_a_rested_garment_still_appears_in_the_ranking(self):
        rested = _scorer_item(type="shirt", wear_count=0, usage_preference="rest")
        items = [rested] + [_scorer_item(type="shirt", wear_count=5) for _ in range(60)]
        scored = score_items(
            items=items,
            weather=_weather(),
            occasion="casual",
            preferences=None,
            user_today=TODAY,
            current_season="fall",
            learned_prefs=None,
            good_pairs={},
            recently_worn_dates={},
        )
        assert rested.id in {s.item.id for s in scored}

    def test_a_rested_garment_is_not_penalised_when_underused_nudging_is_off(self):
        prefs = UserPreference(user_id=uuid4(), prefer_underused_items=False)
        items = [
            _scorer_item(type="shirt", wear_count=0, usage_preference="rest"),
            _scorer_item(type="shirt", wear_count=0),
        ]
        items += [_scorer_item(type="shirt", wear_count=5) for _ in range(60)]
        scored = score_items(
            items=items,
            weather=_weather(),
            occasion="casual",
            preferences=prefs,
            user_today=TODAY,
            current_season="fall",
            learned_prefs=None,
            good_pairs={},
            recently_worn_dates={},
        )
        assert {s.usage_score for s in scored} == {1.0}


@pytest.mark.asyncio
class TestUsagePreferenceApi:
    async def test_the_setting_is_saved_and_read_back(
        self, client, test_user, auth_headers, db_session
    ):
        item = await _add_item(db_session, test_user)
        response = await client.patch(
            f"/api/v1/items/{item.id}",
            json={"usage_preference": "rest"},
            headers=auth_headers,
        )
        assert response.status_code == 200, response.text
        assert response.json()["usage_preference"] == "rest"

        read = await client.get(f"/api/v1/items/{item.id}", headers=auth_headers)
        assert read.json()["usage_preference"] == "rest"

    async def test_an_unknown_setting_is_refused(self, client, test_user, auth_headers, db_session):
        item = await _add_item(db_session, test_user)
        response = await client.patch(
            f"/api/v1/items/{item.id}",
            json={"usage_preference": "burn_it"},
            headers=auth_headers,
        )
        assert response.status_code == 422

    async def test_a_null_setting_falls_back_to_normal_rather_than_breaking(
        self, client, test_user, auth_headers, db_session
    ):
        item = await _add_item(db_session, test_user, usage_preference="more")
        response = await client.patch(
            f"/api/v1/items/{item.id}",
            json={"usage_preference": None},
            headers=auth_headers,
        )
        assert response.status_code == 200, response.text
        assert response.json()["usage_preference"] == "normal"

    async def test_a_new_garment_defaults_to_normal(self, db_session, test_user):
        item = await _add_item(db_session, test_user)
        assert item.usage_preference == "normal"


# --- «Rescátala» -----------------------------------------------------------------


@pytest.mark.asyncio
class TestRescue:
    async def _wardrobe(self, db_session, user) -> ClothingItem:
        """A wardrobe with one forgotten shirt and enough around it to dress."""
        forgotten = await _add_item(
            db_session, user, type="shirt", primary_color="green", colors=["green"]
        )
        await _add_item(db_session, user, type="jeans", primary_color="blue", colors=["blue"])
        await _add_item(db_session, user, type="sneakers", primary_color="white", colors=["white"])
        return forgotten

    async def test_without_ai_the_heuristic_composer_builds_a_look_with_the_garment(
        self, client, test_user, auth_headers, db_session
    ):
        forgotten = await self._wardrobe(db_session, test_user)
        # test_user has no AI access, so the AI guard refuses and the composer answers.
        response = await client.post(
            "/api/v1/outfits/rescue",
            json={"item_id": str(forgotten.id), "occasion": "casual"},
            headers=auth_headers,
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["rescued"] is True
        assert body["engine"] == "heuristic"
        assert str(forgotten.id) in [i["id"] for i in body["outfit"]["items"]]

    async def test_with_ai_the_stylist_answers_and_the_garment_is_pinned(
        self, client, test_user, auth_headers, db_session
    ):
        forgotten = await self._wardrobe(db_session, test_user)

        captured: dict = {}

        async def fake_generate(self, **kwargs):
            captured.update(kwargs)
            # Stand in for a real stylist answer with the pinned garment in it.
            outfit = Outfit(
                user_id=kwargs["user"].id,
                occasion=kwargs["occasion"],
                status=OutfitStatus.pending,
                scheduled_for=TODAY,
            )
            db_session.add(outfit)
            await db_session.flush()
            db_session.add(OutfitItem(outfit_id=outfit.id, item_id=forgotten.id, position=0))
            await db_session.commit()
            return await ItemRescueService(db_session)._reload(outfit)

        with patch(
            "app.services.item_rescue.RecommendationService.generate_recommendation",
            new=fake_generate,
        ):
            response = await client.post(
                "/api/v1/outfits/rescue",
                json={"item_id": str(forgotten.id), "occasion": "work"},
                headers=auth_headers,
            )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["engine"] == "ai"
        assert captured["include_items"] == [forgotten.id]
        assert captured["occasion"] == "work"
        assert str(forgotten.id) in [i["id"] for i in body["outfit"]["items"]]

    async def test_a_failing_stylist_falls_back_to_the_composer(
        self, client, test_user, auth_headers, db_session
    ):
        forgotten = await self._wardrobe(db_session, test_user)
        with patch(
            "app.services.item_rescue.RecommendationService.generate_recommendation",
            new_callable=AsyncMock,
            side_effect=AIRecommendationError("provider down"),
        ):
            response = await client.post(
                "/api/v1/outfits/rescue",
                json={"item_id": str(forgotten.id)},
                headers=auth_headers,
            )
        assert response.status_code == 200, response.text
        assert response.json()["engine"] == "heuristic"

    async def test_a_lone_garment_is_refused_plainly_with_a_reason(
        self, client, test_user, auth_headers, db_session
    ):
        lonely = await _add_item(
            db_session, test_user, type="shirt", primary_color="green", colors=["green"]
        )
        response = await client.post(
            "/api/v1/outfits/rescue",
            json={"item_id": str(lonely.id)},
            headers=auth_headers,
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["rescued"] is False
        assert body["reason"] == "no_combination"
        assert body["outfit"] is None
        assert [h["code"] for h in body["hints"]] == ["too_few_items"]

    async def test_the_only_green_piece_is_told_it_is_the_only_green_piece(
        self, db_session, test_user
    ):
        green = await _add_item(
            db_session, test_user, type="shirt", primary_color="green", colors=["green"]
        )
        await _add_item(db_session, test_user, type="jeans", primary_color="blue", colors=["blue"])
        await _add_item(
            db_session, test_user, type="sneakers", primary_color="white", colors=["white"]
        )
        hints = await ItemRescueService(db_session).diagnose(test_user, green)
        assert ("only_color", "green") in [(h.code, h.value) for h in hints]

    async def test_nothing_to_pair_with_names_the_missing_half(self, db_session, test_user):
        shirt = await _add_item(db_session, test_user, type="shirt")
        await _add_item(db_session, test_user, type="blouse")
        await _add_item(db_session, test_user, type="t-shirt")
        hints = await ItemRescueService(db_session).diagnose(test_user, shirt)
        assert ("missing_role", "bottom") in [(h.code, h.value) for h in hints]

    async def test_everything_in_the_laundry_basket_says_so(self, db_session, test_user):
        shirt = await _add_item(db_session, test_user, type="shirt")
        await _add_item(db_session, test_user, type="jeans", needs_wash=True)
        await _add_item(db_session, test_user, type="sneakers", needs_wash=True)
        hints = await ItemRescueService(db_session).diagnose(test_user, shirt)
        assert [h.code for h in hints] == ["all_need_wash"]

    async def test_an_archived_garment_is_not_rescued(
        self, client, test_user, auth_headers, db_session
    ):
        archived = await _add_item(
            db_session, test_user, is_archived=True, status=ItemStatus.archived
        )
        response = await client.post(
            "/api/v1/outfits/rescue",
            json={"item_id": str(archived.id)},
            headers=auth_headers,
        )
        assert response.status_code == 200, response.text
        assert response.json()["reason"] == "item_unavailable"

    async def test_an_unknown_garment_is_a_coded_404(self, client, test_user, auth_headers):
        response = await client.post(
            "/api/v1/outfits/rescue",
            json={"item_id": str(uuid4())},
            headers=auth_headers,
        )
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "item_not_found"

    async def test_a_rescued_garment_past_its_wash_interval_is_still_rescued(
        self, client, test_user, auth_headers, db_session
    ):
        # The garment being rescued is the point of the call; the wash filter that
        # hides it from ordinary suggestions must not hide it from here.
        forgotten = await _add_item(db_session, test_user, type="shirt", needs_wash=True)
        await _add_item(db_session, test_user, type="jeans")
        await _add_item(db_session, test_user, type="sneakers")
        response = await client.post(
            "/api/v1/outfits/rescue",
            json={"item_id": str(forgotten.id)},
            headers=auth_headers,
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["rescued"] is True
        assert str(forgotten.id) in [i["id"] for i in body["outfit"]["items"]]

    async def test_a_pinned_dress_is_the_look_rather_than_fighting_a_top(
        self, client, test_user, auth_headers, db_session
    ):
        dress = await _add_item(db_session, test_user, type="dress")
        await _add_item(db_session, test_user, type="shirt")
        await _add_item(db_session, test_user, type="jeans")
        await _add_item(db_session, test_user, type="sneakers")
        response = await client.post(
            "/api/v1/outfits/rescue",
            json={"item_id": str(dress.id)},
            headers=auth_headers,
        )
        assert response.status_code == 200, response.text
        types = [i["type"] for i in response.json()["outfit"]["items"]]
        assert "dress" in types
        assert "shirt" not in types and "jeans" not in types


@pytest.mark.asyncio
class TestWearLogStillFeedsTheNumbers:
    async def test_logging_a_wear_moves_the_garment_out_of_never_worn(
        self, client, test_user, auth_headers, db_session
    ):
        user_id = test_user.id
        item = await _add_item(db_session, test_user)
        before = await wardrobe_usage(db_session, user_id, TODAY)
        assert before.never_worn == 1

        response = await client.post(f"/api/v1/items/{item.id}/wear", json={}, headers=auth_headers)
        assert response.status_code == 200, response.text
        assert response.json()["wear_count"] == 1

        after = await wardrobe_usage(db_session, user_id, TODAY)
        assert after.never_worn == 0
        assert after.total_wears == 1

        # And the wear left a log row, which is what the co-wear query reads.
        from sqlalchemy import func, select

        logged = await db_session.execute(
            select(func.count(ItemHistory.id)).where(ItemHistory.item_id == item.id)
        )
        assert logged.scalar() == 1
