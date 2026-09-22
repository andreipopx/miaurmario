"""Social layer API: friends, friends' feed, profiles and reactions.

Privacy rules (enforced here and in `app.services.access_control`):
- Other users are only ever exposed as username / display name / avatar / bio
  (never email, id-based lookups or family data).
- Anything outfit-related goes through `can_view_outfit_socially`; denials are 404.
- Item image URLs are signed only for outfits that passed that check.
- A user who blocked you is indistinguishable from a user that does not exist.
"""

from datetime import UTC, date, datetime, time
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field, computed_field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.friendship import Friendship, FriendshipStatus
from app.models.outfit import Outfit, OutfitItem, OutfitRating, OutfitVisibility, RatingScope
from app.models.user import User
from app.services.access_control import (
    accepted_friend_ids,
    are_friends,
    can_view_outfit_socially,
    get_friendship_between,
)
from app.services.friendship_service import (
    FriendshipError,
    FriendshipService,
    Relation,
    relation_for,
)
from app.services.social_service import (
    SOCIAL_SCOPES,
    InvalidCursorError,
    ReactionStats,
    feed_day,
    list_feed_groups,
    list_shared_outfits,
    my_reactions,
    reaction_stats,
    unseen_reaction_count,
)
from app.utils.auth import get_current_user
from app.utils.rate_limit import rate_limit_by_user
from app.utils.signed_urls import sign_image_url

USERNAME_PATTERN = r"^[A-Za-z0-9_]{3,20}$"

friends_router = APIRouter(prefix="/friends", tags=["Friends"])
social_router = APIRouter(prefix="/social", tags=["Social"])

CurrentUser = Annotated[User, Depends(get_current_user)]
Db = Annotated[AsyncSession, Depends(get_db)]


# -- Schemas ---------------------------------------------------------------------


class PublicUser(BaseModel):
    """The only fields of another user the social layer ever returns."""

    username: str
    display_name: str
    avatar_url: str | None = None
    bio: str | None = None


def public_user(user: User) -> PublicUser:
    return PublicUser(
        username=user.username or "",
        # Social surfaces show only the @handle: display_name defaulted to the
        # email's local part, which must never leak to other users.
        display_name=user.username or "",
        avatar_url=user.avatar_url,
        bio=user.bio,
    )


class FriendshipOut(BaseModel):
    id: UUID
    relation: Relation
    user: PublicUser
    created_at: datetime
    accepted_at: datetime | None = None


class FriendsOverview(BaseModel):
    friends: list[FriendshipOut]
    incoming: list[FriendshipOut]
    outgoing: list[FriendshipOut]
    blocked: list[FriendshipOut]


class UsernameBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(pattern=USERNAME_PATTERN)


class SearchResult(BaseModel):
    user: PublicUser
    relation: Relation
    friendship_id: UUID | None = None


class SocialSummary(BaseModel):
    pending_requests: int
    new_reactions: int
    total: int


class SocialOutfitItem(BaseModel):
    id: UUID
    type: str
    subtype: str | None = None
    name: str | None = None
    primary_color: str | None = None
    image_path: str | None = Field(default=None, exclude=True)
    thumbnail_path: str | None = Field(default=None, exclude=True)
    position: int
    pos_x: float | None = None
    pos_y: float | None = None
    scale: float = 1.0
    rotation: float = 0.0
    z_index: int = 0

    @computed_field
    @property
    def image_url(self) -> str | None:
        return sign_image_url(self.image_path) if self.image_path else None

    @computed_field
    @property
    def thumbnail_url(self) -> str | None:
        return sign_image_url(self.thumbnail_path) if self.thumbnail_path else None


class MyReaction(BaseModel):
    rating: int
    comment: str | None = None


class SocialOutfit(BaseModel):
    id: UUID
    author: PublicUser
    is_mine: bool
    name: str | None = None
    occasion: str
    scheduled_for: date | None = None
    visibility: OutfitVisibility
    shared_at: datetime | None = None
    day: date | None = None
    # When it was accepted (or created): the order of looks inside a day.
    worn_order_at: datetime | None = None
    # Day moment ("Momentos del día"): which look of the day this is.
    moment_order: int = 0
    moment_label: str | None = None
    moment_time: time | None = None
    items: list[SocialOutfitItem]
    reaction_count: int = 0
    comment_count: int = 0
    my_reaction: MyReaction | None = None


class SocialOutfitPage(BaseModel):
    items: list[SocialOutfit]
    next_cursor: str | None = None


