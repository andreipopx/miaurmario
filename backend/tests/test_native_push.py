"""Push to the native app: token registration, FCM/APNs payloads and delivery,
and the merged "push" channel that now reaches browsers and app installs alike."""

import json
from uuid import uuid4

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import create_access_token
from app.config import get_settings
from app.models import User
from app.models.notification import NativePushToken, PushSubscription
from app.services import native_push, push, web_push
from app.services.event_notifications import CHANNEL_WEB_PUSH, default_channels_for
from app.services.web_push import PushPayload

API = "/api/v1"


@pytest.fixture
def FCM_TOKEN() -> str:  # noqa: N802 - reads like the constant it stands for
    # The test database isn't emptied between tests and tokens are unique.
    return "fcm-token_" + uuid4().hex * 4


@pytest.fixture
def APNS_TOKEN() -> str:  # noqa: N802
    return uuid4().hex + uuid4().hex


def _pem(key, private_format=serialization.PrivateFormat.PKCS8) -> str:
    return key.private_bytes(
        serialization.Encoding.PEM, private_format, serialization.NoEncryption()
    ).decode()


async def _make_user(db: AsyncSession) -> User:
    uid = uuid4()
    user = User(
        id=uid,
        external_id=f"native-{uid}",
        email=f"native-{uid}@example.com",
        username=f"native_{uid.hex[:6]}",
        display_name="Native",
        timezone="UTC",
        is_active=True,
        onboarding_completed=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.external_id)}"}


@pytest.fixture(autouse=True)
def _fresh_credentials():
    native_push.reset_credentials_cache()
    yield
    native_push.reset_credentials_cache()


@pytest.fixture
def rsa_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def fcm(monkeypatch, rsa_key):
    account = {
        "type": "service_account",
        "project_id": "miaurmario-test",
        "client_email": "push@miaurmario-test.iam.gserviceaccount.com",
        "private_key": _pem(rsa_key),
        "token_uri": "https://oauth2.googleapis.com/token",
    }
    # Pasted whole into a one-line .env, the key's newlines still \n-escaped.
    monkeypatch.setattr(get_settings(), "fcm_service_account_json", json.dumps(account))
    return account


@pytest.fixture
def ec_key():
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture
def apns(monkeypatch, ec_key, tmp_path):
    p8 = tmp_path / "AuthKey_TEST123456.p8"
    p8.write_text(_pem(ec_key))
    settings = get_settings()
    monkeypatch.setattr(settings, "apns_key_id", "TEST123456")
    monkeypatch.setattr(settings, "apns_team_id", "TEAM123456")
    monkeypatch.setattr(settings, "apns_private_key", str(p8))  # given as a path
    monkeypatch.setattr(settings, "apns_use_sandbox", False)
    return settings


