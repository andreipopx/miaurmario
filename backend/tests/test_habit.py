"""Stinky eats looks: meals, levels, the weekly streak and its monthly comodín."""

from datetime import date, timedelta

from httpx import AsyncClient

from app.models.item import ClothingItem, ItemHistory, ItemStatus
from app.models.outfit import Outfit, OutfitSource, OutfitStatus, UserFeedback
from app.services.habit import build_habit, level_for, monday, streaks, unlocked_for

WED = date(2026, 10, 21)  # a Wednesday


def _week(start: date, *offsets: int) -> set[date]:
    return {start + timedelta(days=o) for o in offsets}


class TestLevels:
    def test_thresholds_and_unlocks(self):
        assert [level_for(m) for m in (0, 2, 3, 6, 7, 15, 365, 999)] == [0, 0, 1, 1, 2, 3, 8, 8]
        assert unlocked_for(0) == []
        assert unlocked_for(2) == ["pajarita", "cascabel"]


class TestStreaks:
    def test_nothing_logged_is_no_streak(self):
        assert streaks(set(), WED, 3) == (0, 0, [], True)

    def test_weeks_that_reach_the_goal_chain_and_this_week_counts_once_met(self):
        this = monday(WED)
        days = (
            _week(this - timedelta(weeks=2), 0, 2, 4)
            | _week(this - timedelta(weeks=1), 1, 3, 5)
            | _week(this, 0, 1)
        )
        assert streaks(days, WED, 3)[0] == 2  # this week not met yet: nothing lost
        assert streaks(days | {WED}, WED, 3)[0] == 3

    def test_one_missed_week_a_month_is_covered_by_the_comodin(self):
        this = monday(WED)  # 2026-10-19
        days = (
            _week(this - timedelta(weeks=3), 0, 1, 2)  # Sep 28 week (September)
            | _week(this - timedelta(weeks=2), 0, 1)  # Oct 5: short → comodín (October)
            | _week(this - timedelta(weeks=1), 0, 1, 2)  # Oct 12
        )
        current, best, frozen, left = streaks(days, WED, 3)
        assert current == 3 and best == 3
        assert frozen == [this - timedelta(weeks=2)]
        assert left is False  # October's is spent

    def test_a_second_miss_in_the_same_month_breaks_it(self):
        this = monday(WED)
        days = _week(this - timedelta(weeks=3), 0, 1, 2) | _week(this - timedelta(weeks=1), 0)
        # Oct 5 → comodín, Oct 12 → no comodín left: broken.
        current, best, _, _ = streaks(days, WED, 3)
        assert current == 0 and best == 2


class TestHabit:
    def test_fed_today_week_and_welcome_back(self):
        h = build_habit({WED, WED - timedelta(days=1), WED + timedelta(days=1)}, WED, None)
        assert h.fed_today and h.meals == 2  # tomorrow's look is not a meal yet
        assert h.week_days == [WED - timedelta(days=1), WED]
        assert h.weekly_goal == 3 and not h.week_met
        later = build_habit({WED}, WED + timedelta(days=5), 2)
        assert later.welcome_back and not later.fed_today
        assert build_habit({WED}, WED + timedelta(days=1), 2).welcome_back is False

    def test_level_progress(self):
        days = {WED - timedelta(days=i) for i in range(8)}
        h = build_habit(days, WED, 3)
        assert (h.level, h.level_starts_at, h.next_level_at) == (2, 7, 15)
        assert h.unlocked == ["pajarita", "cascabel"]


async def _wear(db, user, day: date) -> None:
    outfit = Outfit(
        user_id=user.id,
        occasion="casual",
        scheduled_for=day,
        status=OutfitStatus.accepted,
        source=OutfitSource.on_demand,
    )
    db.add(outfit)
    await db.flush()
    db.add(UserFeedback(outfit_id=outfit.id, accepted=True, worn_at=day))


