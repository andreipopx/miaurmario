"""Social layer: friendships, visibility, feed, reactions and privacy (IDOR) checks."""

from datetime import date, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import create_access_token
from app.models import ClothingItem, Outfit, OutfitItem, User
from app.models.item import ItemStatus
from app.models.outfit import OutfitStatus, OutfitVisibility

API = "/api/v1"
STORAGE = Path("/tmp/wardrobe_test")


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.external_id)}"}


async def _make_user(db: AsyncSession, username: str | None) -> User:
    uid = uuid4()
    user = User(
        id=uid,
        external_id=f"social-{uid}",
        email=f"social-{uid}@example.com",
        username=f"{username}_{uid.hex[:6]}" if username else None,
        display_name=(username or "anon").title(),
        bio="Hola",
        timezone="UTC",
        is_active=True,
        onboarding_completed=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _make_outfit(
    db: AsyncSession,
    owner: User,
    visibility: OutfitVisibility = OutfitVisibility.private,
    day: date | None = None,
) -> tuple[Outfit, ClothingItem]:
    fname = f"{uuid4().hex}.jpg"
    folder = STORAGE / str(owner.id)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / fname).write_bytes(b"\xff\xd8\xff\xe0fakejpeg")
    item = ClothingItem(
        id=uuid4(),
        user_id=owner.id,
        type="shirt",
        image_path=f"{owner.id}/{fname}",
        thumbnail_path=f"{owner.id}/{fname}",
        status=ItemStatus.ready,
        primary_color="blue",
        wear_count=0,
        wears_since_wash=0,
        needs_wash=False,
    )
    db.add(item)
    outfit = Outfit(
        id=uuid4(),
        user_id=owner.id,
        occasion="casual",
        scheduled_for=day or date.today(),
        status=OutfitStatus.accepted,
        visibility=OutfitVisibility.private,
    )
    db.add(outfit)
    await db.flush()
    db.add(OutfitItem(outfit_id=outfit.id, item_id=item.id, position=0))
    await db.commit()
    if visibility != OutfitVisibility.private:
        from app.services.social_service import apply_visibility

        apply_visibility(outfit, visibility)
        await db.commit()
    return outfit, item


async def _befriend(client: AsyncClient, a: User, b: User) -> str:
    r = await client.post(
        f"{API}/friends/requests", json={"username": b.username}, headers=_headers(a)
    )
    assert r.status_code == 201, r.text
    fid = r.json()["id"]
    r = await client.post(f"{API}/friends/{fid}/accept", headers=_headers(b))
    assert r.status_code == 200, r.text
    assert r.json()["relation"] == "friends"
    return fid


@pytest_asyncio.fixture
async def ana(db_session: AsyncSession) -> User:
    return await _make_user(db_session, "ana")


@pytest_asyncio.fixture
async def bea(db_session: AsyncSession) -> User:
    return await _make_user(db_session, "bea")


@pytest_asyncio.fixture
async def eve(db_session: AsyncSession) -> User:
    return await _make_user(db_session, "eve")


# -- Friendships ---------------------------------------------------------------------