class Provider:
    """Fake Google token endpoint, FCM and APNs behind one httpx MockTransport."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.fcm_status: dict[str, tuple[int, dict]] = {}
        self.apns_status: dict[str, tuple[int, dict]] = {}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        url = str(request.url)
        if url == "https://oauth2.googleapis.com/token":
            return httpx.Response(200, json={"access_token": "ya29.test", "expires_in": 3599})
        if url.startswith("https://fcm.googleapis.com/"):
            token = json.loads(request.content)["message"]["token"]
            status, body = self.fcm_status.get(token, (200, {"name": "projects/x/messages/1"}))
            return httpx.Response(status, json=body)
        if "push.apple.com/3/device/" in url:
            token = url.rsplit("/", 1)[1]
            status, body = self.apns_status.get(token, (200, {}))
            return httpx.Response(status, json=body) if body else httpx.Response(status)
        return httpx.Response(599)

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self))

    def of(self, prefix: str) -> list[httpx.Request]:
        return [r for r in self.requests if str(r.url).startswith(prefix)]


@pytest.fixture
def provider(monkeypatch) -> Provider:
    fake = Provider()
    monkeypatch.setattr(native_push, "_client", fake.client)
    return fake


PAYLOAD = PushPayload(title="Stinky", body="Tu look de hoy", url="/dashboard", tag="morning")


# -- Payloads ----------------------------------------------------------------------


class TestPayloads:
    def test_fcm_message(self):
        msg = native_push.fcm_message("tok", PAYLOAD, 300)["message"]
        assert msg["token"] == "tok"
        assert msg["notification"] == {"title": "Stinky", "body": "Tu look de hoy"}
        assert msg["data"] == {"url": "/dashboard", "tag": "morning"}
        assert all(isinstance(v, str) for v in msg["data"].values())
        assert msg["android"]["ttl"] == "300s"
        assert msg["android"]["notification"]["tag"] == "morning"
        assert msg["android"]["notification"]["icon"] == "ic_stat_stinky"

    def test_apns_body_and_headers(self, apns):
        body = native_push.apns_body(PAYLOAD)
        assert body["aps"]["alert"] == {"title": "Stinky", "body": "Tu look de hoy"}
        assert body["url"] == "/dashboard"
        headers = native_push.apns_headers(PAYLOAD, 300, "bearer-x")
        assert headers["apns-topic"] == "org.andreipop.miaurmario"
        assert headers["apns-push-type"] == "alert"
        assert headers["apns-collapse-id"] == "morning"

    def test_collapse_id_is_capped(self, apns):
        long = PushPayload(title="t", body="b", tag="x" * 100)
        assert len(native_push.apns_headers(long, 1, "b")["apns-collapse-id"]) == 64

    def test_secret_inline_escaped_or_path(self, tmp_path):
        assert native_push._secret("-----BEGIN KEY-----\\nabc") == "-----BEGIN KEY-----\nabc"
        as_json = json.dumps({"private_key": "-----BEGIN-----\nk\n"})
        assert json.loads(native_push._secret(as_json))["private_key"] == "-----BEGIN-----\nk\n"
        f = tmp_path / "k.p8"
        f.write_text("from file")
        assert native_push._secret(str(f)) == "from file"


# -- Delivery ----------------------------------------------------------------------


@pytest.mark.asyncio
class TestDelivery:
    async def test_off_without_credentials(self, db_session, provider, FCM_TOKEN):
        user = await _make_user(db_session)
        db_session.add(NativePushToken(user_id=user.id, platform="android", token=FCM_TOKEN))
        await db_session.commit()
        result = await native_push.send_native_push(db_session, user.id, PAYLOAD)
        assert result.sent == 0 and provider.requests == []

    async def test_fcm_signs_and_sends(self, db_session, fcm, provider, rsa_key, FCM_TOKEN):
        user = await _make_user(db_session)
        db_session.add(NativePushToken(user_id=user.id, platform="android", token=FCM_TOKEN))
        await db_session.commit()

        result = await native_push.send_native_push(db_session, user.id, PAYLOAD)

        assert result.sent == 1
        token_req = provider.of("https://oauth2.googleapis.com/token")[0]
        assertion = dict(httpx.QueryParams(token_req.content.decode()))["assertion"]
        claims = jwt.decode(
            assertion,
            rsa_key.public_key(),
            algorithms=["RS256"],
            audience="https://oauth2.googleapis.com/token",
        )
        assert claims["scope"] == native_push.FCM_SCOPE
        send = provider.of("https://fcm.googleapis.com/")[0]
        assert send.url.path == "/v1/projects/miaurmario-test/messages:send"
        assert send.headers["authorization"] == "Bearer ya29.test"
        device = (
            await db_session.execute(
                select(NativePushToken).where(NativePushToken.token == FCM_TOKEN)
            )
        ).scalar_one()
        assert device.last_used_at is not None

    async def test_fcm_access_token_is_reused(self, db_session, fcm, provider, FCM_TOKEN):
        user = await _make_user(db_session)
        db_session.add(NativePushToken(user_id=user.id, platform="android", token=FCM_TOKEN))
        await db_session.commit()
        await native_push.send_native_push(db_session, user.id, PAYLOAD)
        await native_push.send_native_push(db_session, user.id, PAYLOAD)
        assert len(provider.of("https://oauth2.googleapis.com/token")) == 1
        assert len(provider.of("https://fcm.googleapis.com/")) == 2

    async def test_fcm_unregistered_token_is_removed(self, db_session, fcm, provider, FCM_TOKEN):
        user = await _make_user(db_session)
        db_session.add(NativePushToken(user_id=user.id, platform="android", token=FCM_TOKEN))
        await db_session.commit()
        provider.fcm_status[FCM_TOKEN] = (404, {"error": {"status": "NOT_FOUND"}})

        result = await native_push.send_native_push(db_session, user.id, PAYLOAD)

        assert (result.sent, result.removed) == (0, 1)
        assert (
            await db_session.execute(
                select(NativePushToken).where(NativePushToken.token == FCM_TOKEN)
            )
        ).first() is None

    async def test_fcm_server_error_keeps_token(self, db_session, fcm, provider, FCM_TOKEN):
        user = await _make_user(db_session)
        db_session.add(NativePushToken(user_id=user.id, platform="android", token=FCM_TOKEN))
        await db_session.commit()
        provider.fcm_status[FCM_TOKEN] = (503, {"error": {"status": "UNAVAILABLE"}})

        result = await native_push.send_native_push(db_session, user.id, PAYLOAD)

        assert (result.sent, result.failed, result.removed) == (0, 1, 0)
        assert (
            await db_session.execute(
                select(NativePushToken).where(NativePushToken.token == FCM_TOKEN)
            )
        ).first() is not None

    async def test_apns_signs_and_sends(self, db_session, apns, provider, ec_key, APNS_TOKEN):
        user = await _make_user(db_session)
        db_session.add(NativePushToken(user_id=user.id, platform="ios", token=APNS_TOKEN))
        await db_session.commit()

        result = await native_push.send_native_push(db_session, user.id, PAYLOAD)

        assert result.sent == 1
        req = provider.of("https://api.push.apple.com/")[0]
        assert req.url.path == f"/3/device/{APNS_TOKEN}"
        bearer = req.headers["authorization"].removeprefix("bearer ")
        assert jwt.get_unverified_header(bearer)["kid"] == "TEST123456"
        assert jwt.decode(bearer, ec_key.public_key(), algorithms=["ES256"])["iss"] == "TEAM123456"
        assert json.loads(req.content)["aps"]["alert"]["title"] == "Stinky"

    async def test_apns_sandbox_host(self, db_session, apns, provider, monkeypatch, APNS_TOKEN):
        monkeypatch.setattr(get_settings(), "apns_use_sandbox", True)
        user = await _make_user(db_session)
        db_session.add(NativePushToken(user_id=user.id, platform="ios", token=APNS_TOKEN))
        await db_session.commit()
        await native_push.send_native_push(db_session, user.id, PAYLOAD)
        assert provider.of("https://api.sandbox.push.apple.com/")

    @pytest.mark.parametrize(
        "status,body", [(410, {"reason": "Unregistered"}), (400, {"reason": "BadDeviceToken"})]
    )
    async def test_apns_dead_token_is_removed(
        self, db_session, apns, provider, status, body, APNS_TOKEN
    ):
        user = await _make_user(db_session)
        db_session.add(NativePushToken(user_id=user.id, platform="ios", token=APNS_TOKEN))
        await db_session.commit()
        provider.apns_status[APNS_TOKEN] = (status, body)

        result = await native_push.send_native_push(db_session, user.id, PAYLOAD)

        assert result.removed == 1
        assert (
            await db_session.execute(
                select(NativePushToken).where(NativePushToken.token == APNS_TOKEN)
            )
        ).first() is None

    async def test_only_configured_platform_is_tried(
        self, db_session, apns, provider, FCM_TOKEN, APNS_TOKEN
    ):
        user = await _make_user(db_session)
        db_session.add_all(
            [
                NativePushToken(user_id=user.id, platform="android", token=FCM_TOKEN),
                NativePushToken(user_id=user.id, platform="ios", token=APNS_TOKEN),
            ]
        )
        await db_session.commit()
        result = await native_push.send_native_push(db_session, user.id, PAYLOAD)
        assert result.sent == 1
        assert provider.of("https://fcm.googleapis.com/") == []


# -- One push channel for browsers and app installs ---------------------------------


@pytest.mark.asyncio
class TestMergedChannel:
    async def test_send_push_reaches_browser_and_app(
        self, db_session, fcm, provider, monkeypatch, FCM_TOKEN
    ):
        settings = get_settings()
        monkeypatch.setattr(settings, "vapid_public_key", "BPublicKeyForTests")
        monkeypatch.setattr(settings, "vapid_private_key", "private-key-for-tests")
        browser_calls: list[str] = []

        def fake_web(sub, data, ttl):
            browser_calls.append(sub["endpoint"])
            return 201

        monkeypatch.setattr(web_push, "_send_one_sync", fake_web)
        user = await _make_user(db_session)
        endpoint = f"https://fcm.googleapis.com/fcm/send/{uuid4().hex}"
        db_session.add_all(
            [
                PushSubscription(
                    user_id=user.id,
                    endpoint=endpoint,
                    p256dh="B" + "x" * 86,
                    auth="a" * 22,
                ),
                NativePushToken(user_id=user.id, platform="android", token=FCM_TOKEN),
            ]
        )
        await db_session.commit()

        result = await push.send_push(db_session, user.id, PAYLOAD)

        assert result.sent == 2
        assert browser_calls == [endpoint]
        assert await push.count_push_devices(db_session, user.id) == 2

    async def test_app_only_user_gets_the_push_channel(self, db_session, apns, APNS_TOKEN):
        user = await _make_user(db_session)
        assert CHANNEL_WEB_PUSH not in await default_channels_for(
            db_session, user, "friend_request"
        )
        db_session.add(NativePushToken(user_id=user.id, platform="ios", token=APNS_TOKEN))
        await db_session.commit()
        assert CHANNEL_WEB_PUSH in await default_channels_for(db_session, user, "friend_request")

    async def test_one_broken_half_does_not_sink_the_other(self, db_session, monkeypatch):
        async def boom(*_a, **_k):
            raise RuntimeError("bad key")

        async def fine(*_a, **_k):
            return web_push.PushResult(sent=1)

        monkeypatch.setattr(push, "send_web_push", boom)
        monkeypatch.setattr(push, "send_native_push", fine)
        result = await push.send_push(db_session, uuid4(), PAYLOAD)
        assert (result.sent, result.failed) == (1, 1)


# -- API -------------------------------------------------------------------------------


@pytest.mark.asyncio
class TestNativeTokenApi:
    async def test_register_is_stored_even_before_credentials(
        self, client: AsyncClient, db_session, test_user, auth_headers, FCM_TOKEN
    ):
        resp = await client.post(
            f"{API}/notifications/push/native/register",
            json={"platform": "android", "token": FCM_TOKEN, "app_version": "0.1.0"},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        assert resp.json() == {"registered": True, "delivering": False}
        device = (
            await db_session.execute(
                select(NativePushToken).where(NativePushToken.token == FCM_TOKEN)
            )
        ).scalar_one()
        assert (device.user_id, device.platform, device.app_version) == (
            test_user.id,
            "android",
            "0.1.0",
        )

    async def test_register_reports_delivering(self, client, auth_headers, apns, APNS_TOKEN):
        resp = await client.post(
            f"{API}/notifications/push/native/register",
            json={"platform": "ios", "token": APNS_TOKEN},
            headers=auth_headers,
        )
        assert resp.json()["delivering"] is True

    async def test_token_moves_to_whoever_signed_in_last(self, client, db_session, APNS_TOKEN):
        first, second = await _make_user(db_session), await _make_user(db_session)
        for user in (first, second):
            await client.post(
                f"{API}/notifications/push/native/register",
                json={"platform": "ios", "token": APNS_TOKEN},
                headers=_headers(user),
            )
        devices = (
            (
                await db_session.execute(
                    select(NativePushToken).where(NativePushToken.token == APNS_TOKEN)
                )
            )
            .scalars()
            .all()
        )
        assert [d.user_id for d in devices] == [second.id]

    @pytest.mark.parametrize(
        "body",
        [
            {"platform": "huawei", "token": "fcm-token_" + "a" * 40},
            {"platform": "ios", "token": "short"},
            {"platform": "ios", "token": "has spaces " * 4},
        ],
    )
    async def test_invalid_payload(self, client, auth_headers, body):
        resp = await client.post(
            f"{API}/notifications/push/native/register", json=body, headers=auth_headers
        )
        assert resp.status_code == 422

    async def test_cannot_unregister_someone_else(
        self, client, db_session, auth_headers, APNS_TOKEN
    ):
        other = await _make_user(db_session)
        db_session.add(NativePushToken(user_id=other.id, platform="ios", token=APNS_TOKEN))
        await db_session.commit()
        resp = await client.post(
            f"{API}/notifications/push/native/unregister",
            json={"token": APNS_TOKEN},
            headers=auth_headers,
        )
        assert resp.json() == {"removed": 0}
        resp = await client.post(
            f"{API}/notifications/push/native/unregister",
            json={"token": APNS_TOKEN},
            headers=_headers(other),
        )
        assert resp.json() == {"removed": 1}

    async def test_preferences_list_native_platforms(self, client, auth_headers, fcm):
        resp = await client.get(f"{API}/notifications/preferences", headers=auth_headers)
        body = resp.json()
        assert body["native_push_platforms"] == ["android"]
        assert body["push_available"] is True
        assert body["vapid_public_key"] is None  # no VAPID configured here
