import pytest
from httpx import AsyncClient


class TestUserMe:
    """Tests for current user endpoint."""

    @pytest.mark.asyncio
    async def test_get_current_user(self, client: AsyncClient, test_user, auth_headers):
        """Test getting current user info."""
        response = await client.get("/api/v1/users/me", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == str(test_user.id)
        assert data["email"] == test_user.email
        assert data["display_name"] == test_user.display_name

    @pytest.mark.asyncio
    async def test_get_current_user_unauthorized(self, client: AsyncClient):
        """Test that unauthorized request returns 401."""
        response = await client.get("/api/v1/users/me")
        assert response.status_code == 401


class TestUserUpdate:
    """Tests for user update endpoint."""

    @pytest.mark.asyncio
    async def test_update_user(self, client: AsyncClient, test_user, auth_headers):
        """Test updating user information."""
        response = await client.patch(
            "/api/v1/users/me",
            json={
                "display_name": "Updated Name",
                "timezone": "America/New_York",
            },
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["display_name"] == "Updated Name"
        assert data["timezone"] == "America/New_York"

    @pytest.mark.asyncio
    async def test_update_user_location(self, client: AsyncClient, test_user, auth_headers):
        """Test updating user location."""
        response = await client.patch(
            "/api/v1/users/me",
            json={
                "location_lat": 40.7128,
                "location_lon": -74.0060,
                "location_name": "New York City",
            },
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["location_name"] == "New York City"
        # Check coordinates are stored (may be string or float depending on serialization)
        assert float(data["location_lat"]) == pytest.approx(40.7128, rel=1e-4)
        assert float(data["location_lon"]) == pytest.approx(-74.0060, rel=1e-4)

    @pytest.mark.asyncio
    async def test_update_city_from_geocoding_result(
        self, client: AsyncClient, test_user, auth_headers
    ):
        """The city picker saves name + coords + the city's IANA zone together."""
        response = await client.patch(
            "/api/v1/users/me",
            json={
                "location_name": "Madrid,  Comunidad de Madrid, España",
                "location_lat": 40.4165,
                "location_lon": -3.70256,
                "timezone": "Europe/Madrid",
            },
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["location_name"] == "Madrid, Comunidad de Madrid, España"
        assert data["timezone"] == "Europe/Madrid"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "tz",
        [
            "Europe/Madrid",
            "Atlantic/Canary",
            "America/Argentina/Buenos_Aires",
            "UTC",
            "Asia/Kathmandu",
        ],
    )
    async def test_accepts_any_iana_timezone(
        self, client: AsyncClient, test_user, auth_headers, tz
    ):
        response = await client.patch(
            "/api/v1/users/me", json={"timezone": tz}, headers=auth_headers
        )
        assert response.status_code == 200
        assert response.json()["timezone"] == tz

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("sent", "stored"),
        [("Asia/Calcutta", "Asia/Kolkata"), ("Europe/Kiev", "Europe/Kyiv")],
    )
    async def test_legacy_browser_timezone_is_canonicalised(
        self, client: AsyncClient, test_user, auth_headers, sent, stored
    ):
        response = await client.patch(
            "/api/v1/users/me", json={"timezone": sent}, headers=auth_headers
        )
        assert response.status_code == 200
        assert response.json()["timezone"] == stored

    @pytest.mark.asyncio
    @pytest.mark.parametrize("tz", ["Mars/Olympus", "Europe/Madrid ", "../etc/passwd", "", "GMT+2"])
    async def test_rejects_invalid_timezone(self, client: AsyncClient, test_user, auth_headers, tz):
        response = await client.patch(
            "/api/v1/users/me", json={"timezone": tz}, headers=auth_headers
        )
        if tz == "Europe/Madrid ":
            # Surrounding whitespace is trimmed, not an error.
            assert response.status_code == 200
            assert response.json()["timezone"] == "Europe/Madrid"
        else:
            assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_rejects_out_of_range_coordinates(
        self, client: AsyncClient, test_user, auth_headers
    ):
        response = await client.patch(
            "/api/v1/users/me", json={"location_lat": 91, "location_lon": 0}, headers=auth_headers
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_rejects_too_long_location_name(
        self, client: AsyncClient, test_user, auth_headers
    ):
        response = await client.patch(
            "/api/v1/users/me", json={"location_name": "x" * 101}, headers=auth_headers
        )
        assert response.status_code == 422


class TestOnboarding:
    """Tests for onboarding completion endpoint."""

    @pytest.mark.asyncio
    async def test_complete_onboarding(self, client: AsyncClient, test_user, auth_headers):
        """Test completing onboarding."""
        response = await client.post(
            "/api/v1/users/me/onboarding/complete",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["onboarding_completed"] is True

    @pytest.mark.asyncio
    async def test_onboarding_already_completed(
        self, client: AsyncClient, test_user, auth_headers, db_session
    ):
        """Test completing onboarding when already completed."""
        # Mark onboarding as completed
        test_user.onboarding_completed = True
        await db_session.commit()

        response = await client.post(
            "/api/v1/users/me/onboarding/complete",
            headers=auth_headers,
        )
        # Should still succeed (idempotent)
        assert response.status_code == 200
        data = response.json()
        assert data["onboarding_completed"] is True