class TestFriendships:
    async def test_request_accept_and_list(self, client, ana, bea):
        r = await client.post(
            f"{API}/friends/requests", json={"username": bea.username}, headers=_headers(ana)
        )
        assert r.status_code == 201
        body = r.json()
        assert body["relation"] == "outgoing"
        assert body["user"]["username"] == bea.username
        assert "email" not in body["user"]

        s = (await client.get(f"{API}/friends/summary", headers=_headers(bea))).json()
        assert s["pending_requests"] == 1

        overview = (await client.get(f"{API}/friends", headers=_headers(bea))).json()
        assert len(overview["incoming"]) == 1
        fid = overview["incoming"][0]["id"]

        # The requester cannot accept their own request.
        r = await client.post(f"{API}/friends/{fid}/accept", headers=_headers(ana))
        assert r.status_code == 404

        r = await client.post(f"{API}/friends/{fid}/accept", headers=_headers(bea))
        assert r.status_code == 200
        overview = (await client.get(f"{API}/friends", headers=_headers(ana))).json()
        assert [f["user"]["username"] for f in overview["friends"]] == [bea.username]

    async def test_duplicate_and_reverse_request_auto_accepts(self, client, ana, bea):
        await client.post(
            f"{API}/friends/requests", json={"username": bea.username}, headers=_headers(ana)
        )
        r = await client.post(
            f"{API}/friends/requests", json={"username": bea.username}, headers=_headers(ana)
        )
        assert r.status_code == 409
        r = await client.post(
            f"{API}/friends/requests", json={"username": ana.username}, headers=_headers(bea)
        )
        assert r.status_code == 201
        assert r.json()["relation"] == "friends"

    async def test_self_and_unknown(self, client, ana):
        r = await client.post(
            f"{API}/friends/requests", json={"username": ana.username}, headers=_headers(ana)
        )
        assert r.status_code == 400
        r = await client.post(
            f"{API}/friends/requests", json={"username": "nadie_existe"}, headers=_headers(ana)
        )
        assert r.status_code == 404

    async def test_username_required_to_request(self, client, db_session, bea):
        anon = await _make_user(db_session, None)
        r = await client.post(
            f"{API}/friends/requests", json={"username": bea.username}, headers=_headers(anon)
        )
        assert r.status_code == 400
        assert r.json()["detail"] == "username_required"

    async def test_decline_cancel_remove(self, client, ana, bea):
        r = await client.post(
            f"{API}/friends/requests", json={"username": bea.username}, headers=_headers(ana)
        )
        fid = r.json()["id"]
        # Cancel (requester)
        assert (
            await client.delete(f"{API}/friends/{fid}", headers=_headers(ana))
        ).status_code == 204
        # Decline (addressee)
        r = await client.post(
            f"{API}/friends/requests", json={"username": bea.username}, headers=_headers(ana)
        )
        fid = r.json()["id"]
        assert (
            await client.delete(f"{API}/friends/{fid}", headers=_headers(bea))
        ).status_code == 204
        # Remove friend
        fid = await _befriend(client, ana, bea)
        assert (
            await client.delete(f"{API}/friends/{fid}", headers=_headers(bea))
        ).status_code == 204
        overview = (await client.get(f"{API}/friends", headers=_headers(ana))).json()
        assert overview["friends"] == []

    async def test_stranger_cannot_touch_others_friendship(self, client, ana, bea, eve):
        r = await client.post(
            f"{API}/friends/requests", json={"username": bea.username}, headers=_headers(ana)
        )
        fid = r.json()["id"]
        assert (
            await client.post(f"{API}/friends/{fid}/accept", headers=_headers(eve))
        ).status_code == 404
        assert (
            await client.delete(f"{API}/friends/{fid}", headers=_headers(eve))
        ).status_code == 404

    async def test_blocked_user_cannot_request_or_find(self, client, ana, bea):
        fid = await _befriend(client, ana, bea)
        r = await client.post(
            f"{API}/friends/block", json={"username": bea.username}, headers=_headers(ana)
        )
        assert r.status_code == 204
        # Blocked side: request looks like "user not found".
        r = await client.post(
            f"{API}/friends/requests", json={"username": ana.username}, headers=_headers(bea)
        )
        assert r.status_code == 404
        # ...and cannot see the profile or find them in search.
        r = await client.get(f"{API}/social/users/{ana.username}", headers=_headers(bea))
        assert r.status_code == 404
        r = await client.get(
            f"{API}/friends/search", params={"q": ana.username}, headers=_headers(bea)
        )
        assert r.json() == []
        # The blocked user cannot lift the block.
        assert (
            await client.delete(f"{API}/friends/{fid}", headers=_headers(bea))
        ).status_code == 404
        # The blocker sees it under blocked and can unblock.
        overview = (await client.get(f"{API}/friends", headers=_headers(ana))).json()
        assert len(overview["blocked"]) == 1
        assert (
            await client.delete(f"{API}/friends/{fid}", headers=_headers(ana))
        ).status_code == 204
        # And the blocked user does not see the block row at all.
        overview = (await client.get(f"{API}/friends", headers=_headers(bea))).json()
        assert overview == {"friends": [], "incoming": [], "outgoing": [], "blocked": []}


