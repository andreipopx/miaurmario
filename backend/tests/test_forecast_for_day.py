"""A look for another day is dressed for that day's forecast."""

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.recommendation_service import RecommendationService
from app.services.weather_service import DailyForecast, WeatherService
from app.utils.timezone import get_user_today


def _user(**kw):
    base = {"id": "u", "timezone": "Europe/Madrid", "location_lat": 40.4, "location_lon": -3.7}
    return SimpleNamespace(**{**base, "location_name": None, **kw})


def _day(d, tmin, tmax, code=61):
    return DailyForecast(
        date=d.isoformat(),
        temp_max=tmax,
        temp_min=tmin,
        precipitation_chance=80,
        condition="rainy",
        condition_code=code,
        condition_label=None,
    )


async def test_weather_for_a_date_picks_that_day():
    svc = WeatherService()
    user = _user()
    today = get_user_today(user)
    days = [_day(today + timedelta(days=i), 5 + i, 15 + i) for i in range(16)]
    with patch.object(svc, "get_daily_forecast", AsyncMock(return_value=days)):
        w = await svc.get_weather_for_date(40.4, -3.7, today + timedelta(days=3))
        assert (w.temperature, w.feels_like, w.precipitation_chance) == (13.0, 18.0, 80)
        assert await svc.get_weather_for_date(40.4, -3.7, today + timedelta(days=20)) is None


async def test_forecast_only_for_future_days():
    rec = RecommendationService(db=None)
    user = _user()
    today = get_user_today(user)
    fake = AsyncMock(return_value="forecast")
    with patch.object(rec.weather_service, "get_weather_for_date", fake):
        assert await rec.forecast_for_day(user, today) is None
        assert await rec.forecast_for_day(user, today - timedelta(days=1)) is None
        assert await rec.forecast_for_day(user, today + timedelta(days=1)) == "forecast"
        # without a location there is nothing to forecast: callers keep today's sky
        assert (
            await rec.forecast_for_day(
                _user(location_lat=None, location_lon=None), today + timedelta(days=1)
            )
            is None
        )
