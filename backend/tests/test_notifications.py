from datetime import time

import pytest
from httpx import AsyncClient

from app.models.schedule import Schedule


class TestSchedules:
    """Tests for notification schedules."""

    @pytest.mark.asyncio
    async def test_list_schedules_empty(self, client: AsyncClient, test_user, auth_headers):
        """Test listing schedules when none exist."""
        response = await client.get("/api/v1/notifications/schedules", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    @pytest.mark.asyncio
    async def test_create_schedule(self, client: AsyncClient, test_user, auth_headers, db_session):
        """Test creating a notification schedule."""
        response = await client.post(
            "/api/v1/notifications/schedules",
            json={
                "day_of_week": 0,  # Monday
                "notification_time": "07:00",
                "occasion": "work",
                "enabled": True,
            },
            headers=auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["day_of_week"] == 0
        assert data["notification_time"] == "07:00"

    @pytest.mark.asyncio
    async def test_update_schedule(self, client: AsyncClient, test_user, auth_headers, db_session):
        schedule = Schedule(
            user_id=test_user.id,
            day_of_week=1,
            notification_time=time(8, 0),
            occasion="work",
            enabled=True,
            notify_day_before=False,
        )
        db_session.add(schedule)
        await db_session.commit()
        await db_session.refresh(schedule)

        response = await client.patch(
            f"/api/v1/notifications/schedules/{schedule.id}",
            json={
                "day_of_week": 2,
                "notification_time": "09:30",
                "occasion": "casual",
                "enabled": False,
                "notify_day_before": True,
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["day_of_week"] == 2
        assert data["notification_time"] == "09:30"
        assert data["occasion"] == "casual"
        assert data["enabled"] is False
        assert data["notify_day_before"] is True

    @pytest.mark.asyncio
    async def test_delete_schedule(self, client: AsyncClient, test_user, auth_headers, db_session):
        schedule = Schedule(
            user_id=test_user.id,
            day_of_week=3,
            notification_time=time(7, 15),
            occasion="work",
            enabled=True,
            notify_day_before=False,
        )
        db_session.add(schedule)
        await db_session.commit()
        await db_session.refresh(schedule)

        response = await client.delete(
            f"/api/v1/notifications/schedules/{schedule.id}",
            headers=auth_headers,
        )

        assert response.status_code == 200
        assert response.json()["message"] == "Schedule deleted"

        get_response = await client.get(
            f"/api/v1/notifications/schedules/{schedule.id}",
            headers=auth_headers,
        )
        assert get_response.status_code == 404


class TestLegacyChannelsRemoved:
    """The per-user channels (ntfy, Mattermost, email, Expo push) are gone for good."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("get", "/api/v1/notifications/settings"),
            ("post", "/api/v1/notifications/settings"),
            ("get", "/api/v1/notifications/defaults/ntfy"),
            ("post", "/api/v1/notifications/push-token"),
        ],
    )
    async def test_endpoints_are_gone(
        self, client: AsyncClient, test_user, auth_headers, method, path
    ):
        response = await client.request(method, path, json={}, headers=auth_headers)
        assert response.status_code in (404, 405)
