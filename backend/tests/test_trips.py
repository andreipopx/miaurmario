"""«Modo viaje»: plan a trip's looks and suitcase."""

import json
from datetime import date, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.item import ClothingItem, ItemStatus
from app.models.trip import Trip
from app.services.ai_service import AIDisabledError
from app.services.trip_service import parse_trip_answer, plan_trip
from app.services.weather_service import WeatherData

FAR = date.today() + timedelta(days=60)


def _item(user_id, type_, color="black", name=None):
    return ClothingItem(
        user_id=user_id,
        type=type_,
        primary_color=color,
        colors=[color],
        status=ItemStatus.ready,
        image_path=f"x/{uuid4()}.jpg",
        name=name,
    )


async def _wardrobe(db, user):
    items = [
        _item(user.id, "t-shirt", "white"),
        _item(user.id, "shirt", "blue"),
        _item(user.id, "sweater", "gray"),
        _item(user.id, "jeans", "blue"),
        _item(user.id, "sneakers", "white"),
        _item(user.id, "coat", "beige"),
    ]
    db.add_all(items)
    await db.commit()
    return items


async def _trip(db, user, days=3, start=FAR) -> Trip:
    trip = Trip(
        user_id=user.id,
        destination="Lisboa",
        country="Portugal",
        latitude=38.72,
        longitude=-9.14,
        start_date=start,
        end_date=start + timedelta(days=days - 1),
        plans="cena el sábado",
    )
    db.add(trip)
    await db.commit()
    return trip


class TestParse:
    def test_valid_days_and_extras(self):
        a, b, c = uuid4(), uuid4(), uuid4()
        d0 = FAR
        raw = json.dumps(
            {
                "days": [
                    {"date": d0.isoformat(), "items": [1, 2, 3, 99], "note": " Fresco  y cómodo "},
                    {"date": "2099-01-01", "items": [1, 2]},  # not a trip day
                    {"date": (d0 + timedelta(days=1)).isoformat(), "items": [1]},  # not a look
                ],
                "extras": ["paraguas plegable", "", 3, "bañador"],
            }
        )
        plan, extras = parse_trip_answer(
            "Claro: " + raw, [d0, d0 + timedelta(days=1)], {1: a, 2: b, 3: c}
        )
        assert plan == {d0: ([a, b, c], "Fresco y cómodo")}
        assert extras == ["paraguas plegable", "bañador"]

    def test_garbage(self):
        assert parse_trip_answer("nope", [FAR], {}) == ({}, [])


class TestPlan:
    async def test_without_ai_every_day_gets_a_look_and_the_suitcase_is_light(
        self, db_session, test_user
    ):
        items = await _wardrobe(db_session, test_user)
        trip = await _trip(db_session, test_user, days=4)
        with (
            patch(
                "app.services.trip_service.require_ai_client",
                AsyncMock(side_effect=AIDisabledError("off")),
            ),
            patch("app.services.trip_service._forecasts", AsyncMock(return_value={})),
        ):
            await plan_trip(db_session, trip)
        assert trip.status == "ready" and trip.engine == "heuristic"
        assert [d["date"] for d in trip.days] == [
            (FAR + timedelta(days=i)).isoformat() for i in range(4)
        ]
        assert all(len(d["item_ids"]) >= 2 for d in trip.days)
        # one pair of jeans in the wardrobe: reused, so the suitcase is smaller than 4 looks
        wardrobe_ids = {str(i.id) for i in items}
        packed = [p["item_id"] for p in trip.packing]
        assert set(packed) <= wardrobe_ids and len(packed) == len(set(packed))
        assert len(packed) < sum(len(d["item_ids"]) for d in trip.days)

    async def test_ai_plans_the_whole_trip_in_one_call(self, db_session, test_user):
        items = await _wardrobe(db_session, test_user)
        trip = await _trip(db_session, test_user, days=2)
        n = {
            i.id: k
            for k, i in enumerate(sorted(items, key=lambda x: x.created_at, reverse=True), 1)
        }
        ai = MagicMock()
        rain = WeatherData(
            temperature=12,
            feels_like=15,
            humidity=50,
            precipitation_chance=80,
            precipitation_mm=0,
            wind_speed=0,
            condition="rainy",
            condition_code=61,
            is_day=True,
            uv_index=0,
            timestamp=datetime.utcnow(),
        )

        async def answer(prompt, system_prompt=None):
            assert "Lisboa" in prompt and "cena el sábado" in prompt and "lluvia 80%" in prompt
            ids = list(n.values())
            return json.dumps(
                {
                    "days": [
                        {"date": FAR.isoformat(), "items": ids[:3], "note": "Para la lluvia"},
                        {"date": (FAR + timedelta(days=1)).isoformat(), "items": ids[1:4]},
                    ],
                    "extras": ["paraguas plegable"],
                }
            )

        ai.generate_text = answer
        with (
            patch("app.services.trip_service.require_ai_client", AsyncMock(return_value=ai)),
            patch("app.services.trip_service._forecasts", AsyncMock(return_value={FAR: rain})),
        ):
            await plan_trip(db_session, trip)
        assert trip.engine == "ai"
        assert trip.days[0]["note"] == "Para la lluvia"
        assert trip.days[0]["weather"]["temperature"] == 12
        assert trip.days[1]["weather"] is None  # beyond the forecast
        assert trip.extras == ["paraguas plegable"]
        assert len(trip.packing) == 4  # 3 + 3 with two shared

    async def test_an_empty_wardrobe_is_an_error_not_a_crash(self, db_session, test_user):
        trip = await _trip(db_session, test_user)
        await plan_trip(db_session, trip)
        assert (trip.status, trip.error) == ("error", "wardrobe_too_small")


