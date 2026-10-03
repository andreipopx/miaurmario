"""LAUNDRY_TRACKING: laundry ("para lavar") is hidden on purpose, behind a flag.

Off (the default): a wear is counted but never flags a garment as needing a wash,
the stylist never leaves a garment out for being dirty (not even one flagged back
when the feature was on), and Stinky is never told about washing at all.
On: the old behaviour, untouched.
"""

import json
from datetime import date, datetime
from uuid import uuid4

import pytest

from app.config import Settings, get_settings
from app.models.item import ClothingItem, ItemStatus
from app.services.item_rescue import ItemRescueService
from app.services.item_service import ItemService
from app.services.recommendation_service import RecommendationService
from app.services.stinky_chat.tools import (
    TOOL_DEFINITIONS,
    ToolContext,
    run_tool,
    tool_definitions,
)
from app.services.studio_service import StudioService
from app.services.weather_service import WeatherData


@pytest.fixture
def laundry(monkeypatch):
    """Flip LAUNDRY_TRACKING for one test: ``laundry(True)``."""

    def set_flag(on: bool) -> None:
        monkeypatch.setattr(get_settings(), "laundry_tracking", on)

    return set_flag


def _weather() -> WeatherData:
    return WeatherData(
        temperature=20,
        feels_like=20,
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


async def _item(db_session, user, **kwargs) -> ClothingItem:
    defaults = {
        "user_id": user.id,
        "type": "shirt",
        "image_path": f"test/{uuid4()}.jpg",
        "status": ItemStatus.ready,
        "primary_color": "blue",
        "wear_count": 0,
        "wears_since_wash": 0,
        "needs_wash": False,
        # One wear is enough to cross the interval, so any flagging shows at once.
        "wash_interval": 1,
    }
    defaults.update(kwargs)
    item = ClothingItem(**defaults)
    db_session.add(item)
    await db_session.commit()
    await db_session.refresh(item)
    return item


def test_laundry_tracking_is_off_by_default():
    assert Settings.model_fields["laundry_tracking"].default is False


@pytest.mark.parametrize("on", [False, True])
async def test_log_wear_flags_only_with_laundry_on(db_session, test_user, laundry, on):
    laundry(on)
    item = await _item(db_session, test_user)
    await ItemService(db_session).log_wear(item, date(2026, 9, 25))
    await db_session.refresh(item)
    assert item.wear_count == 1
    assert item.wears_since_wash == 1
    assert item.needs_wash is on


@pytest.mark.parametrize("on", [False, True])
async def test_studio_mark_worn_flags_only_with_laundry_on(db_session, test_user, laundry, on):
    laundry(on)
    shirt = await _item(db_session, test_user, type="t-shirt")
    jeans = await _item(db_session, test_user, type="jeans")
    await StudioService(db_session).create_from_scratch(
        user=test_user,
        item_ids=[shirt.id, jeans.id],
        occasion="casual",
        name=None,
        scheduled_for=date.today(),
        mark_worn=True,
        source_item_id=None,
    )
    await db_session.commit()
    await db_session.refresh(shirt)
    assert shirt.wear_count == 1
    assert shirt.wears_since_wash == 1
    assert shirt.needs_wash is on


@pytest.mark.parametrize("on", [False, True])
async def test_wearing_a_look_flags_only_with_laundry_on(
    client, db_session, test_user, auth_headers, laundry, on
):
    laundry(on)
    shirt = await _item(db_session, test_user, type="t-shirt")
    jeans = await _item(db_session, test_user, type="jeans")
    outfit = await StudioService(db_session).create_from_scratch(
        user=test_user,
        item_ids=[shirt.id, jeans.id],
        occasion="casual",
        name=None,
        scheduled_for=None,
        mark_worn=False,
        source_item_id=None,
    )
    await db_session.commit()
    r = await client.post(
        f"/api/v1/outfits/{outfit.id}/feedback",
        json={"accepted": True, "worn": True},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    await db_session.refresh(shirt)
    assert shirt.wear_count == 1
    assert shirt.wears_since_wash == 1
    assert shirt.needs_wash is on


@pytest.mark.parametrize("on", [False, True])
async def test_candidates_skip_dirty_garments_only_with_laundry_on(
    db_session, test_user, laundry, on
):
    laundry(on)
    clean = await _item(db_session, test_user, type="t-shirt")
    # Flagged while the feature was on; with it off the flag must not hide it.
    dirty = await _item(db_session, test_user, type="jeans", needs_wash=True)
    items = await RecommendationService(db_session).get_candidate_items(
        user=test_user,
        weather=_weather(),
        occasion="casual",
        preferences=None,
        exclude_items=[],
    )
    ids = {i.id for i in items}
    assert clean.id in ids
    assert (dirty.id in ids) is not on


@pytest.mark.parametrize("on", [False, True])
async def test_rescue_names_the_laundry_only_with_laundry_on(db_session, test_user, laundry, on):
    laundry(on)
    shirt = await _item(db_session, test_user, type="shirt")
    await _item(db_session, test_user, type="jeans", needs_wash=True)
    await _item(db_session, test_user, type="sneakers", needs_wash=True)
    hints = await ItemRescueService(db_session).diagnose(test_user, shirt)
    assert ("all_need_wash" in [h.code for h in hints]) is on


def test_stinky_tools_never_mention_washing_with_laundry_off(laundry):
    laundry(False)
    assert "wash" not in json.dumps(tool_definitions()).lower()
    # The full definitions are left untouched for when it comes back.
    assert "include_needs_wash" in json.dumps(TOOL_DEFINITIONS)


def test_stinky_tools_keep_the_wash_filter_with_laundry_on(laundry):
    laundry(True)
    assert tool_definitions() is TOOL_DEFINITIONS


@pytest.mark.parametrize("on", [False, True])
async def test_stinky_wardrobe_mentions_wash_only_with_laundry_on(
    db_session, test_user, laundry, on
):
    laundry(on)
    await _item(db_session, test_user, type="jeans", needs_wash=True)
    ctx = ToolContext(db=db_session, user=test_user)
    out = json.loads(await run_tool(ctx, "get_wardrobe", json.dumps({"include_needs_wash": False})))
    assert out["ok"] is True
    items = out["data"]["items"]
    if on:
        assert items == []
    else:
        [item] = items
        assert "needs_wash" not in item
