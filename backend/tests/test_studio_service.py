from datetime import date
from uuid import uuid4

import pytest
import pytest_asyncio

from app.models.item import ClothingItem, ItemStatus
from app.models.outfit import OutfitSource, OutfitStatus
from app.models.user import User
from app.services.studio_service import (
    ItemLayoutInput,
    ItemOwnershipError,
    OutfitNotTemplateError,
    OutfitWornImmutableError,
    StudioService,
)


@pytest_asyncio.fixture
async def studio_user(db_session):
    uid = uuid4()
    user = User(
        id=uid,
        external_id=f"studio-{uid}",
        email=f"studio-{uid}@example.com",
        display_name="Studio Tester",
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def wardrobe_items(db_session, studio_user):
    items = []
    for item_type in ["t-shirt", "jeans", "sneakers", "jacket", "dress"]:
        item = ClothingItem(
            id=uuid4(),
            user_id=studio_user.id,
            type=item_type,
            image_path=f"test/{item_type}.jpg",
            status=ItemStatus.ready,
            primary_color="blue",
            wear_count=0,
            wears_since_wash=0,
            needs_wash=False,
        )
        db_session.add(item)
        items.append(item)
    await db_session.commit()
    for item in items:
        await db_session.refresh(item)
    return items


@pytest.mark.asyncio
async def test_create_from_scratch(db_session, studio_user, wardrobe_items):
    service = StudioService(db_session)
    shirt, jeans, sneakers = wardrobe_items[0], wardrobe_items[1], wardrobe_items[2]

    outfit = await service.create_from_scratch(
        user=studio_user,
        item_ids=[shirt.id, jeans.id, sneakers.id],
        occasion="casual",
        name="Test outfit",
        scheduled_for=None,
        mark_worn=False,
        source_item_id=None,
    )
    await db_session.commit()

    assert outfit.source == OutfitSource.manual
    assert outfit.name == "Test outfit"
    assert outfit.occasion == "casual"
    assert outfit.scheduled_for is None
    assert len(outfit.items) == 3
    assert outfit.feedback is not None
    assert outfit.feedback.accepted is True


@pytest.mark.asyncio
async def test_create_from_scratch_mark_worn(db_session, studio_user, wardrobe_items):
    service = StudioService(db_session)
    shirt, jeans, sneakers = wardrobe_items[0], wardrobe_items[1], wardrobe_items[2]
    today = date.today()

    outfit = await service.create_from_scratch(
        user=studio_user,
        item_ids=[shirt.id, jeans.id, sneakers.id],
        occasion="casual",
        name=None,
        scheduled_for=today,
        mark_worn=True,
        source_item_id=None,
    )
    await db_session.commit()

    assert outfit.feedback.worn_at == today

    await db_session.refresh(shirt)
    assert shirt.wear_count == 1
    assert shirt.wears_since_wash == 1


@pytest.mark.asyncio
async def test_create_from_scratch_rejects_non_owned_items(db_session, studio_user):
    service = StudioService(db_session)
    fake_id = uuid4()

    with pytest.raises(ItemOwnershipError):
        await service.create_from_scratch(
            user=studio_user,
            item_ids=[fake_id],
            occasion="casual",
            name=None,
            scheduled_for=None,
            mark_worn=False,
            source_item_id=None,
        )


@pytest.mark.asyncio
async def test_create_from_scratch_empty_items_raises(db_session, studio_user):
    service = StudioService(db_session)

    with pytest.raises(ValueError, match="items required"):
        await service.create_from_scratch(
            user=studio_user,
            item_ids=[],
            occasion="casual",
            name=None,
            scheduled_for=None,
            mark_worn=False,
            source_item_id=None,
        )


@pytest.mark.asyncio
async def test_clone_to_lookbook(db_session, studio_user, wardrobe_items):
    service = StudioService(db_session)
    shirt, jeans, sneakers = wardrobe_items[0], wardrobe_items[1], wardrobe_items[2]

    original = await service.create_from_scratch(
        user=studio_user,
        item_ids=[shirt.id, jeans.id, sneakers.id],
        occasion="office",
        name=None,
        scheduled_for=date.today(),
        mark_worn=False,
        source_item_id=None,
    )
    await db_session.commit()

    clone = await service.clone_to_lookbook(
        user=studio_user,
        source_outfit_id=original.id,
        name="My office look",
    )
    await db_session.commit()

    assert clone.id != original.id
    assert clone.cloned_from_outfit_id == original.id
    assert clone.scheduled_for is None
    assert clone.name == "My office look"
    assert len(clone.items) == len(original.items)


@pytest.mark.asyncio
async def test_clone_to_lookbook_idempotent(db_session, studio_user, wardrobe_items):
    service = StudioService(db_session)
    shirt, jeans = wardrobe_items[0], wardrobe_items[1]

    original = await service.create_from_scratch(
        user=studio_user,
        item_ids=[shirt.id, jeans.id],
        occasion="casual",
        name=None,
        scheduled_for=date.today(),
        mark_worn=False,
        source_item_id=None,
    )
    await db_session.commit()

    clone1 = await service.clone_to_lookbook(
        user=studio_user, source_outfit_id=original.id, name="Look A"
    )
    await db_session.commit()

    clone2 = await service.clone_to_lookbook(
        user=studio_user, source_outfit_id=original.id, name="Look B"
    )
    await db_session.commit()

    assert clone1.id == clone2.id


@pytest.mark.asyncio
async def test_clone_not_found_raises(db_session, studio_user):
    service = StudioService(db_session)

    with pytest.raises(LookupError):
        await service.clone_to_lookbook(user=studio_user, source_outfit_id=uuid4(), name="Nope")


@pytest.mark.asyncio
async def test_wear_today(db_session, studio_user, wardrobe_items):
    service = StudioService(db_session)
    shirt, jeans, sneakers = wardrobe_items[0], wardrobe_items[1], wardrobe_items[2]

    template = await service.create_from_scratch(
        user=studio_user,
        item_ids=[shirt.id, jeans.id, sneakers.id],
        occasion="casual",
        name="Daily look",
        scheduled_for=None,
        mark_worn=False,
        source_item_id=None,
    )
    await db_session.commit()

    today = date.today()
    wear = await service.wear_today(user=studio_user, template_id=template.id, scheduled_for=today)
    await db_session.commit()

    assert wear.scheduled_for == today
    assert wear.cloned_from_outfit_id == template.id
    assert len(wear.items) == 3

    await db_session.refresh(shirt)
    assert shirt.wear_count == 1


@pytest.mark.asyncio
async def test_wear_today_requires_template(db_session, studio_user, wardrobe_items):
    service = StudioService(db_session)
    shirt = wardrobe_items[0]

    outfit = await service.create_from_scratch(
        user=studio_user,
        item_ids=[shirt.id],
        occasion="casual",
        name=None,
        scheduled_for=date.today(),
        mark_worn=False,
        source_item_id=None,
    )
    await db_session.commit()

    with pytest.raises(OutfitNotTemplateError):
        await service.wear_today(user=studio_user, template_id=outfit.id, scheduled_for=None)


@pytest.mark.asyncio
async def test_patch_outfit_name(db_session, studio_user, wardrobe_items):
    service = StudioService(db_session)
    shirt = wardrobe_items[0]

    outfit = await service.create_from_scratch(
        user=studio_user,
        item_ids=[shirt.id],
        occasion="casual",
        name="Original",
        scheduled_for=None,
        mark_worn=False,
        source_item_id=None,
    )
    await db_session.commit()

    updated = await service.patch_outfit(
        user=studio_user, outfit_id=outfit.id, name="Renamed", items=None
    )
    await db_session.commit()

    assert updated.name == "Renamed"


@pytest.mark.asyncio
async def test_patch_outfit_items(db_session, studio_user, wardrobe_items):
    service = StudioService(db_session)
    shirt, jeans, sneakers = (
        wardrobe_items[0],
        wardrobe_items[1],
        wardrobe_items[2],
    )

    outfit = await service.create_from_scratch(
        user=studio_user,
        item_ids=[shirt.id, jeans.id],
        occasion="casual",
        name="V1",
        scheduled_for=None,
        mark_worn=False,
        source_item_id=None,
    )
    await db_session.commit()

    updated = await service.patch_outfit(
        user=studio_user,
        outfit_id=outfit.id,
        name=None,
        items=[shirt.id, jeans.id, sneakers.id],
    )
    await db_session.commit()

    assert len(updated.items) == 3


@pytest.mark.asyncio
async def test_patch_worn_outfit_raises(db_session, studio_user, wardrobe_items):
    service = StudioService(db_session)
    shirt, jeans = wardrobe_items[0], wardrobe_items[1]

    outfit = await service.create_from_scratch(
        user=studio_user,
        item_ids=[shirt.id, jeans.id],
        occasion="casual",
        name=None,
        scheduled_for=date.today(),
        mark_worn=True,
        source_item_id=None,
    )
    await db_session.commit()

    with pytest.raises(OutfitWornImmutableError):
        await service.patch_outfit(
            user=studio_user,
            outfit_id=outfit.id,
            name=None,
            items=[shirt.id],
        )


@pytest.mark.asyncio
async def test_wore_instead(db_session, studio_user, wardrobe_items):
    service = StudioService(db_session)
    shirt, jeans, sneakers, jacket = (
        wardrobe_items[0],
        wardrobe_items[1],
        wardrobe_items[2],
        wardrobe_items[3],
    )

    original = await service.create_from_scratch(
        user=studio_user,
        item_ids=[shirt.id, jeans.id],
        occasion="casual",
        name=None,
        scheduled_for=date.today(),
        mark_worn=False,
        source_item_id=None,
    )
    await db_session.commit()

    replacement = await service.create_wore_instead(
        user=studio_user,
        original_outfit_id=original.id,
        item_ids=[jacket.id, sneakers.id],
        rating=5,
        comment="Liked this better",
        scheduled_for=None,
    )
    await db_session.commit()

    assert replacement.replaces_outfit_id == original.id
    assert len(replacement.items) == 2
    assert replacement.feedback.rating == 5

    await db_session.refresh(original)
    assert original.status == OutfitStatus.rejected


@pytest.mark.asyncio
async def test_wore_instead_idempotent(db_session, studio_user, wardrobe_items):
    service = StudioService(db_session)
    shirt, jeans, sneakers = wardrobe_items[0], wardrobe_items[1], wardrobe_items[2]

    original = await service.create_from_scratch(
        user=studio_user,
        item_ids=[shirt.id],
        occasion="casual",
        name=None,
        scheduled_for=date.today(),
        mark_worn=False,
        source_item_id=None,
    )
    await db_session.commit()

    r1 = await service.create_wore_instead(
        user=studio_user,
        original_outfit_id=original.id,
        item_ids=[jeans.id, sneakers.id],
        rating=None,
        comment=None,
        scheduled_for=None,
    )
    await db_session.commit()

    r2 = await service.create_wore_instead(
        user=studio_user,
        original_outfit_id=original.id,
        item_ids=[jeans.id, sneakers.id],
        rating=None,
        comment=None,
        scheduled_for=None,
    )
    await db_session.commit()

    assert r1.id == r2.id


@pytest.mark.asyncio
async def test_items_ordered_canonically(db_session, studio_user, wardrobe_items):
    service = StudioService(db_session)
    sneakers, shirt, jeans = wardrobe_items[2], wardrobe_items[0], wardrobe_items[1]

    outfit = await service.create_from_scratch(
        user=studio_user,
        item_ids=[sneakers.id, jeans.id, shirt.id],
        occasion="casual",
        name=None,
        scheduled_for=None,
        mark_worn=False,
        source_item_id=None,
    )
    await db_session.commit()

    types_in_order = [oi.item.type for oi in sorted(outfit.items, key=lambda x: x.position)]
    assert types_in_order.index("t-shirt") < types_in_order.index("jeans")
    assert types_in_order.index("jeans") < types_in_order.index("sneakers")


@pytest.mark.asyncio
async def test_create_from_scratch_persists_layout_when_positions_present(
    db_session, studio_user, wardrobe_items
):
    """When the client sends spatial coordinates, they must be saved verbatim
    and the item order must follow the layout array (visual authoring order),
    not the canonical role sort."""
    service = StudioService(db_session)
    shirt, jeans, sneakers = wardrobe_items[0], wardrobe_items[1], wardrobe_items[2]

    layouts = [
        ItemLayoutInput(item_id=sneakers.id, pos_x=0.5, pos_y=0.85, z_index=1),
        ItemLayoutInput(item_id=shirt.id, pos_x=0.5, pos_y=0.3, z_index=2),
        ItemLayoutInput(item_id=jeans.id, pos_x=0.5, pos_y=0.6, z_index=3),
    ]

    outfit = await service.create_from_scratch(
        user=studio_user,
        item_ids=[shirt.id, jeans.id, sneakers.id],
        occasion="casual",
        name="Layout look",
        scheduled_for=None,
        mark_worn=False,
        source_item_id=None,
        layouts=layouts,
    )
    await db_session.commit()

    by_pos = sorted(outfit.items, key=lambda x: x.position)
    # Layout defines the authoring order, so sneakers (index 0) must land first.
    assert [oi.item_id for oi in by_pos] == [sneakers.id, shirt.id, jeans.id]
    sneakers_oi = next(oi for oi in outfit.items if oi.item_id == sneakers.id)
    assert sneakers_oi.pos_x == pytest.approx(0.5)
    assert sneakers_oi.pos_y == pytest.approx(0.85)
    assert sneakers_oi.z_index == 1


@pytest.mark.asyncio
async def test_create_from_scratch_ignores_empty_layout(
    db_session, studio_user, wardrobe_items
):
    """A layout list where every entry lacks pos_x/pos_y must fall back to
    canonical role ordering — the client is telling us 'add these items, no
    specific arrangement'."""
    service = StudioService(db_session)
    shirt, jeans, sneakers = wardrobe_items[0], wardrobe_items[1], wardrobe_items[2]

    layouts = [
        ItemLayoutInput(item_id=sneakers.id),
        ItemLayoutInput(item_id=jeans.id),
        ItemLayoutInput(item_id=shirt.id),
    ]

    outfit = await service.create_from_scratch(
        user=studio_user,
        item_ids=[sneakers.id, jeans.id, shirt.id],
        occasion="casual",
        name=None,
        scheduled_for=None,
        mark_worn=False,
        source_item_id=None,
        layouts=layouts,
    )
    await db_session.commit()

    by_pos = sorted(outfit.items, key=lambda x: x.position)
    types_in_order = [oi.item.type for oi in by_pos]
    # Canonical order should win when no coordinates were sent.
    assert types_in_order.index("t-shirt") < types_in_order.index("jeans")
    for oi in outfit.items:
        assert oi.pos_x is None
        assert oi.pos_y is None


@pytest.mark.asyncio
async def test_patch_outfit_updates_layout_only(
    db_session, studio_user, wardrobe_items
):
    """A layouts-only patch (no `items` list) must reposition the existing
    items without changing the set — used when the user drags things around
    without adding/removing anything."""
    service = StudioService(db_session)
    shirt, jeans = wardrobe_items[0], wardrobe_items[1]

    outfit = await service.create_from_scratch(
        user=studio_user,
        item_ids=[shirt.id, jeans.id],
        occasion="casual",
        name="Base",
        scheduled_for=None,
        mark_worn=False,
        source_item_id=None,
    )
    await db_session.commit()

    updated = await service.patch_outfit(
        user=studio_user,
        outfit_id=outfit.id,
        name=None,
        items=None,
        layouts=[
            ItemLayoutInput(item_id=shirt.id, pos_x=0.2, pos_y=0.3, z_index=1),
            ItemLayoutInput(item_id=jeans.id, pos_x=0.7, pos_y=0.6, z_index=2),
        ],
    )
    await db_session.commit()

    assert len(updated.items) == 2
    shirt_oi = next(oi for oi in updated.items if oi.item_id == shirt.id)
    assert shirt_oi.pos_x == pytest.approx(0.2)
    assert shirt_oi.pos_y == pytest.approx(0.3)


@pytest.mark.asyncio
async def test_legacy_outfits_still_have_null_layout(
    db_session, studio_user, wardrobe_items
):
    """The migration must default pos_x/pos_y to NULL for outfits created
    without a layout — that's how the detail page decides to render the
    classic grid instead of the canvas."""
    service = StudioService(db_session)
    shirt, jeans = wardrobe_items[0], wardrobe_items[1]

    outfit = await service.create_from_scratch(
        user=studio_user,
        item_ids=[shirt.id, jeans.id],
        occasion="casual",
        name=None,
        scheduled_for=None,
        mark_worn=False,
        source_item_id=None,
    )
    await db_session.commit()

    for oi in outfit.items:
        assert oi.pos_x is None
        assert oi.pos_y is None
        assert oi.scale == 1.0
        assert oi.rotation == 0.0
        assert oi.z_index == 0


@pytest.mark.asyncio
async def test_list_outfits_was_worn_filter(db_session, studio_user, wardrobe_items):
    from app.services.outfit_service import OutfitListFilters, OutfitService

    service = StudioService(db_session)
    shirt, jeans, sneakers = wardrobe_items[0], wardrobe_items[1], wardrobe_items[2]
    worn = await service.create_from_scratch(
        user=studio_user,
        item_ids=[shirt.id, jeans.id, sneakers.id],
        occasion="casual",
        name="worn",
        scheduled_for=date.today(),
        mark_worn=True,
        source_item_id=None,
    )
    not_worn = await service.create_from_scratch(
        user=studio_user,
        item_ids=[shirt.id, jeans.id, sneakers.id],
        occasion="casual",
        name="not worn",
        scheduled_for=date.today(),
        mark_worn=False,
        source_item_id=None,
    )
    await db_session.commit()

    outfits = OutfitService(db_session)
    only_worn, total = await outfits.list_with_filters(
        OutfitListFilters(user_id=studio_user.id, was_worn=True), 1, 20
    )
    assert total == 1
    assert [o.id for o in only_worn] == [worn.id]

    never_worn, total = await outfits.list_with_filters(
        OutfitListFilters(user_id=studio_user.id, was_worn=False), 1, 20
    )
    assert total == 1
    assert [o.id for o in never_worn] == [not_worn.id]