class FeedDayGroup(BaseModel):
    """One friend's shared looks for one day (a card with a carousel)."""

    author: PublicUser
    day: date
    last_shared_at: datetime
    outfits: list[SocialOutfit]


class FeedPage(BaseModel):
    groups: list[FeedDayGroup]
    next_cursor: str | None = None


class ProfileOut(BaseModel):
    user: PublicUser
    relation: Relation
    friendship_id: UUID | None = None
    is_me: bool = False
    friend_count: int | None = None


class ReactionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rating: int = Field(default=5, ge=1, le=5)
    comment: str | None = Field(default=None, max_length=500)


class ReactionOut(BaseModel):
    id: UUID
    user: PublicUser
    rating: int
    comment: str | None = None
    created_at: datetime
    updated_at: datetime | None = None


class ActivityOut(BaseModel):
    id: UUID
    outfit_id: UUID
    outfit_name: str | None = None
    outfit_occasion: str
    outfit_thumbnail_url: str | None = None
    user: PublicUser
    rating: int
    comment: str | None = None
    updated_at: datetime | None = None
    is_new: bool = False


# -- Helpers ----------------------------------------------------------------------


def _not_found(detail: str = "not_found") -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def _raise_friendship(exc: FriendshipError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.code)


def _friendship_out(f: Friendship, me: User) -> FriendshipOut:
    other = f.addressee if f.requester_id == me.id else f.requester
    return FriendshipOut(
        id=f.id,
        relation=relation_for(f, me.id),
        user=public_user(other),
        created_at=f.created_at,
        accepted_at=f.accepted_at,
    )


def _to_social_outfit(
    outfit: Outfit,
    me: User,
    stats: dict[UUID, ReactionStats],
    mine: dict[UUID, OutfitRating],
) -> SocialOutfit:
    items = [
        SocialOutfitItem(
            id=oi.item.id,
            type=oi.item.type,
            subtype=oi.item.subtype,
            name=oi.item.name,
            primary_color=oi.item.primary_color,
            image_path=oi.item.image_path,
            thumbnail_path=oi.item.thumbnail_path,
            position=oi.position,
            pos_x=oi.pos_x,
            pos_y=oi.pos_y,
            scale=oi.scale if oi.scale is not None else 1.0,
            rotation=oi.rotation if oi.rotation is not None else 0.0,
            z_index=oi.z_index if oi.z_index is not None else 0,
        )
        for oi in sorted(outfit.items, key=lambda x: x.position)
        if oi.item is not None
    ]
    st = stats.get(outfit.id, ReactionStats())
    r = mine.get(outfit.id)
    return SocialOutfit(
        id=outfit.id,
        author=public_user(outfit.user),
        is_mine=outfit.user_id == me.id,
        name=outfit.name,
        occasion=outfit.occasion,
        scheduled_for=outfit.scheduled_for,
        visibility=outfit.visibility,
        shared_at=outfit.shared_at,
        day=feed_day(outfit),
        worn_order_at=outfit.responded_at or outfit.created_at,
        moment_order=outfit.moment_order or 0,
        moment_label=outfit.moment_label,
        moment_time=outfit.moment_time,
        items=items,
        reaction_count=st.count,
        comment_count=st.comment_count,
        my_reaction=MyReaction(rating=r.rating, comment=r.comment) if r else None,
    )


async def _page(
    db: AsyncSession, me: User, outfits: list[Outfit], next_cursor: str | None
) -> SocialOutfitPage:
    ids = [o.id for o in outfits]
    stats = await reaction_stats(db, ids)
    mine = await my_reactions(db, me.id, ids)
    return SocialOutfitPage(
        items=[_to_social_outfit(o, me, stats, mine) for o in outfits], next_cursor=next_cursor
    )


async def _visible_profile_user(db: AsyncSession, me: User, username: str) -> User:
    """Active user by username, 404 if missing, username-less, or they blocked me."""
    target = await FriendshipService(db).get_active_by_username(username)
    if target is None:
        raise _not_found("user_not_found")
    if target.id != me.id:
        f = await get_friendship_between(db, me.id, target.id)
        if f and f.status == FriendshipStatus.blocked and f.requester_id != me.id:
            raise _not_found("user_not_found")
    return target