class TestSearch:
    async def test_prefix_search_exposes_only_public_fields(self, client, ana, bea):
        r = await client.get(
            f"{API}/friends/search", params={"q": bea.username[:5]}, headers=_headers(ana)
        )
        assert r.status_code == 200
        results = r.json()
        assert bea.username in [x["user"]["username"] for x in results]
        for x in results:
            assert set(x["user"].keys()) == {
                "username",
                "display_name",
                "avatar_url",
                "avatar_thumb_url",
                "bio",
            }

    async def test_underscore_is_not_a_wildcard(self, client, ana, bea):
        # "b_a" must not match "bea_…" through LIKE's single-char wildcard.
        r = await client.get(f"{API}/friends/search", params={"q": "b_a"}, headers=_headers(ana))
        assert bea.username not in [x["user"]["username"] for x in r.json()]

    async def test_search_excludes_self(self, client, ana):
        r = await client.get(
            f"{API}/friends/search", params={"q": ana.username}, headers=_headers(ana)
        )
        assert r.json() == []

    async def test_search_requires_auth(self, client):
        r = await client.get(f"{API}/friends/search", params={"q": "ana"})
        assert r.status_code == 401


# -- Visibility, sharing, feed ----------------------------------------------------


class TestVisibilityAndFeed:
    async def test_share_appears_in_friend_feed(self, client, db_session, ana, bea, eve):
        await _befriend(client, ana, bea)
        outfit, _ = await _make_outfit(db_session, ana)

        r = await client.post(f"{API}/outfits/{outfit.id}/share", headers=_headers(ana))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["visibility"] == "friends"
        assert body["shared_at"] is not None

        feed = (await client.get(f"{API}/social/feed", headers=_headers(bea))).json()
        assert len(feed["groups"]) == 1
        group = feed["groups"][0]
        assert group["author"]["username"] == ana.username
        assert group["day"] == date.today().isoformat()
        card = group["outfits"][0]
        assert card["id"] == str(outfit.id)
        assert card["items"][0]["thumbnail_url"].startswith("/api/v1/images/")
        assert "image_path" not in card["items"][0]

        # Stranger's feed is empty.
        feed = (await client.get(f"{API}/social/feed", headers=_headers(eve))).json()
        assert feed["groups"] == []

    async def test_several_outfits_same_day_grouped_in_order(self, client, db_session, ana, bea):
        await _befriend(client, ana, bea)
        morning, _ = await _make_outfit(db_session, ana)
        evening, _ = await _make_outfit(db_session, ana)
        # Share the evening look first: order inside the day is still chronological.
        for o in (evening, morning):
            r = await client.post(f"{API}/outfits/{o.id}/share", headers=_headers(ana))
            assert r.status_code == 200
        feed = (await client.get(f"{API}/social/feed", headers=_headers(bea))).json()
        assert len(feed["groups"]) == 1
        assert [o["id"] for o in feed["groups"][0]["outfits"]] == [str(morning.id), str(evening.id)]
        # Both stay shared: no "one per day" restriction.
        for o in (morning, evening):
            detail = (await client.get(f"{API}/outfits/{o.id}", headers=_headers(ana))).json()
            assert detail["visibility"] == "friends"

    async def test_unshare_makes_private(self, client, db_session, ana, bea):
        await _befriend(client, ana, bea)
        outfit, _ = await _make_outfit(db_session, ana)
        await client.post(f"{API}/outfits/{outfit.id}/share", headers=_headers(ana))
        r = await client.delete(f"{API}/outfits/{outfit.id}/share", headers=_headers(ana))
        assert r.json()["visibility"] == "private"
        assert r.json()["shared_at"] is None
        feed = (await client.get(f"{API}/social/feed", headers=_headers(bea))).json()
        assert feed["groups"] == []

    async def test_only_owner_can_change_visibility(self, client, db_session, ana, bea):
        await _befriend(client, ana, bea)
        outfit, _ = await _make_outfit(db_session, ana)
        r = await client.patch(
            f"{API}/outfits/{outfit.id}/visibility",
            json={"visibility": "public"},
            headers=_headers(bea),
        )
        assert r.status_code == 404
        r = await client.post(f"{API}/outfits/{outfit.id}/share", headers=_headers(bea))
        assert r.status_code == 404
        r = await client.patch(
            f"{API}/outfits/{outfit.id}/visibility",
            json={"visibility": "public"},
            headers=_headers(ana),
        )
        assert r.status_code == 200
        assert r.json()["visibility"] == "public"

    async def test_feed_groups_per_friend_and_day_with_pagination(
        self, client, db_session, ana, bea, eve
    ):
        await _befriend(client, ana, bea)
        await _befriend(client, eve, bea)
        today = date.today()
        ids = []
        for days_ago in (0, 1, 2):
            o, _ = await _make_outfit(
                db_session, ana, OutfitVisibility.friends, day=today - timedelta(days=days_ago)
            )
            ids.append(str(o.id))
        o, _ = await _make_outfit(db_session, eve, OutfitVisibility.public, day=today)
        ids.append(str(o.id))

        p1 = (
            await client.get(f"{API}/social/feed", params={"limit": 2}, headers=_headers(bea))
        ).json()
        assert len(p1["groups"]) == 2 and p1["next_cursor"]
        # Newest day first: both of today's cards (ana, eve) before yesterday.
        assert {g["day"] for g in p1["groups"]} == {today.isoformat()}
        p2 = (
            await client.get(
                f"{API}/social/feed",
                params={"limit": 2, "cursor": p1["next_cursor"]},
                headers=_headers(bea),
            )
        ).json()
        assert len(p2["groups"]) == 2 and p2["next_cursor"] is None
        assert [g["day"] for g in p2["groups"]] == [
            (today - timedelta(days=1)).isoformat(),
            (today - timedelta(days=2)).isoformat(),
        ]
        seen = [o["id"] for g in p1["groups"] + p2["groups"] for o in g["outfits"]]
        assert sorted(seen) == sorted(ids)
        r = await client.get(
            f"{API}/social/feed", params={"cursor": "garbage!!"}, headers=_headers(bea)
        )
        assert r.status_code == 400