@pytest.fixture
def no_queue():
    redis = MagicMock()
    redis.enqueue_job = AsyncMock()
    redis.aclose = AsyncMock()
    with (
        patch("app.api.trips.create_pool", AsyncMock(return_value=redis)),
        patch("app.api.trips.rate_limit_by_user", AsyncMock()),
    ):
        yield redis


class TestAPI:
    def _body(self, start=FAR, days=3, **over):
        return {
            "destination": "  Lisboa ",
            "country": "Portugal",
            "latitude": 38.72,
            "longitude": -9.14,
            "start_date": start.isoformat(),
            "end_date": (start + timedelta(days=days - 1)).isoformat(),
            "plans": "boda el sábado",
            **over,
        }

    async def test_create_queues_the_plan_and_packs(
        self, client: AsyncClient, auth_headers, db_session, test_user, no_queue
    ):
        resp = await client.post("/api/v1/trips", json=self._body(), headers=auth_headers)
        assert resp.status_code == 201, resp.text
        trip = resp.json()
        assert trip["destination"] == "Lisboa" and trip["status"] == "planning"
        no_queue.enqueue_job.assert_awaited_once()
        assert no_queue.enqueue_job.await_args.args == ("plan_trip_job", trip["id"])

        # once planned, packing toggles one garment at a time
        item = _item(test_user.id, "jeans")
        db_session.add(item)
        await db_session.commit()
        row = await db_session.get(Trip, trip["id"])
        row.packing = [{"item_id": str(item.id), "packed": False}]
        row.status = "ready"
        await db_session.commit()
        resp = await client.patch(
            f"/api/v1/trips/{trip['id']}/packing",
            json={"item_id": str(item.id), "packed": True},
            headers=auth_headers,
        )
        assert resp.json()["packed"] == 1
        detail = (await client.get(f"/api/v1/trips/{trip['id']}", headers=auth_headers)).json()
        assert detail["items"][0]["id"] == str(item.id)

        listing = (await client.get("/api/v1/trips", headers=auth_headers)).json()
        assert [t["id"] for t in listing["upcoming"]] == [trip["id"]]

        assert (
            await client.delete(f"/api/v1/trips/{trip['id']}", headers=auth_headers)
        ).status_code == 204
        assert (
            await db_session.execute(select(Trip).where(Trip.user_id == test_user.id))
        ).all() == []

    @pytest.mark.parametrize(
        "over",
        [
            {"end_date": (FAR - timedelta(days=1)).isoformat()},
            {"end_date": (FAR + timedelta(days=14)).isoformat()},  # 15 days
            {"latitude": 123},
        ],
    )
    async def test_rejects_bad_trips(self, client: AsyncClient, auth_headers, no_queue, over):
        resp = await client.post("/api/v1/trips", json=self._body(**over), headers=auth_headers)
        assert resp.status_code == 422

    async def test_rejects_a_trip_already_over(self, client: AsyncClient, auth_headers, no_queue):
        past = date.today() - timedelta(days=10)
        resp = await client.post("/api/v1/trips", json=self._body(start=past), headers=auth_headers)
        assert resp.status_code == 422

    async def test_someone_elses_trip_is_not_found(
        self, client: AsyncClient, auth_headers, db_session, no_queue
    ):
        from app.models.user import User

        other = User(
            id=uuid4(), external_id=f"o-{uuid4()}", email=f"o-{uuid4()}@x.es", display_name="O"
        )
        db_session.add(other)
        await db_session.commit()
        trip = await _trip(db_session, other)
        for method, url in (
            ("get", f"/api/v1/trips/{trip.id}"),
            ("post", f"/api/v1/trips/{trip.id}/plan"),
            ("delete", f"/api/v1/trips/{trip.id}"),
        ):
            resp = await getattr(client, method)(url, headers=auth_headers)
            assert resp.status_code == 404