async def _load_visible_outfit(db: AsyncSession, me: User, outfit_id: UUID) -> Outfit:
    outfit = (
        await db.execute(
            select(Outfit)
            .where(Outfit.id == outfit_id)
            .options(
                selectinload(Outfit.items).selectinload(OutfitItem.item),
                selectinload(Outfit.user),
            )
        )
    ).scalar_one_or_none()
    if outfit is None or not await can_view_outfit_socially(db, me, outfit):
        raise _not_found("outfit_not_found")
    return outfit


# -- Friends ------------------------------------------------------------------------


@friends_router.get("", response_model=FriendsOverview)
async def list_friends(db: Db, me: CurrentUser) -> FriendsOverview:
    overview = FriendsOverview(friends=[], incoming=[], outgoing=[], blocked=[])
    for f in await FriendshipService(db).list_for(me):
        out = _friendship_out(f, me)
        if out.relation == "friends":
            overview.friends.append(out)
        elif out.relation == "incoming":
            overview.incoming.append(out)
        elif out.relation == "outgoing":
            overview.outgoing.append(out)
        elif out.relation == "blocked":
            overview.blocked.append(out)
    overview.friends.sort(key=lambda o: o.user.display_name.lower())
    return overview


@friends_router.get("/search", response_model=list[SearchResult])
async def search_users(
    db: Db,
    me: CurrentUser,
    q: Annotated[str, Query(min_length=2, max_length=20)],
) -> list[SearchResult]:
    """Username prefix search (exact match first). Rate-limited to limit enumeration."""
    await rate_limit_by_user(me.id, "friend_search", 30, 60)
    query = q.strip().lstrip("@").lower()
    if len(query) < 2 or not all(c.isalnum() or c == "_" for c in query):
        return []
    stmt = (
        select(User)
        .where(
            User.username.is_not(None),
            User.username.startswith(query, autoescape=True),
            User.is_active.is_(True),
            User.id != me.id,
        )
        .order_by((User.username == query).desc(), User.username)
        .limit(15)
    )
    users = list((await db.execute(stmt)).scalars().all())
    results: list[SearchResult] = []
    for u in users:
        f = await get_friendship_between(db, me.id, u.id)
        if f and f.status == FriendshipStatus.blocked:
            continue  # hide both "I blocked" and "blocked me"
        results.append(
            SearchResult(
                user=public_user(u),
                relation=relation_for(f, me.id),
                friendship_id=f.id if f else None,
            )
        )
        if len(results) >= 10:
            break
    return results


@friends_router.get("/summary", response_model=SocialSummary)
async def social_summary(db: Db, me: CurrentUser) -> SocialSummary:
    """Counts for the in-app badge: pending incoming requests + new reactions."""
    pending = await FriendshipService(db).pending_incoming_count(me)
    reactions = await unseen_reaction_count(db, me)
    return SocialSummary(
        pending_requests=pending, new_reactions=reactions, total=pending + reactions
    )


@friends_router.post("/requests", response_model=FriendshipOut, status_code=status.HTTP_201_CREATED)
async def send_friend_request(body: UsernameBody, db: Db, me: CurrentUser) -> FriendshipOut:
    await rate_limit_by_user(me.id, "friend_request", 30, 3600)
    try:
        f = await FriendshipService(db).request(me, body.username)
    except FriendshipError as exc:
        raise _raise_friendship(exc) from exc
    await db.commit()
    await db.refresh(f, attribute_names=["requester", "addressee"])
    return _friendship_out(f, me)


@friends_router.post("/{friendship_id}/accept", response_model=FriendshipOut)
async def accept_friend_request(friendship_id: UUID, db: Db, me: CurrentUser) -> FriendshipOut:
    try:
        f = await FriendshipService(db).accept(me, friendship_id)
    except FriendshipError as exc:
        raise _raise_friendship(exc) from exc
    await db.commit()
    await db.refresh(f, attribute_names=["requester", "addressee"])
    return _friendship_out(f, me)


