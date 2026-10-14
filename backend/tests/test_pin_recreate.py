"""«Recrea este look con mi ropa» from an imported pin."""

import io
from unittest.mock import AsyncMock, patch

from httpx import AsyncClient
from PIL import Image

from app.models.item import ClothingItem, ItemStatus
from app.models.pinterest import PinterestPin


def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (300, 400), (200, 180, 150)).save(buf, format="JPEG")
    return buf.getvalue()


async def _pin(db, user) -> PinterestPin:
    pin = PinterestPin(
        user_id=user.id,
        pinterest_pin_id="p-recreate",
        board_id="b",
        image_url="https://i.pinimg.com/originals/aa/bb/cc.jpg",
    )
    db.add(pin)
    await db.commit()
    await db.refresh(pin)
    return pin


class _FakeAI:
    analyze_vision_json = AsyncMock(
        return_value='{"garments":[{"type":"blazer","subtype":null,"primary_color":"beige",'
        '"colors":["beige"],"pattern":"solid","material":null},'
        '{"type":"boots","subtype":null,"primary_color":"brown","colors":["brown"],'
        '"pattern":"solid","material":"leather"}]}'
    )


async def test_recreate_matches_the_pin_against_the_wardrobe(
    client: AsyncClient, auth_headers, db_session, test_user
):
    db_session.add(
        ClothingItem(
            user_id=test_user.id,
            type="blazer",
            primary_color="beige",
            colors=["beige"],
            status=ItemStatus.ready,
            image_path="x/blazer.jpg",
        )
    )
    pin = await _pin(db_session, test_user)
    fetch = AsyncMock(return_value=[_jpeg()])
    with (
        patch(
            "app.api.integrations.pinterest.require_ai_client", AsyncMock(return_value=_FakeAI())
        ),
        patch("app.api.integrations.pinterest.download_pin_images", fetch),
        patch("app.api.integrations.pinterest.rate_limit_by_user", AsyncMock()),
    ):
        resp = await client.post(f"/api/v1/pins/{pin.id}/recreate", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [g["type"] for g in body["garments"]] == ["blazer", "boots"]
    assert body["garments"][0]["match"]["type"] == "blazer"
    assert body["garments"][1]["match"] is None  # no boots: what they are missing
    assert body["matched_count"] == 1
    # the light 736 px rendition is asked for first
    assert fetch.await_args_list[0].args[0] == ["https://i.pinimg.com/736x/aa/bb/cc.jpg"]


async def test_someone_elses_pin_is_not_found(client: AsyncClient, auth_headers, db_session):
    from uuid import uuid4

    from app.models.user import User

    other = User(
        id=uuid4(), external_id=f"o-{uuid4()}", email=f"o-{uuid4()}@x.es", display_name="O"
    )
    db_session.add(other)
    await db_session.commit()
    pin = await _pin(db_session, other)
    resp = await client.get(f"/api/v1/pins/{pin.id}", headers=auth_headers)
    assert resp.status_code == 404
    resp = await client.post(f"/api/v1/pins/{pin.id}/recreate", headers=auth_headers)
    assert resp.status_code == 404