# -- IDOR / privacy ---------------------------------------------------------------------------


class TestPrivacy:
    async def test_non_friend_cannot_see_friends_only_outfit(self, client, db_session, ana, eve):
        outfit, _ = await _make_outfit(db_session, ana, OutfitVisibility.friends)
        h = _headers(eve)
        assert (await client.get(f"{API}/social/outfits/{outfit.id}", headers=h)).status_code == 404
        assert (await client.get(f"{API}/outfits/{outfit.id}", headers=h)).status_code == 404
        r = await client.put(f"{API}/social/outfits/{outfit.id}/reaction", json={}, headers=h)
        assert r.status_code == 404
        profile_outfits = (
            await client.get(f"{API}/social/users/{ana.username}/outfits", headers=h)
        ).json()
        assert profile_outfits["items"] == []

    async def test_friend_cannot_see_private_outfit(self, client, db_session, ana, bea):
        await _befriend(client, ana, bea)
        outfit, _ = await _make_outfit(db_session, ana)
        h = _headers(bea)
        assert (await client.get(f"{API}/social/outfits/{outfit.id}", headers=h)).status_code == 404
        profile_outfits = (
            await client.get(f"{API}/social/users/{ana.username}/outfits", headers=h)
        ).json()
        assert profile_outfits["items"] == []

    async def test_unfriend_revokes_access(self, client, db_session, ana, bea):
        fid = await _befriend(client, ana, bea)
        outfit, _ = await _make_outfit(db_session, ana, OutfitVisibility.friends)
        h = _headers(bea)
        assert (await client.get(f"{API}/social/outfits/{outfit.id}", headers=h)).status_code == 200
        await client.delete(f"{API}/friends/{fid}", headers=_headers(ana))
        assert (await client.get(f"{API}/social/outfits/{outfit.id}", headers=h)).status_code == 404

    async def test_block_revokes_public_access(self, client, db_session, ana, eve):
        outfit, _ = await _make_outfit(db_session, ana, OutfitVisibility.public)
        h = _headers(eve)
        assert (await client.get(f"{API}/social/outfits/{outfit.id}", headers=h)).status_code == 200
        await client.post(
            f"{API}/friends/block", json={"username": eve.username}, headers=_headers(ana)
        )
        assert (await client.get(f"{API}/social/outfits/{outfit.id}", headers=h)).status_code == 404

    async def test_item_images_not_served_to_non_friends(self, client, db_session, ana, bea, eve):
        await _befriend(client, ana, bea)
        outfit, item = await _make_outfit(db_session, ana, OutfitVisibility.friends)
        raw = f"{API}/images/{item.thumbnail_path}"

        # Owner: session access works.
        assert (await client.get(raw, headers=_headers(ana))).status_code == 200
        # Stranger and even a friend: no session-based access to someone else's folder.
        assert (await client.get(raw, headers=_headers(eve))).status_code == 401
        assert (await client.get(raw, headers=_headers(bea))).status_code == 401
        # Forged signature fails.
        r = await client.get(raw, params={"expires": "9999999999", "sig": "0" * 32})
        assert r.status_code == 401

        # The friend gets a signed URL only through an authorised outfit response.
        card = (await client.get(f"{API}/social/outfits/{outfit.id}", headers=_headers(bea))).json()
        signed = card["items"][0]["thumbnail_url"]
        assert (await client.get(signed)).status_code == 200

        # The item itself stays owner-only.
        assert (
            await client.get(f"{API}/items/{item.id}", headers=_headers(bea))
        ).status_code == 404

    async def test_owner_detail_hides_friend_reactions_from_family_field(
        self, client, db_session, ana, bea
    ):
        await _befriend(client, ana, bea)
        outfit, _ = await _make_outfit(db_session, ana, OutfitVisibility.friends)
        await client.put(
            f"{API}/social/outfits/{outfit.id}/reaction",
            json={"comment": "¡Qué bonito!"},
            headers=_headers(bea),
        )
        detail = (await client.get(f"{API}/outfits/{outfit.id}", headers=_headers(ana))).json()
        assert detail["family_ratings"] is None
        # Only the owner can list reactions.
        r = await client.get(f"{API}/social/outfits/{outfit.id}/reactions", headers=_headers(bea))
        assert r.status_code == 404