class TestHabitAPI:
    async def test_meals_come_from_looks_and_single_garments(
        self, client: AsyncClient, auth_headers, db_session, test_user
    ):
        from app.utils.timezone import get_user_today

        today = get_user_today(test_user)
        for i in range(3):
            await _wear(db_session, test_user, today - timedelta(days=i))
        await _wear(db_session, test_user, today)  # a second look today: still one meal
        item = ClothingItem(
            user_id=test_user.id, type="shirt", image_path="x.jpg", status=ItemStatus.ready
        )
        db_session.add(item)
        await db_session.flush()
        db_session.add(ItemHistory(item_id=item.id, worn_at=today - timedelta(days=5)))
        await db_session.commit()

        resp = await client.get("/api/v1/habit", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["fed_today"] is True
        assert body["meals"] == 4
        assert body["unlocked"] == ["pajarita"]
        assert body["accessories"]["perlas"] == 5

        locked = await client.patch(
            "/api/v1/habit", json={"accessory": "perlas"}, headers=auth_headers
        )
        assert locked.status_code == 403
        dressed = await client.patch(
            "/api/v1/habit", json={"accessory": "pajarita", "weekly_goal": 4}, headers=auth_headers
        )
        assert dressed.json()["accessory"] == "pajarita"
        assert dressed.json()["weekly_goal"] == 4
        me = await client.get("/api/v1/users/me", headers=auth_headers)
        assert me.json()["stinky_accessory"] == "pajarita"
        off = await client.patch("/api/v1/habit", json={"accessory": ""}, headers=auth_headers)
        assert off.json()["accessory"] is None


class TestWrapped:
    async def test_a_month_of_wardrobe(
        self, client: AsyncClient, auth_headers, db_session, test_user
    ):
        from datetime import UTC, datetime
        from decimal import Decimal

        from app.models.outfit import OutfitItem

        coat = ClothingItem(
            user_id=test_user.id,
            type="coat",
            name="Abrigo camel",
            primary_color="tan",
            image_path="c.jpg",
            status=ItemStatus.ready,
            purchase_price=Decimal("120"),
            wear_count=10,
            last_worn_at=date(2026, 9, 20),
            created_at=datetime(2026, 9, 3, tzinfo=UTC),
            created_via="link",
        )
        jeans = ClothingItem(
            user_id=test_user.id,
            type="jeans",
            primary_color="blue",
            image_path="j.jpg",
            status=ItemStatus.ready,
            purchase_price=Decimal("40"),
            wear_count=2,
            created_at=datetime(2026, 1, 1, tzinfo=UTC),
        )
        db_session.add_all([coat, jeans])
        await db_session.flush()
        for day in (date(2026, 9, 10), date(2026, 9, 20)):
            outfit = Outfit(
                user_id=test_user.id,
                occasion="casual",
                scheduled_for=day,
                status=OutfitStatus.accepted,
                source=OutfitSource.on_demand,
            )
            db_session.add(outfit)
            await db_session.flush()
            db_session.add(OutfitItem(outfit_id=outfit.id, item_id=coat.id, position=0))
            db_session.add(UserFeedback(outfit_id=outfit.id, accepted=True, worn_at=day))
        await db_session.commit()

        resp = await client.get(
            "/api/v1/habit/wrapped", params={"month": "2026-09"}, headers=auth_headers
        )
        assert resp.status_code == 200, resp.text
        w = resp.json()
        assert (w["days_logged"], w["looks_worn"], w["garments_worn"]) == (2, 2, 1)
        assert w["top"][0]["name"] == "Abrigo camel" and w["top"][0]["count"] == 2
        assert w["top"][0]["photo"]["image_url"]
        assert w["top_color"] == "tan"
        assert w["added"] == 1 and w["added_by_way"] == {"link": 1}
        assert w["forgotten_count"] == 1  # the jeans: never worn, older than a month
        assert Decimal(w["wardrobe_value"]) == Decimal("160")
        assert Decimal(w["average_cost_per_wear"]) == Decimal("13.33")  # 160 / 12
        assert w["best_value"]["name"] == "Abrigo camel"
        assert Decimal(w["best_value"]["cost_per_wear"]) == Decimal("12.00")
        future = await client.get(
            "/api/v1/habit/wrapped", params={"month": "2099-01"}, headers=auth_headers
        )
        assert future.status_code == 400