@friends_router.delete("/{friendship_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_friendship(friendship_id: UUID, db: Db, me: CurrentUser) -> Response:
    """Decline an incoming request, cancel an outgoing one, unfriend, or unblock."""
    try:
        await FriendshipService(db).remove(me, friendship_id)
    except FriendshipError as exc:
        raise _raise_friendship(exc) from exc
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@friends_router.post("/block", status_code=status.HTTP_204_NO_CONTENT)
async def block_user(body: UsernameBody, db: Db, me: CurrentUser) -> Response:
    await rate_limit_by_user(me.id, "friend_block", 30, 3600)
    try:
        await FriendshipService(db).block(me, body.username)
    except FriendshipError as exc:
        raise _raise_friendship(exc) from exc
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# -- Feed, profiles, outfits -------------------------------------------------------------


@social_router.get("/feed", response_model=FeedPage)
async def friends_feed(
    db: Db,
    me: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=20, description="Day groups per page")] = 8,
    cursor: Annotated[str | None, Query(max_length=300)] = None,
) -> FeedPage:
    """Friends' shared looks, one card per friend and day (newest day first).

    Inside a card the looks are in the order they were accepted/created, so a
    morning work outfit comes before the evening one.
    """
    friend_ids = await accepted_friend_ids(db, me.id)
    try:
        groups, next_cursor = await list_feed_groups(
            db,
            owner_ids=friend_ids,
            visibilities=(OutfitVisibility.friends, OutfitVisibility.public),
            limit=limit,
            cursor=cursor,
        )
    except InvalidCursorError as exc:
        raise HTTPException(status_code=400, detail="invalid_cursor") from exc
    all_outfits = [o for g in groups for o in g.outfits]
    ids = [o.id for o in all_outfits]
    stats = await reaction_stats(db, ids)
    mine = await my_reactions(db, me.id, ids)
    return FeedPage(
        groups=[
            FeedDayGroup(
                author=public_user(g.outfits[0].user),
                day=g.day,
                last_shared_at=g.last_shared_at,
                outfits=[_to_social_outfit(o, me, stats, mine) for o in g.outfits],
            )
            for g in groups
        ],
        next_cursor=next_cursor,
    )


@social_router.get("/users/{username}", response_model=ProfileOut)
async def get_profile(username: str, db: Db, me: CurrentUser) -> ProfileOut:
    """Mini-profile for /u/{username} and the friend page. Auth required (no public enumeration)."""
    await rate_limit_by_user(me.id, "profile_lookup", 60, 60)
    target = await _visible_profile_user(db, me, username)
    if target.id == me.id:
        return ProfileOut(user=public_user(target), relation="none", is_me=True)
    f = await get_friendship_between(db, me.id, target.id)
    relation = relation_for(f, me.id)
    friend_count = None
    if relation == "friends":
        friend_count = len(await accepted_friend_ids(db, target.id))
    return ProfileOut(
        user=public_user(target),
        relation=relation,
        friendship_id=f.id if f and relation != "none" else None,
        friend_count=friend_count,
    )


@social_router.get("/users/{username}/outfits", response_model=SocialOutfitPage)
async def get_profile_outfits(
    username: str,
    db: Db,
    me: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=30)] = 18,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
) -> SocialOutfitPage:
    """Outfits this user shared that I may see: friends+public if we're friends, else public."""
    target = await _visible_profile_user(db, me, username)
    if target.id == me.id or await are_friends(db, me.id, target.id):
        visibilities: tuple[OutfitVisibility, ...] = (
            OutfitVisibility.friends,
            OutfitVisibility.public,
        )
    else:
        f = await get_friendship_between(db, me.id, target.id)
        # I blocked them: show nothing until unblocked.
        blocked = f is not None and f.status == FriendshipStatus.blocked
        visibilities = () if blocked else (OutfitVisibility.public,)
    try:
        outfits, next_cursor = await list_shared_outfits(
            db, owner_ids=[target.id], visibilities=visibilities, limit=limit, cursor=cursor
        )
    except InvalidCursorError as exc:
        raise HTTPException(status_code=400, detail="invalid_cursor") from exc
    return await _page(db, me, outfits, next_cursor)


@social_router.get("/outfits/{outfit_id}", response_model=SocialOutfit)
async def get_social_outfit(outfit_id: UUID, db: Db, me: CurrentUser) -> SocialOutfit:
    outfit = await _load_visible_outfit(db, me, outfit_id)
    page = await _page(db, me, [outfit], None)
    return page.items[0]


