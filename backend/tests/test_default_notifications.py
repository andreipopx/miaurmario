"""Default notification channels: account email + Web Push, preferences,
one-click unsubscribe and friend-event dispatch."""

from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import create_access_token
from app.config import get_settings
from app.models import Friendship, FriendshipStatus, User
from app.models.notification import Notification, NotificationPreference, PushSubscription
from app.services import event_notifications, web_push
from app.services.event_notifications import notify_friendship_event
from app.utils.email_templates import render_friend_request_email
from app.utils.unsubscribe import make_unsubscribe_token, read_unsubscribe_token

API = "/api/v1"
FCM = "https://fcm.googleapis.com/fcm/send/"
KEYS = {"p256dh": "B" + "x" * 86, "auth": "a" * 22}


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.external_id)}"}


async def _make_user(db: AsyncSession, username: str | None = "u") -> User:
    uid = uuid4()
    user = User(
        id=uid,
        external_id=f"notif-{uid}",
        email=f"notif-{uid}@example.com",
        username=f"{username}_{uid.hex[:6]}" if username else None,
        display_name="Private Name",
        timezone="UTC",
        is_active=True,
        onboarding_completed=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest.fixture
def vapid(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "vapid_public_key", "BPublicKeyForTests")
    monkeypatch.setattr(settings, "vapid_private_key", "private-key-for-tests")
    return settings


@pytest.fixture
def sent_emails(monkeypatch) -> list[dict]:
    """Email transport configured and captured (no network)."""
    sent: list[dict] = []

    async def fake_send_email(to, email, *, headers=None):
        sent.append({"to": to, "email": email, "headers": headers or {}})
        return "resend"

    monkeypatch.setattr(event_notifications, "send_email", fake_send_email)
    monkeypatch.setattr(event_notifications, "email_delivery_available", lambda: True)
    return sent


@pytest.fixture
def push_statuses(monkeypatch) -> dict:
    """Push transport stub: endpoint -> HTTP status (default 201)."""
    statuses: dict[str, int] = {}
    calls: list[tuple[dict, str]] = []

    def fake_send(sub, data, ttl):
        calls.append((sub, data))
        return statuses.get(sub["endpoint"], 201)

    monkeypatch.setattr(web_push, "_send_one_sync", fake_send)
    statuses["_calls"] = calls  # type: ignore[assignment]
    return statuses


# -- Unsubscribe token ------------------------------------------------------------


class TestUnsubscribeToken:
    def test_roundtrip(self):
        uid = uuid4()
        token = make_unsubscribe_token(uid, "friend_request")
        assert read_unsubscribe_token(token) == (uid, "friend_request")

    def test_all_scope(self):
        uid = uuid4()
        assert read_unsubscribe_token(make_unsubscribe_token(uid, "all")) == (uid, "all")

    def test_unknown_scope_refused(self):
        with pytest.raises(ValueError):
            make_unsubscribe_token(uuid4(), "reactions")

    @pytest.mark.parametrize("bad", ["", "abc", "abc.def", "a.b.c", "💥.x"])
    def test_garbage(self, bad):
        assert read_unsubscribe_token(bad) is None

    def test_tampered_payload_rejected(self):
        uid, other = uuid4(), uuid4()
        token = make_unsubscribe_token(uid, "daily_outfit")
        forged_payload = make_unsubscribe_token(other, "daily_outfit").split(".")[0]
        assert read_unsubscribe_token(f"{forged_payload}.{token.split('.')[1]}") is None

    def test_other_secret_rejected(self, monkeypatch):
        token = make_unsubscribe_token(uuid4(), "daily_outfit")
        monkeypatch.setattr(get_settings(), "secret_key", "another-secret")
        assert read_unsubscribe_token(token) is None


class TestUnsubscribeEndpoint:
    async def test_one_click_rfc8058_post(self, client: AsyncClient, db_session, test_user):
        token = make_unsubscribe_token(test_user.id, "friend_request")
        resp = await client.post(
            f"{API}/notifications/unsubscribe?token={token}",
            content="List-Unsubscribe=One-Click",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"scope": "friend_request", "subscribed": False}
        pref = await db_session.get(NotificationPreference, test_user.id, populate_existing=True)
        assert pref.email_friend_request is False
        assert pref.email_friend_accepted is True
        assert pref.push_friend_request is True  # push untouched

    async def test_json_all_then_resubscribe(self, client: AsyncClient, db_session, test_user):
        token = make_unsubscribe_token(test_user.id, "daily_outfit")
        resp = await client.post(
            f"{API}/notifications/unsubscribe", json={"token": token, "all": True}
        )
        assert resp.json() == {"scope": "all", "subscribed": False}
        pref = await db_session.get(NotificationPreference, test_user.id, populate_existing=True)
        assert not any(
            [pref.email_friend_request, pref.email_friend_accepted, pref.email_daily_outfit]
        )

        resp = await client.post(
            f"{API}/notifications/unsubscribe", json={"token": token, "resubscribe": True}
        )
        assert resp.json() == {"scope": "daily_outfit", "subscribed": True}
        pref = await db_session.get(NotificationPreference, test_user.id, populate_existing=True)
        assert pref.email_daily_outfit is True
        assert pref.email_friend_request is False

    async def test_invalid_token(self, client: AsyncClient):
        resp = await client.post(f"{API}/notifications/unsubscribe?token=nope.nope")
        assert resp.status_code == 400

    async def test_get_redirects_without_side_effects(
        self, client: AsyncClient, db_session, test_user
    ):
        token = make_unsubscribe_token(test_user.id, "friend_request")
        resp = await client.get(f"{API}/notifications/unsubscribe?token={token}")
        assert resp.status_code == 303
        assert resp.headers["location"].endswith(f"/unsubscribe?token={token}")
        assert await db_session.get(NotificationPreference, test_user.id) is None


# -- Preferences + push subscriptions ----------------------------------------------


class TestPreferencesApi:
    async def test_defaults(self, client: AsyncClient, test_user, auth_headers):
        resp = await client.get(f"{API}/notifications/preferences", headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        # Everything the app has always sent is on; the two daily alerts are the
        # exception (see EVENT_DEFAULTS): the morning look waits to be asked for,
        # and the friend digest only buzzes the phone.
        on = {"friend_request": True, "friend_accepted": True, "daily_outfit": True}
        assert body["email"] == {**on, "morning_look": False, "friend_activity": False}
        assert body["push"] == {**on, "morning_look": False, "friend_activity": True}
        assert body["email_address"] == test_user.email
        assert body["push_devices"] == 0

    async def test_patch(self, client: AsyncClient, auth_headers):
        resp = await client.patch(
            f"{API}/notifications/preferences",
            json={"email": {"daily_outfit": False}, "push": {"friend_request": False}},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["email"]["daily_outfit"] is False
        assert body["email"]["friend_request"] is True
        assert body["push"]["friend_request"] is False

    async def test_patch_rejects_unknown_event(self, client: AsyncClient, auth_headers):
        resp = await client.patch(
            f"{API}/notifications/preferences",
            json={"email": {"reactions": True}},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    async def test_requires_auth(self, client: AsyncClient):
        assert (await client.get(f"{API}/notifications/preferences")).status_code == 401


class TestPushSubscriptionApi:
    async def test_subscribe_requires_vapid(self, client: AsyncClient, auth_headers, monkeypatch):
        monkeypatch.setattr(get_settings(), "vapid_private_key", None)
        resp = await client.post(
            f"{API}/notifications/push/subscribe",
            json={"endpoint": FCM + "x", "keys": KEYS},
            headers=auth_headers,
        )
        assert resp.status_code == 503

    async def test_subscribe_upsert_and_unsubscribe(
        self, client: AsyncClient, db_session, test_user, auth_headers, vapid
    ):
        endpoint = FCM + uuid4().hex
        for _ in range(2):  # idempotent
            resp = await client.post(
                f"{API}/notifications/push/subscribe",
                json={"endpoint": endpoint, "keys": KEYS, "user_agent": "iPhone Safari"},
                headers=auth_headers,
            )
            assert resp.status_code == 201, resp.text
        rows = (
            (
                await db_session.execute(
                    select(PushSubscription).where(PushSubscription.user_id == test_user.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1 and rows[0].user_agent == "iPhone Safari"

        prefs = await client.get(f"{API}/notifications/preferences", headers=auth_headers)
        assert prefs.json()["push_devices"] == 1
        assert prefs.json()["vapid_public_key"] == "BPublicKeyForTests"

        resp = await client.post(
            f"{API}/notifications/push/unsubscribe",
            json={"endpoint": endpoint},
            headers=auth_headers,
        )
        assert resp.json() == {"removed": 1}

    async def test_endpoint_moves_to_new_owner(self, client: AsyncClient, db_session, vapid):
        a, b = await _make_user(db_session), await _make_user(db_session)
        endpoint = FCM + uuid4().hex
        for user in (a, b):
            await client.post(
                f"{API}/notifications/push/subscribe",
                json={"endpoint": endpoint, "keys": KEYS},
                headers=_headers(user),
            )
        row = (
            await db_session.execute(
                select(PushSubscription).where(PushSubscription.endpoint == endpoint)
            )
        ).scalar_one()
        await db_session.refresh(row)
        assert row.user_id == b.id

    async def test_cannot_unsubscribe_someone_else(self, client: AsyncClient, db_session, vapid):
        a, b = await _make_user(db_session), await _make_user(db_session)
        endpoint = FCM + uuid4().hex
        await client.post(
            f"{API}/notifications/push/subscribe",
            json={"endpoint": endpoint, "keys": KEYS},
            headers=_headers(a),
        )
        resp = await client.post(
            f"{API}/notifications/push/unsubscribe",
            json={"endpoint": endpoint},
            headers=_headers(b),
        )
        assert resp.json() == {"removed": 0}

    @pytest.mark.parametrize(
        "endpoint",
        [
            "http://fcm.googleapis.com/x",
            "https://backend:8000/api",
            "https://127.0.0.1/x",
            "https://[::1]/x",
            "https://localhost/x",
            "https://redis.internal/x",
            "https://fcm.googleapis.com:6379/x",
            "not a url",
        ],
    )
    async def test_rejects_internal_or_insecure_endpoints(
        self, client: AsyncClient, auth_headers, vapid, endpoint
    ):
        resp = await client.post(
            f"{API}/notifications/push/subscribe",
            json={"endpoint": endpoint, "keys": KEYS},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    async def test_test_push_prunes_gone_subscriptions(
        self, client: AsyncClient, db_session, test_user, auth_headers, vapid, push_statuses
    ):
        alive, gone = FCM + uuid4().hex, FCM + uuid4().hex
        for endpoint in (alive, gone):
            db_session.add(
                PushSubscription(
                    user_id=test_user.id,
                    endpoint=endpoint,
                    p256dh=KEYS["p256dh"],
                    auth=KEYS["auth"],
                )
            )
        await db_session.commit()
        push_statuses[gone] = 410

        resp = await client.post(f"{API}/notifications/push/test", headers=auth_headers)
        assert resp.json() == {"sent": 1, "removed": 1, "failed": 0}
        left = (
            (
                await db_session.execute(
                    select(PushSubscription.endpoint).where(
                        PushSubscription.user_id == test_user.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert left == [alive]


# -- Friend events: API enqueues, worker dispatches ----------------------------------


class TestFriendEventEnqueue:
    async def test_request_and_accept_enqueue(
        self, client: AsyncClient, db_session, enqueued_social_notifications
    ):
        a, b = await _make_user(db_session, "ana"), await _make_user(db_session, "bea")
        resp = await client.post(
            f"{API}/friends/requests", json={"username": b.username}, headers=_headers(a)
        )
        assert resp.status_code == 201, resp.text
        fid = resp.json()["id"]
        assert [(e, str(f)) for e, f in enqueued_social_notifications] == [("friend_request", fid)]

        resp = await client.post(f"{API}/friends/{fid}/accept", headers=_headers(b))
        assert resp.status_code == 200
        assert [(e, str(f)) for e, f in enqueued_social_notifications][-1] == (
            "friend_accepted",
            fid,
        )

    async def test_mutual_request_counts_as_accept(
        self, client: AsyncClient, db_session, enqueued_social_notifications
    ):
        a, b = await _make_user(db_session, "ana"), await _make_user(db_session, "bea")
        await client.post(
            f"{API}/friends/requests", json={"username": b.username}, headers=_headers(a)
        )
        resp = await client.post(
            f"{API}/friends/requests", json={"username": a.username}, headers=_headers(b)
        )
        assert resp.json()["relation"] == "friends"
        assert enqueued_social_notifications[-1][0] == "friend_accepted"


@pytest_asyncio.fixture
async def pending_pair(db_session: AsyncSession) -> tuple[User, User, Friendship]:
    requester = await _make_user(db_session, "req")
    addressee = await _make_user(db_session, "adr")
    f = Friendship(
        requester_id=requester.id, addressee_id=addressee.id, status=FriendshipStatus.pending
    )
    db_session.add(f)
    await db_session.commit()
    return requester, addressee, f


class TestFriendEventDispatch:
    async def test_friend_request_email_and_push(
        self, db_session, pending_pair, sent_emails, vapid, push_statuses
    ):
        requester, addressee, f = pending_pair
        db_session.add(
            PushSubscription(
                user_id=addressee.id, endpoint=FCM + uuid4().hex, p256dh="p" * 20, auth="a" * 10
            )
        )
        await db_session.commit()

        result = await notify_friendship_event(db_session, "friend_request", f.id)
        await db_session.commit()
        assert result == {"status": "sent", "channels": ["account_email", "web_push"]}

        assert len(sent_emails) == 1
        mail = sent_emails[0]
        assert mail["to"] == addressee.email
        assert f"@{requester.username}" in mail["email"].subject
        assert "Private Name" not in mail["email"].html  # only the @handle, never names
        assert requester.email not in mail["email"].html
        assert mail["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
        one_click = mail["headers"]["List-Unsubscribe"].strip("<>")
        assert "/api/v1/notifications/unsubscribe?token=" in one_click
        token = one_click.split("token=")[1]
        assert read_unsubscribe_token(token) == (addressee.id, "friend_request")
        assert f"/unsubscribe?token={token}" in mail["email"].html

        (sub, data) = push_statuses["_calls"][0]
        assert '"url": "/dashboard/friends"' in data
        assert requester.username in data

        rows = (
            (
                await db_session.execute(
                    select(Notification).where(Notification.user_id == addressee.id)
                )
            )
            .scalars()
            .all()
        )
        assert {r.channel for r in rows} == {"account_email", "web_push"}
        assert all(r.payload["type"] == "friend_request" for r in rows)

    async def test_duplicate_request_within_a_day_is_quiet(
        self, db_session, pending_pair, sent_emails
    ):
        _, _, f = pending_pair
        await notify_friendship_event(db_session, "friend_request", f.id)
        await db_session.commit()
        again = await notify_friendship_event(db_session, "friend_request", f.id)
        assert again == {"status": "skipped", "reason": "duplicate"}
        assert len(sent_emails) == 1

    async def test_respects_email_preference(self, db_session, pending_pair, sent_emails):
        _, addressee, f = pending_pair
        db_session.add(NotificationPreference(user_id=addressee.id, email_friend_request=False))
        await db_session.commit()
        result = await notify_friendship_event(db_session, "friend_request", f.id)
        assert result["status"] == "no_channel"
        assert sent_emails == []

    async def test_cancelled_request_not_announced(self, db_session, pending_pair, sent_emails):
        _, _, f = pending_pair
        fid = f.id
        await db_session.delete(f)
        await db_session.commit()
        result = await notify_friendship_event(db_session, "friend_request", fid)
        assert result == {"status": "skipped", "reason": "friendship_gone"}
        assert sent_emails == []

    async def test_accepted_goes_to_requester(self, db_session, pending_pair, sent_emails):
        requester, addressee, f = pending_pair
        f.status = FriendshipStatus.accepted
        await db_session.commit()
        # Not pending anymore: a late "friend_request" job stays quiet.
        assert (await notify_friendship_event(db_session, "friend_request", f.id))[
            "reason"
        ] == "not_pending"

        result = await notify_friendship_event(db_session, "friend_accepted", f.id)
        assert result["channels"] == ["account_email"]
        assert sent_emails[0]["to"] == requester.email
        assert f"@{addressee.username}" in sent_emails[0]["email"].subject

    async def test_no_email_transport_means_no_email(self, db_session, pending_pair, monkeypatch):
        monkeypatch.setattr(event_notifications, "email_delivery_available", lambda: False)
        _, _, f = pending_pair
        result = await notify_friendship_event(db_session, "friend_request", f.id)
        assert result["status"] == "no_channel"


def test_friend_request_template_escapes_and_has_unsubscribe():
    email = render_friend_request_email(
        username="<b>x</b>",
        cta_url="https://example.com/dashboard/friends",
        unsubscribe_url="https://example.com/unsubscribe?token=t",
        origin="https://example.com",
    )
    assert "<b>x</b>" not in email.html
    assert "&lt;b&gt;x&lt;/b&gt;" in email.html
    assert "https://example.com/unsubscribe?token=t" in email.html
    assert "https://example.com/unsubscribe?token=t" in email.text
    assert "Darme de baja" in email.html


# -- Daily outfit through the default channels ------------------------------------------


class TestDailyOutfitDefaultChannels:
    async def test_email_by_default_without_any_setup(self, db_session, sent_emails):
        from app.models.outfit import Outfit
        from app.services.notification_service import NotificationDispatcher

        user = await _make_user(db_session)
        outfit = Outfit(user_id=user.id, occasion="casual", reasoning="Capas ligeras")
        db_session.add(outfit)
        await db_session.commit()

        dispatcher = NotificationDispatcher(db_session, "https://app.example")
        results = await dispatcher.send_outfit_notification(user.id, outfit.id)
        await db_session.commit()

        assert [(r.channel, r.status.value) for r in results] == [("account_email", "sent")]
        mail = sent_emails[0]
        assert mail["to"] == user.email
        token = mail["headers"]["List-Unsubscribe"].split("token=")[1].rstrip(">")
        assert read_unsubscribe_token(token) == (user.id, "daily_outfit")
        await db_session.refresh(outfit)
        assert outfit.status == "sent"
        row = (
            await db_session.execute(select(Notification).where(Notification.user_id == user.id))
        ).scalar_one()
        assert row.channel == "account_email" and row.payload["type"] == "daily_outfit"

    async def test_failed_default_email_is_retried(self, db_session, monkeypatch):
        from app.models.notification import NotificationStatus
        from app.models.outfit import Outfit
        from app.services.notification_service import DeliveryStatus, NotificationDispatcher

        attempts: list[str] = []

        async def flaky_send(to, email, *, headers=None):
            attempts.append(to)
            if len(attempts) == 1:
                raise RuntimeError("Resend send failed: 500")
            return "resend"

        monkeypatch.setattr(event_notifications, "send_email", flaky_send)
        monkeypatch.setattr(event_notifications, "email_delivery_available", lambda: True)

        user = await _make_user(db_session)
        outfit = Outfit(user_id=user.id, occasion="office")
        db_session.add(outfit)
        await db_session.commit()
        dispatcher = NotificationDispatcher(db_session, "https://app.example")
        await dispatcher.send_outfit_notification(user.id, outfit.id, for_tomorrow=True)
        await db_session.commit()
        row = (
            await db_session.execute(select(Notification).where(Notification.user_id == user.id))
        ).scalar_one()
        assert row.status == NotificationStatus.retrying
        assert row.payload["for_tomorrow"] is True

        retried = await dispatcher.retry_notification(row)
        assert retried.channel == "account_email"
        assert retried.status == DeliveryStatus.SENT
        assert len(attempts) == 2