# -- Reactions & notifications -------------------------------------------------------------------


class TestReactions:
    async def test_react_list_and_badge(self, client, db_session, ana, bea):
        await _befriend(client, ana, bea)
        outfit, _ = await _make_outfit(db_session, ana, OutfitVisibility.friends)

        r = await client.put(
            f"{API}/social/outfits/{outfit.id}/reaction",
            json={"rating": 5, "comment": "  Me encanta  "},
            headers=_headers(bea),
        )
        assert r.status_code == 200, r.text
        card = r.json()
        assert card["reaction_count"] == 1
        assert card["my_reaction"] == {"rating": 5, "comment": "Me encanta"}

        # Owner can't react to their own outfit.
        r = await client.put(
            f"{API}/social/outfits/{outfit.id}/reaction", json={}, headers=_headers(ana)
        )
        assert r.status_code == 400

        reactions = (
            await client.get(f"{API}/social/outfits/{outfit.id}/reactions", headers=_headers(ana))
        ).json()
        assert reactions[0]["user"]["username"] == bea.username
        assert reactions[0]["comment"] == "Me encanta"

        s = (await client.get(f"{API}/friends/summary", headers=_headers(ana))).json()
        assert s["new_reactions"] == 1
        activity = (await client.get(f"{API}/social/activity", headers=_headers(ana))).json()
        assert activity[0]["is_new"] is True
        assert (
            await client.post(f"{API}/social/activity/seen", headers=_headers(ana))
        ).status_code == 204
        s = (await client.get(f"{API}/friends/summary", headers=_headers(ana))).json()
        assert s["new_reactions"] == 0

        r = await client.delete(f"{API}/social/outfits/{outfit.id}/reaction", headers=_headers(bea))
        assert r.json()["reaction_count"] == 0

    async def test_profile_relations(self, client, ana, bea):
        p = (await client.get(f"{API}/social/users/{bea.username}", headers=_headers(ana))).json()
        assert p["relation"] == "none"
        assert set(p["user"].keys()) == {
            "username",
            "display_name",
            "avatar_url",
            "avatar_thumb_url",
            "bio",
        }
        await client.post(
            f"{API}/friends/requests", json={"username": bea.username}, headers=_headers(ana)
        )
        p = (await client.get(f"{API}/social/users/{bea.username}", headers=_headers(ana))).json()
        assert p["relation"] == "outgoing"
        p = (await client.get(f"{API}/social/users/{ana.username}", headers=_headers(bea))).json()
        assert p["relation"] == "incoming"
        me = (await client.get(f"{API}/social/users/{ana.username}", headers=_headers(ana))).json()
        assert me["is_me"] is True
        assert (await client.get(f"{API}/social/users/{bea.username}")).status_code == 401


@pytest.mark.parametrize("visibility", ["private", "friends", "public"])
async def test_studio_create_accepts_visibility(client, db_session, ana, visibility):
    _, item = await _make_outfit(db_session, ana)
    r = await client.post(
        f"{API}/outfits/studio",
        json={"items": [str(item.id)], "occasion": "casual", "visibility": visibility},
        headers=_headers(ana),
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["visibility"] == visibility
    assert (body["shared_at"] is None) == (visibility == "private")
