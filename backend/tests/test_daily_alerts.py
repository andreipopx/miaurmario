"""The two daily alerts: «Tu look de la mañana» and «Movimiento de amigos».

Covers the parts that are easy to get wrong: matching a local clock time in
different timezones, never notifying twice for the same day, batching a whole
day of friend activity into one message, staying silent when there is nothing
to say (or nothing to wear), and the unsubscribe link in the emails.
"""

from datetime import UTC, date, datetime, time, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import create_access_token
from app.config import get_settings
from app.models import ClothingItem, Friendship, FriendshipStatus, Outfit, OutfitItem, User
from app.models.item import ItemStatus
from app.models.notification import (
    EVENT_DEFAULTS,
    TIMED_EVENT_DEFAULT_TIME,
    Notification,
    NotificationPreference,
    PushSubscription,
)
from app.models.outfit import OutfitRating, OutfitStatus, OutfitVisibility, RatingScope
from app.services import daily_alerts, event_notifications, web_push
from app.services.daily_alerts import (
    FriendActivity,
    friend_activity_lines,
    morning_look_line,
    send_friend_activity,
    send_morning_look,
    weather_phrase,
)
from app.utils.unsubscribe import make_unsubscribe_token, read_unsubscribe_token
from app.workers.notifications import due_daily_alerts, local_time_matches

API = "/api/v1"
FCM = "https://fcm.googleapis.com/fcm/send/"
KEYS = {"p256dh": "B" + "x" * 86, "auth": "a" * 22}


# -- Fixtures ----------------------------------------------------------------------


