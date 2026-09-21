"""Outgoing email templates: link present, Miaurmario branding, both parts."""

from unittest.mock import AsyncMock, patch

import pytest

from app.config import get_settings
from app.services.notification_providers import (
    build_family_invite_email,
    build_notification_email,
)
from app.utils import email as email_module
from app.utils.email_templates import (
    STINKY_EMAIL_IMAGE_PATH,
    normalize_locale,
    render_family_invite_email,
    render_magic_link_email,
    render_notification_email,
    render_outfit_email,
    render_test_email,
)

LINK = "https://app.example.test/auth/callback?token=abc_DEF-123&x=1"
ORIGIN = "https://app.example.test"


def _all_renders():
    return [
        render_magic_link_email(LINK, origin=ORIGIN),
        render_magic_link_email(LINK, locale="en", origin=ORIGIN),
        render_family_invite_email(
            inviter_name="Ana", family_name="Casa", invite_url=LINK, origin=ORIGIN
        ),
        render_notification_email(
            subject="S", heading="H", body="B", cta_text="Go", cta_url=LINK, origin=ORIGIN
        ),
        render_outfit_email(
            occasion="casual",
            reasoning="Hace sol",
            highlights=["a", "b"],
            style_notes="Remanga",
            temperature=21,
            condition="Soleado",
            for_tomorrow=True,
            cta_url=LINK,
            origin=ORIGIN,
        ),
        render_test_email(origin=ORIGIN),
    ]


@pytest.mark.parametrize("rendered", _all_renders())
def test_brand_and_parts(rendered):
    for part in (rendered.subject, rendered.html, rendered.text):
        assert "wardrowbe" not in part.lower()
    assert "miaurmario" in rendered.html
    assert f"{ORIGIN}{STINKY_EMAIL_IMAGE_PATH}" in rendered.html
    assert "color-scheme" in rendered.html
    assert rendered.text.strip()
    assert "<" not in rendered.text


def test_magic_link_contains_link_in_button_fallback_and_text():
    r = render_magic_link_email(LINK, origin=ORIGIN)
    escaped = LINK.replace("&", "&amp;")
    assert r.html.count(f'href="{escaped}"') >= 2  # bulletproof button + fallback link
    assert LINK in r.text
    assert "15 minutos" in r.html and "15 minutos" in r.text
    assert "Stinky te abre la puerta" in r.html
    assert "ignóralo" in r.html
    assert 'lang="es"' in r.html
    assert "border-radius:999px" in r.html
    assert "#FF7EB6" in r.html


def test_magic_link_english():
    r = render_magic_link_email(LINK, locale="en-GB", origin=ORIGIN)
    assert 'lang="en"' in r.html
    assert "15 minutes" in r.text
    assert r.subject == "Your Miaurmario sign-in link"


def test_locale_fallback_is_spanish():
    assert normalize_locale(None) == "es"
    assert normalize_locale("fr") == "es"
    assert normalize_locale("EN-us") == "en"


def test_image_uses_configured_public_origin(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "magic_link_base_url", "https://public.example.org/")
    r = render_magic_link_email(LINK)
    assert f"https://public.example.org{STINKY_EMAIL_IMAGE_PATH}" in r.html


def test_invite_escapes_user_supplied_names():
    msg = build_family_invite_email(
        to="x@example.com",
        family_name="<script>alert(1)</script>",
        inviter_name="Eve <b>",
        invite_token="tok123",
        app_url="https://app.example.test/",
    )
    assert "<script>" not in msg.html_body
    assert "&lt;script&gt;" in msg.html_body
    assert "https://app.example.test/invite?token=tok123" in msg.html_body
    assert "https://app.example.test/invite?token=tok123" in msg.text_body
    assert "wardrowbe" not in msg.subject.lower()


def test_notification_email_builder_keeps_signature():
    msg = build_notification_email(
        to="x@example.com",
        subject="Colada",
        heading="Hora de hacer la colada",
        body="3 prendas",
        cta_text="Ver",
        cta_url="https://app.example.test/dashboard/wardrobe",
        app_url="https://app.example.test",
    )
    assert msg.subject == "Colada"
    assert "https://app.example.test/dashboard/wardrobe" in msg.html_body
    assert "Gestionar notificaciones" in msg.html_body
    assert msg.text_body


async def test_send_magic_link_email_posts_both_parts(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "resend_api_key", "re_test")

    class _Resp:
        status_code = 200
        text = "{}"

    post = AsyncMock(return_value=_Resp())
    with patch("httpx.AsyncClient.post", new=post):
        await email_module.send_magic_link_email("a@b.c", LINK, locale="en")
    payload = post.await_args.kwargs["json"]
    assert payload["to"] == ["a@b.c"]
    assert payload["subject"] == "Your Miaurmario sign-in link"
    assert LINK in payload["text"]
    assert "Stinky" in payload["html"]