@social_router.put("/outfits/{outfit_id}/reaction", response_model=SocialOutfit)
async def react_to_outfit(
    outfit_id: UUID, body: ReactionBody, db: Db, me: CurrentUser
) -> SocialOutfit:
    """React ("Me encanta", rating 1-5, default 5) + optional comment on a friend's shared outfit."""
    await rate_limit_by_user(me.id, "outfit_reaction", 60, 60)
    outfit = await _load_visible_outfit(db, me, outfit_id)
    if outfit.user_id == me.id:
        raise HTTPException(status_code=400, detail="cannot_react_to_own_outfit")
    scope = (
        RatingScope.friend if await are_friends(db, me.id, outfit.user_id) else RatingScope.public
    )
    comment = (body.comment or "").strip() or None
    rating = (
        await db.execute(
            select(OutfitRating).where(
                OutfitRating.outfit_id == outfit.id, OutfitRating.user_id == me.id
            )
        )
    ).scalar_one_or_none()
    if rating is None:
        rating = OutfitRating(
            outfit_id=outfit.id, user_id=me.id, rating=body.rating, comment=comment, scope=scope
        )
        db.add(rating)
    else:
        rating.rating = body.rating
        rating.comment = comment
        rating.scope = scope
        rating.updated_at = datetime.now(UTC)
    await db.commit()
    page = await _page(db, me, [outfit], None)
    return page.items[0]


@social_router.delete("/outfits/{outfit_id}/reaction", response_model=SocialOutfit)
async def remove_reaction(outfit_id: UUID, db: Db, me: CurrentUser) -> SocialOutfit:
    outfit = await _load_visible_outfit(db, me, outfit_id)
    rating = (
        await db.execute(
            select(OutfitRating).where(
                OutfitRating.outfit_id == outfit.id,
                OutfitRating.user_id == me.id,
                OutfitRating.scope.in_(SOCIAL_SCOPES),
            )
        )
    ).scalar_one_or_none()
    if rating is not None:
        await db.delete(rating)
        await db.commit()
    page = await _page(db, me, [outfit], None)
    return page.items[0]


@social_router.get("/outfits/{outfit_id}/reactions", response_model=list[ReactionOut])
async def list_reactions(outfit_id: UUID, db: Db, me: CurrentUser) -> list[ReactionOut]:
    """Owner only: every friend/public reaction on my outfit."""
    outfit = (
        await db.execute(select(Outfit).where(Outfit.id == outfit_id, Outfit.user_id == me.id))
    ).scalar_one_or_none()
    if outfit is None:
        raise _not_found("outfit_not_found")
    rows = (
        (
            await db.execute(
                select(OutfitRating)
                .where(OutfitRating.outfit_id == outfit.id, OutfitRating.scope.in_(SOCIAL_SCOPES))
                .options(selectinload(OutfitRating.user))
                .order_by(OutfitRating.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [
        ReactionOut(
            id=r.id,
            user=public_user(r.user),
            rating=r.rating,
            comment=r.comment,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rows
        if r.user is not None
    ]


@social_router.get("/activity", response_model=list[ActivityOut])
async def recent_activity(
    db: Db, me: CurrentUser, limit: Annotated[int, Query(ge=1, le=50)] = 20
) -> list[ActivityOut]:
    """Recent reactions on my outfits (newest first), flagged `is_new` since last seen."""
    rows = (
        (
            await db.execute(
                select(OutfitRating)
                .join(Outfit, Outfit.id == OutfitRating.outfit_id)
                .where(
                    Outfit.user_id == me.id,
                    OutfitRating.scope.in_(SOCIAL_SCOPES),
                    OutfitRating.user_id != me.id,
                )
                .options(
                    selectinload(OutfitRating.user),
                    selectinload(OutfitRating.outfit)
                    .selectinload(Outfit.items)
                    .selectinload(OutfitItem.item),
                )
                .order_by(OutfitRating.updated_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    seen = me.social_seen_at
    out: list[ActivityOut] = []
    for r in rows:
        if r.user is None:
            continue
        thumb = None
        first = sorted(r.outfit.items, key=lambda x: x.position)
        for oi in first:
            if oi.item is not None and oi.item.thumbnail_path:
                thumb = sign_image_url(oi.item.thumbnail_path)
                break
        out.append(
            ActivityOut(
                id=r.id,
                outfit_id=r.outfit_id,
                outfit_name=r.outfit.name,
                outfit_occasion=r.outfit.occasion,
                outfit_thumbnail_url=thumb,
                user=public_user(r.user),
                rating=r.rating,
                comment=r.comment,
                updated_at=r.updated_at,
                is_new=seen is None or (r.updated_at is not None and r.updated_at > seen),
            )
        )
    return out


@social_router.post("/activity/seen", status_code=status.HTTP_204_NO_CONTENT)
async def mark_activity_seen(db: Db, me: CurrentUser) -> Response:
    me.social_seen_at = datetime.now(UTC)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