async def _make_user(db: AsyncSession, *, timezone: str = "UTC", username: str = "u") -> User:
    uid = uuid4()
    user = User(
        id=uid,
        external_id=f"alerts-{uid}",
        email=f"alerts-{uid}@example.com",
        username=f"{username}_{uid.hex[:6]}",
        display_name="Alerts User",
        timezone=timezone,
        is_active=True,
        onboarding_completed=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


def _item(user_id, type_: str, name: str | None = None) -> ClothingItem:
    return ClothingItem(
        id=uuid4(),
        user_id=user_id,
        type=type_,
        name=name or type_,
        image_path=f"{user_id}/{uuid4().hex}.jpg",
        status=ItemStatus.ready,
        primary_color="black",
        formality="casual",
        wear_count=0,
        wears_since_wash=0,
        needs_wash=False,
        is_archived=False,
    )


async def _wardrobe(db: AsyncSession, user: User) -> None:
    db.add_all(
        [
            _item(user.id, "shirt", "Jersey de lana"),
            _item(user.id, "pants", "Vaqueros"),
            _item(user.id, "boots", "Botas"),
            _item(user.id, "jacket", "Chubasquero"),
        ]
    )
    await db.commit()


async def _prefs(db: AsyncSession, user: User, **values) -> NotificationPreference:
    pref = NotificationPreference(user_id=user.id, **values)
    db.add(pref)
    await db.commit()
    return pref


@pytest.fixture
def sent_emails(monkeypatch) -> list[dict]:
    sent: list[dict] = []

    async def fake_send_email(to, email, *, headers=None):
        sent.append({"to": to, "email": email, "headers": headers or {}})
        return "resend"

    monkeypatch.setattr(event_notifications, "send_email", fake_send_email)
    monkeypatch.setattr(event_notifications, "email_delivery_available", lambda: True)
    return sent


@pytest.fixture
def no_email(monkeypatch) -> None:
    monkeypatch.setattr(event_notifications, "email_delivery_available", lambda: False)


@pytest.fixture
def vapid(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "vapid_public_key", "BPublicKeyForTests")
    monkeypatch.setattr(settings, "vapid_private_key", "private-key-for-tests")
    return settings


@pytest.fixture
def pushes(monkeypatch) -> list[str]:
    """Captured push payloads (JSON strings); the transport never leaves the process."""
    sent: list[str] = []

    def fake_send(sub, data, ttl):
        sent.append(data)
        return 201

    monkeypatch.setattr(web_push, "_send_one_sync", fake_send)
    return sent


async def _subscribe_push(db: AsyncSession, user: User) -> None:
    db.add(
        PushSubscription(
            user_id=user.id, endpoint=FCM + uuid4().hex, p256dh=KEYS["p256dh"], auth=KEYS["auth"]
        )
    )
    await db.commit()


# -- The one-line copy --------------------------------------------------------------


class TestMorningLookLine:
    def _outfit(self, names: list[str], weather: dict | None) -> SimpleNamespace:
        items = [
            SimpleNamespace(position=n, item=SimpleNamespace(name=name, type="shirt"))
            for n, name in enumerate(names)
        ]
        return SimpleNamespace(items=items, weather_data=weather)

    def test_weather_and_pieces(self):
        outfit = self._outfit(
            ["Vaqueros", "Jersey de lana", "Botas"],
            {"temperature": 9.4, "condition_code": 61, "condition_label": "Lluvia"},
        )
        assert morning_look_line(outfit) == "9 °C y lluvia: vaqueros, jersey de lana y botas"

    def test_without_weather_it_is_just_the_look(self):
        assert morning_look_line(self._outfit(["Vaqueros", "Botas"], None)) == "vaqueros y botas"

    def test_a_shouty_brand_keeps_its_capitals(self):
        line = morning_look_line(self._outfit(["NIKE air", "Botas"], None))
        assert line == "NIKE air y botas"

    def test_unknown_weather_is_not_mentioned(self):
        assert weather_phrase({"condition_code": 12345}) == ""
        assert weather_phrase(None) == ""

    def test_temperature_alone(self):
        assert weather_phrase({"temperature": -1.2}) == "-1 °C"


class TestFriendActivityLines:
    def test_one_of_each(self):
        lines = friend_activity_lines(FriendActivity(reacted=["lucia"], shared=["ana"]))
        assert lines == ["@lucia ha reaccionado a tu look", "@ana ha compartido el suyo"]

    def test_several_people(self):
        lines = friend_activity_lines(
            FriendActivity(reacted=["lucia", "ana"], shared=["lucia", "ana"])
        )
        assert lines[0] == "@lucia y @ana han reaccionado a tu look"
        assert lines[1] == "@lucia y @ana han compartido los suyos"

    def test_long_lists_are_cut(self):
        lines = friend_activity_lines(FriendActivity(reacted=["a", "b", "c", "d", "e"]))
        assert lines == ["@a, @b, @c y 2 más han reaccionado a tu look"]

    def test_nothing_at_all(self):
        assert friend_activity_lines(FriendActivity()) == []
        assert FriendActivity().empty


# -- Scheduling: the time is the user's own clock ------------------------------------


class TestLocalTimeMatch:
    @pytest.mark.parametrize("minute", [29, 30, 31])
    def test_within_a_minute_either_side(self, minute):
        now = datetime(2026, 1, 15, 7, minute, tzinfo=UTC)
        assert local_time_matches(time(7, 30), now)

    @pytest.mark.parametrize("minute", [27, 33])
    def test_outside_the_window(self, minute):
        now = datetime(2026, 1, 15, 7, minute, tzinfo=UTC)
        assert not local_time_matches(time(7, 30), now)


class TestDueDailyAlerts:
    async def test_same_instant_is_due_in_madrid_only(self, db_session: AsyncSession):
        madrid = await _make_user(db_session, timezone="Europe/Madrid")
        new_york = await _make_user(db_session, timezone="America/New_York")
        for user in (madrid, new_york):
            await _prefs(db_session, user, push_morning_look=True, push_friend_activity=False)

        # 06:30 UTC in January is 07:30 in Madrid and 01:30 in New York.
        now = datetime(2026, 1, 15, 6, 30, tzinfo=UTC)
        due = await due_daily_alerts(db_session, now)
        assert ("morning_look", madrid.id, date(2026, 1, 15)) in due
        assert not [d for d in due if d[1] == new_york.id]

        # Six hours later it is 07:30 in New York (and 13:30 in Madrid).
        due = await due_daily_alerts(db_session, now + timedelta(hours=6))
        assert ("morning_look", new_york.id, date(2026, 1, 15)) in due
        assert not [d for d in due if d[1] == madrid.id]

    async def test_summer_time_uses_the_real_offset(self, db_session: AsyncSession):
        madrid = await _make_user(db_session, timezone="Europe/Madrid")
        await _prefs(db_session, madrid, push_morning_look=True, push_friend_activity=False)
        # In July Madrid is UTC+2, so 07:30 local is 05:30 UTC — not 06:30.
        july = datetime(2026, 7, 15, 5, 30, tzinfo=UTC)
        assert ("morning_look", madrid.id, date(2026, 7, 15)) in await due_daily_alerts(
            db_session, july
        )
        assert not [
            d
            for d in await due_daily_alerts(db_session, july + timedelta(hours=1))
            if d[1] == madrid.id
        ]

    async def test_the_local_day_crosses_midnight(self, db_session: AsyncSession):
        auckland = await _make_user(db_session, timezone="Pacific/Auckland")
        await _prefs(db_session, auckland, push_morning_look=True, push_friend_activity=False)
        # 18:30 UTC on the 14th is 07:30 on the 15th in Auckland.
        due = await due_daily_alerts(db_session, datetime(2026, 1, 14, 18, 30, tzinfo=UTC))
        assert ("morning_look", auckland.id, date(2026, 1, 15)) in due

    async def test_user_without_a_row_gets_the_evening_digest_only(self, db_session: AsyncSession):
        user = await _make_user(db_session, timezone="UTC")
        morning = await due_daily_alerts(db_session, datetime(2026, 1, 15, 7, 30, tzinfo=UTC))
        assert not [d for d in morning if d[1] == user.id]
        evening = await due_daily_alerts(db_session, datetime(2026, 1, 15, 20, 0, tzinfo=UTC))
        assert ("friend_activity", user.id, date(2026, 1, 15)) in evening

    async def test_both_channels_off_is_never_due(self, db_session: AsyncSession):
        user = await _make_user(db_session)
        await _prefs(
            db_session,
            user,
            push_friend_activity=False,
            email_friend_activity=False,
            push_morning_look=False,
            email_morning_look=False,
        )
        due = await due_daily_alerts(db_session, datetime(2026, 1, 15, 20, 0, tzinfo=UTC))
        assert not [d for d in due if d[1] == user.id]

    async def test_a_custom_time_is_honoured(self, db_session: AsyncSession):
        user = await _make_user(db_session)
        await _prefs(
            db_session,
            user,
            push_morning_look=True,
            morning_look_time=time(6, 15),
            push_friend_activity=False,
        )
        due = await due_daily_alerts(db_session, datetime(2026, 1, 15, 6, 15, tzinfo=UTC))
        assert ("morning_look", user.id, date(2026, 1, 15)) in due

    async def test_an_inactive_user_is_left_alone(self, db_session: AsyncSession):
        user = await _make_user(db_session)
        await _prefs(db_session, user, push_morning_look=True)
        user.is_active = False
        await db_session.commit()
        due = await due_daily_alerts(db_session, datetime(2026, 1, 15, 7, 30, tzinfo=UTC))
        assert not [d for d in due if d[1] == user.id]


# -- «Tu look de la mañana» ---------------------------------------------------------


TODAY = date(2026, 1, 15)


@pytest_asyncio.fixture
async def dressed_user(db_session: AsyncSession) -> User:
    user = await _make_user(db_session)
    await _wardrobe(db_session, user)
    await _prefs(db_session, user, email_morning_look=True, push_morning_look=True)
    return user


class TestMorningLook:
    async def test_sends_one_line_by_email_and_push(
        self, db_session: AsyncSession, dressed_user: User, sent_emails, vapid, pushes
    ):
        await _subscribe_push(db_session, dressed_user)
        result = await send_morning_look(db_session, dressed_user.id, TODAY)
        await db_session.commit()

        assert result["status"] == "sent"
        assert set(result["channels"]) == {"account_email", "web_push"}
        assert len(sent_emails) == 1 and len(pushes) == 1
        assert "Tu look de la mañana" in pushes[0]
        # The email carries the one-click unsubscribe for this event only.
        token = sent_emails[0]["headers"]["List-Unsubscribe"].split("token=")[1].rstrip(">")
        assert read_unsubscribe_token(token) == (dressed_user.id, "morning_look")

        rows = (
            (
                await db_session.execute(
                    select(Notification).where(Notification.user_id == dressed_user.id)
                )
            )
            .scalars()
            .all()
        )
        assert {r.channel for r in rows} == {"account_email", "web_push"}
        assert all(r.payload["day"] == TODAY.isoformat() for r in rows)
        assert rows[0].payload["line"]

    async def test_never_twice_for_the_same_day(
        self, db_session: AsyncSession, dressed_user: User, sent_emails
    ):
        first = await send_morning_look(db_session, dressed_user.id, TODAY)
        await db_session.commit()
        assert first["status"] == "sent"

        # A retried worker job (same user, same day) must be a no-op.
        again = await send_morning_look(db_session, dressed_user.id, TODAY)
        await db_session.commit()
        assert again == {"status": "skipped", "reason": "already_sent"}
        assert len(sent_emails) == 1

        # Tomorrow is a different day and goes out normally.
        tomorrow = await send_morning_look(db_session, dressed_user.id, TODAY + timedelta(days=1))
        await db_session.commit()
        assert tomorrow["status"] == "sent"
        assert len(sent_emails) == 2

    async def test_an_empty_wardrobe_says_nothing(
        self, db_session: AsyncSession, sent_emails, vapid, pushes
    ):
        user = await _make_user(db_session)
        db_session.add(_item(user.id, "shirt"))
        await db_session.commit()
        await _prefs(db_session, user, email_morning_look=True, push_morning_look=True)
        await _subscribe_push(db_session, user)

        result = await send_morning_look(db_session, user.id, TODAY)
        await db_session.commit()

        assert result == {"status": "skipped", "reason": "wardrobe_too_small"}
        assert sent_emails == [] and pushes == []
        assert (
            not (
                await db_session.execute(
                    select(Outfit).where(Outfit.user_id == user.id, Outfit.scheduled_for == TODAY)
                )
            )
            .scalars()
            .all()
        )

    async def test_an_accepted_look_is_left_alone(
        self, db_session: AsyncSession, dressed_user: User, sent_emails
    ):
        outfit = Outfit(
            user_id=dressed_user.id,
            occasion="casual",
            scheduled_for=TODAY,
            moment_order=0,
            status=OutfitStatus.accepted,
        )
        db_session.add(outfit)
        await db_session.commit()

        result = await send_morning_look(db_session, dressed_user.id, TODAY)
        await db_session.commit()
        assert result == {"status": "skipped", "reason": "already_decided"}
        assert sent_emails == []

    async def test_a_pending_look_is_re_sent_not_regenerated(
        self, db_session: AsyncSession, dressed_user: User, sent_emails
    ):
        item = (
            (
                await db_session.execute(
                    select(ClothingItem).where(ClothingItem.user_id == dressed_user.id).limit(1)
                )
            )
            .scalars()
            .one()
        )
        outfit = Outfit(
            user_id=dressed_user.id,
            occasion="casual",
            scheduled_for=TODAY,
            moment_order=0,
            status=OutfitStatus.pending,
        )
        db_session.add(outfit)
        await db_session.flush()
        db_session.add(OutfitItem(outfit_id=outfit.id, item_id=item.id, position=0))
        await db_session.commit()

        result = await send_morning_look(db_session, dressed_user.id, TODAY)
        await db_session.commit()
        assert result["outfit_id"] == str(outfit.id)
        count = (
            (
                await db_session.execute(
                    select(Outfit).where(
                        Outfit.user_id == dressed_user.id, Outfit.scheduled_for == TODAY
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(count) == 1

    async def test_off_by_default(self, db_session: AsyncSession, sent_emails, vapid, pushes):
        """A user who never touched Notificaciones gets no morning look."""
        user = await _make_user(db_session)
        await _wardrobe(db_session, user)
        await _subscribe_push(db_session, user)

        result = await send_morning_look(db_session, user.id, TODAY)
        await db_session.commit()
        assert result == {"status": "skipped", "reason": "no_channel"}
        assert sent_emails == [] and pushes == []


# -- «Movimiento de amigos» ---------------------------------------------------------


@pytest_asyncio.fixture
async def social_circle(db_session: AsyncSession) -> tuple[User, User, User]:
    """me, plus two friends called lucia and ana."""
    me = await _make_user(db_session, username="me")
    lucia = await _make_user(db_session, username="lucia")
    ana = await _make_user(db_session, username="ana")
    for friend in (lucia, ana):
        db_session.add(
            Friendship(
                requester_id=me.id,
                addressee_id=friend.id,
                status=FriendshipStatus.accepted,
                accepted_at=datetime.now(UTC),
            )
        )
    await _prefs(db_session, me, email_friend_activity=True, push_friend_activity=True)
    await db_session.commit()
    return me, lucia, ana


async def _react(db: AsyncSession, actor: User, owner: User) -> None:
    outfit = Outfit(user_id=owner.id, occasion="casual", scheduled_for=TODAY)
    db.add(outfit)
    await db.flush()
    db.add(OutfitRating(outfit_id=outfit.id, user_id=actor.id, rating=5, scope=RatingScope.friend))
    await db.commit()


async def _share(db: AsyncSession, author: User) -> None:
    db.add(
        Outfit(
            user_id=author.id,
            occasion="casual",
            scheduled_for=TODAY,
            visibility=OutfitVisibility.friends,
            shared_at=datetime.now(UTC),
        )
    )
    await db.commit()


class TestFriendActivityDigest:
    async def test_one_message_for_the_whole_day(
        self, db_session: AsyncSession, social_circle, sent_emails, vapid, pushes
    ):
        me, lucia, ana = social_circle
        await _subscribe_push(db_session, me)
        await _react(db_session, lucia, me)
        await _react(db_session, ana, me)
        await _share(db_session, lucia)

        result = await send_friend_activity(db_session, me.id, TODAY)
        await db_session.commit()

        assert result["status"] == "sent"
        assert len(sent_emails) == 1 and len(pushes) == 1
        reacted, shared = result["lines"]
        assert "han reaccionado a tu look" in reacted
        assert f"@{lucia.username}" in reacted and f"@{ana.username}" in reacted
        assert shared == f"@{lucia.username} ha compartido el suyo"
        assert "Movimiento de amigos" in pushes[0]

    async def test_no_activity_means_no_notification(
        self, db_session: AsyncSession, social_circle, sent_emails, vapid, pushes
    ):
        me, _, _ = social_circle
        await _subscribe_push(db_session, me)

        result = await send_friend_activity(db_session, me.id, TODAY)
        await db_session.commit()

        assert result == {"status": "skipped", "reason": "no_activity"}
        assert sent_emails == [] and pushes == []
        rows = (
            (await db_session.execute(select(Notification).where(Notification.user_id == me.id)))
            .scalars()
            .all()
        )
        assert rows == []

    async def test_later_activity_waits_for_tomorrow(
        self, db_session: AsyncSession, social_circle, sent_emails
    ):
        me, lucia, ana = social_circle
        await _react(db_session, lucia, me)
        assert (await send_friend_activity(db_session, me.id, TODAY))["status"] == "sent"
        await db_session.commit()

        # More happens an hour later: it must not produce a second notification.
        await _react(db_session, ana, me)
        second = await send_friend_activity(db_session, me.id, TODAY)
        await db_session.commit()
        assert second == {"status": "skipped", "reason": "already_sent"}
        assert len(sent_emails) == 1

    async def test_the_batching_window_holds_across_days(
        self, db_session: AsyncSession, social_circle, sent_emails
    ):
        """A digest sent a few hours ago blocks one filed under tomorrow's date."""
        me, lucia, _ = social_circle
        await _react(db_session, lucia, me)
        assert (await send_friend_activity(db_session, me.id, TODAY))["status"] == "sent"
        await db_session.commit()

        result = await send_friend_activity(db_session, me.id, TODAY + timedelta(days=1))
        await db_session.commit()
        assert result == {"status": "skipped", "reason": "batched_today"}
        assert len(sent_emails) == 1

    async def test_the_next_digest_only_covers_what_is_new(
        self, db_session: AsyncSession, social_circle, sent_emails
    ):
        me, lucia, ana = social_circle
        await _react(db_session, lucia, me)
        await send_friend_activity(db_session, me.id, TODAY)
        await db_session.commit()

        # Wind yesterday back: the reaction, then the digest that reported it.
        for rating in (
            (await db_session.execute(select(OutfitRating).where(OutfitRating.user_id == lucia.id)))
            .scalars()
            .all()
        ):
            rating.updated_at = datetime.now(UTC) - timedelta(hours=25)
        for row in (
            (await db_session.execute(select(Notification).where(Notification.user_id == me.id)))
            .scalars()
            .all()
        ):
            row.created_at = datetime.now(UTC) - timedelta(hours=23)
        await db_session.commit()
        await _react(db_session, ana, me)

        result = await send_friend_activity(db_session, me.id, TODAY + timedelta(days=1))
        await db_session.commit()
        assert result["status"] == "sent"
        [line] = result["lines"]
        assert line == f"@{ana.username} ha reaccionado a tu look"

    async def test_push_only_by_default(self, db_session: AsyncSession, sent_emails, vapid, pushes):
        """No preferences row: the digest buzzes the phone but never mails."""
        me = await _make_user(db_session, username="me")
        lucia = await _make_user(db_session, username="lucia")
        db_session.add(
            Friendship(requester_id=me.id, addressee_id=lucia.id, status=FriendshipStatus.accepted)
        )
        await db_session.commit()
        await _subscribe_push(db_session, me)
        await _share(db_session, lucia)

        result = await send_friend_activity(db_session, me.id, TODAY)
        await db_session.commit()
        assert result["channels"] == ["web_push"]
        assert sent_emails == [] and len(pushes) == 1

    async def test_own_reactions_do_not_count(
        self, db_session: AsyncSession, social_circle, sent_emails
    ):
        me, _, _ = social_circle
        await _react(db_session, me, me)
        result = await send_friend_activity(db_session, me.id, TODAY)
        await db_session.commit()
        assert result == {"status": "skipped", "reason": "no_activity"}


# -- Preferences API and unsubscribe -------------------------------------------------


class TestPreferencesAPI:
    async def test_defaults_are_the_documented_ones(
        self, client: AsyncClient, test_user: User, auth_headers
    ):
        body = (await client.get(f"{API}/notifications/preferences", headers=auth_headers)).json()
        assert body["email"]["morning_look"] is False
        assert body["push"]["morning_look"] is False
        assert body["email"]["friend_activity"] is False
        assert body["push"]["friend_activity"] is True
        assert body["morning_look_time"] == "07:30"
        assert body["friend_activity_time"] == "20:00"
        assert EVENT_DEFAULTS["morning_look"] == {"email": False, "push": False}
        assert EVENT_DEFAULTS["friend_activity"] == {"email": False, "push": True}
        assert TIMED_EVENT_DEFAULT_TIME["morning_look"] == time(7, 30)

    async def test_turn_the_morning_look_on_with_a_time(
        self, client: AsyncClient, db_session: AsyncSession, test_user: User, auth_headers
    ):
        resp = await client.patch(
            f"{API}/notifications/preferences",
            json={"push": {"morning_look": True}, "morning_look_time": "06:45"},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["push"]["morning_look"] is True
        assert resp.json()["morning_look_time"] == "06:45"
        pref = await db_session.get(NotificationPreference, test_user.id, populate_existing=True)
        assert pref.morning_look_time == time(6, 45)
        # Untouched events keep their own defaults.
        assert pref.email_friend_request is True and pref.email_morning_look is False

    async def test_a_bogus_time_is_refused(self, client: AsyncClient, auth_headers):
        resp = await client.patch(
            f"{API}/notifications/preferences",
            json={"friend_activity_time": "25:99"},
            headers=auth_headers,
        )
        assert resp.status_code == 422


class TestUnsubscribe:
    @pytest.mark.parametrize("event", ["morning_look", "friend_activity"])
    async def test_one_click_turns_that_email_off(
        self, client: AsyncClient, db_session: AsyncSession, test_user: User, event: str
    ):
        # Opt in first, so there is something to switch off.
        await client.patch(
            f"{API}/notifications/preferences",
            json={"email": {event: True}},
            headers={"Authorization": f"Bearer {create_access_token(test_user.external_id)}"},
        )
        token = make_unsubscribe_token(test_user.id, event)
        resp = await client.post(f"{API}/notifications/unsubscribe", json={"token": token})
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"scope": event, "subscribed": False}

        pref = await db_session.get(NotificationPreference, test_user.id, populate_existing=True)
        assert getattr(pref, f"email_{event}") is False
        # Push is untouched: unsubscribing is about email only.
        assert pref.push_friend_activity is True

    async def test_unsubscribed_user_gets_no_morning_email(
        self, db_session: AsyncSession, sent_emails
    ):
        user = await _make_user(db_session)
        await _wardrobe(db_session, user)
        await _prefs(db_session, user, email_morning_look=False, push_morning_look=False)
        result = await send_morning_look(db_session, user.id, TODAY)
        await db_session.commit()
        assert result == {"status": "skipped", "reason": "no_channel"}
        assert sent_emails == []


class TestWorkerRegistry:
    def test_the_alert_jobs_are_registered(self):
        from app.workers.worker import WorkerSettings

        names = {f.__name__ for f in WorkerSettings.functions}
        assert {"send_morning_look", "send_friend_activity"} <= names
        assert set(daily_alerts.MORNING_LOOK_EVENT.split()) == {"morning_look"}
