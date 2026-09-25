"""Outgoing email templates in the "Stinky pop" style.

One table-based layout shared by every email (magic link, family invite,
notifications, outfit of the day, SMTP test):

* white card, max-width 480px, Figtree with Arial fallbacks (web fonts are
  best-effort in email; Apple Mail loads them, Gmail/Outlook fall back);
* "miaurmario" wordmark as heavy rounded text, Stinky's head as an absolute
  PNG (a pink disc baked into the image, so the black cat never vanishes on
  a dark-mode background);
* pink #FF7EB6 accents and an ink #111 pill CTA built as a bulletproof button
  (table cell + padded link, VML roundrect for Outlook desktop) followed by
  the raw link as fallback text;
* `color-scheme: light only` so clients that honour it do not re-colour it.

Every renderer returns a RenderedEmail with an HTML and a plain-text part.
Copy is Spanish by default; pass locale="en" for English. All dynamic values
are HTML-escaped here, callers pass plain text.
"""

from dataclasses import dataclass
from html import escape

from app.config import get_settings
from app.utils.occasions import occasion_label_es

PINK = "#FF7EB6"
PINK_SOFT = "#FFE4F0"
INK = "#111111"
MUTED = "#6B6B6B"
LINE = "#F1E4EA"
FONT = "'Figtree', 'Helvetica Neue', Helvetica, Arial, sans-serif"
WORDMARK_FONT = (
    "'Bagel Fat One', 'Figtree', 'Arial Rounded MT Bold', 'Arial Black', Arial, sans-serif"
)

STINKY_EMAIL_IMAGE_PATH = "/brand/stinky/email/stinky-head-192.png"

SUPPORTED_LOCALES = ("es", "en")


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    html: str
    text: str


def normalize_locale(locale: str | None) -> str:
    if locale and locale.strip().lower()[:2] in SUPPORTED_LOCALES:
        return locale.strip().lower()[:2]
    return "es"


def _asset_origin(origin: str | None) -> str:
    return (origin or get_settings().email_asset_origin).rstrip("/")


_CHROME = {
    "es": {
        "tagline": "Tu armario, curado por un gato con criterio.",
        "button_fallback": "¿El botón no funciona? Copia y pega este enlace en tu navegador:",
        "sent_by": "Te lo manda Stinky desde",
        "manage": "Gestionar notificaciones",
        "unsubscribe": "Darme de baja de estos emails",
        "stinky_alt": "Stinky, el gato de Miaurmario",
    },
    "en": {
        "tagline": "Your wardrobe, curated by a cat with taste.",
        "button_fallback": "Button not working? Copy and paste this link into your browser:",
        "sent_by": "Sent by Stinky from",
        "manage": "Manage notifications",
        "unsubscribe": "Unsubscribe from these emails",
        "stinky_alt": "Stinky, the Miaurmario cat",
    },
}


def _button(label: str, url: str) -> str:
    label_e = escape(label)
    url_e = escape(url, quote=True)
    return f"""\
<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;">
  <tr>
    <td align="center" bgcolor="{INK}" style="border-radius:999px; background:{INK};">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{url_e}" style="height:52px;v-text-anchor:middle;width:280px;" arcsize="50%" stroke="f" fillcolor="{INK}">
        <w:anchorlock/>
        <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">{label_e}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-- -->
      <a href="{url_e}" target="_blank" rel="noopener" style="display:inline-block; padding:16px 34px; font-family:{FONT}; font-size:16px; font-weight:700; line-height:20px; color:#ffffff; text-decoration:none; border-radius:999px; background:{INK}; border:1px solid {INK}; mso-hide:all;">{label_e}</a>
      <!--<![endif]-->
    </td>
  </tr>
</table>"""


def _layout(
    *,
    locale: str,
    title: str,
    preheader: str,
    heading: str,
    body_html: str,
    cta_label: str | None = None,
    cta_url: str | None = None,
    after_cta_html: str = "",
    footer_links_html: str = "",
    origin: str | None = None,
) -> str:
    loc = normalize_locale(locale)
    chrome = _CHROME[loc]
    base = _asset_origin(origin)
    image_url = escape(f"{base}{STINKY_EMAIL_IMAGE_PATH}", quote=True)
    base_e = escape(base, quote=True)

    cta_html = ""
    if cta_label and cta_url:
        cta_html = f"""
          <tr>
            <td class="mm-pad" style="padding:8px 32px 8px 32px;">{_button(cta_label, cta_url)}</td>
          </tr>
          <tr>
            <td class="mm-pad" style="padding:20px 32px 0 32px; font-family:{FONT}; font-size:12px; line-height:18px; color:{MUTED};">
              {escape(chrome["button_fallback"])}<br>
              <a href="{escape(cta_url, quote=True)}" style="color:{INK}; text-decoration:underline; word-break:break-all;">{escape(cta_url)}</a>
            </td>
          </tr>"""

    return f"""\
<!doctype html>
<html lang="{loc}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>{escape(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Bagel+Fat+One&amp;family=Figtree:wght@400;600;700;800&amp;display=swap" rel="stylesheet">
  <style>
    :root {{ color-scheme: light only; supported-color-schemes: light only; }}
    body {{ margin:0; padding:0; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }}
    a {{ color:{INK}; }}
    @media (max-width: 520px) {{
      .mm-card {{ border-radius:0 !important; border-left:0 !important; border-right:0 !important; border-top:0 !important; }}
      .mm-bar {{ border-radius:0 !important; }}
      .mm-pad {{ padding-left:20px !important; padding-right:20px !important; }}
    }}
  </style>
  <!--[if mso]><style>* {{ font-family: Arial, sans-serif !important; }}</style><![endif]-->
</head>
<body style="margin:0; padding:0; background:#ffffff;" bgcolor="#ffffff">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#ffffff; opacity:0;">{escape(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="background:#ffffff;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" class="mm-card" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:480px; background:#ffffff; border:1px solid {LINE}; border-radius:28px; overflow:hidden; border-collapse:separate;">
          <tr>
            <td class="mm-bar" style="height:8px; line-height:8px; font-size:0; background:{PINK}; border-radius:27px 27px 0 0;" bgcolor="{PINK}">&nbsp;</td>
          </tr>
          <tr>
            <td align="center" style="padding:28px 32px 4px 32px;">
              <img src="{image_url}" width="96" height="96" alt="{escape(chrome["stinky_alt"], quote=True)}" style="display:block; width:96px; height:96px; border:0; outline:none; text-decoration:none; border-radius:48px;">
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:10px 32px 0 32px; font-family:{WORDMARK_FONT}; font-size:30px; line-height:34px; font-weight:900; letter-spacing:-0.5px; color:{INK};">
              miaurmario
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:10px 32px 0 32px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td style="width:40px; height:4px; line-height:4px; font-size:0; background:{PINK}; border-radius:4px;" bgcolor="{PINK}">&nbsp;</td></tr></table>
            </td>
          </tr>
          <tr>
            <td class="mm-pad" style="padding:24px 32px 8px 32px; font-family:{FONT}; font-size:24px; line-height:30px; font-weight:800; color:{INK}; text-align:center;">
              {escape(heading)}
            </td>
          </tr>
          <tr>
            <td class="mm-pad" style="padding:4px 32px 20px 32px; font-family:{FONT}; font-size:16px; line-height:24px; color:{INK};">
              {body_html}
            </td>
          </tr>{cta_html}
          <tr>
            <td class="mm-pad" style="padding:24px 32px 28px 32px; font-family:{FONT}; font-size:13px; line-height:20px; color:{MUTED};">
              {after_cta_html}
            </td>
          </tr>
        </table>
        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width:480px;">
          <tr>
            <td align="center" style="padding:18px 24px 8px 24px; font-family:{FONT}; font-size:12px; line-height:18px; color:{MUTED};">
              {escape(chrome["sent_by"])} <a href="{base_e}" style="color:{INK}; font-weight:700; text-decoration:none;">Miaurmario</a> &middot; {escape(chrome["tagline"])}
              {footer_links_html}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _p(text: str, *, style: str = "") -> str:
    return f'<p style="margin:0 0 14px 0; {style}">{text}</p>'


def _text(*blocks: str) -> str:
    return "\n\n".join(b.strip() for b in blocks if b and b.strip()) + "\n"


def _text_footer(locale: str, origin: str | None) -> str:
    chrome = _CHROME[normalize_locale(locale)]
    return f"— Stinky · Miaurmario · {_asset_origin(origin)}\n{chrome['tagline']}"


# --------------------------------------------------------------------------- #
# Magic link
# --------------------------------------------------------------------------- #

_MAGIC_LINK = {
    "es": {
        "subject": "Tu enlace para entrar en Miaurmario",
        "preheader": "Un toque y estás dentro. El enlace caduca en {ttl} minutos.",
        "heading": "Stinky te abre la puerta",
        "intro": "Miau. Alguien (ojalá tú) ha pedido entrar en Miaurmario con este correo. "
        "Pulsa el botón y estarás en tu armario en un momento.",
        "cta": "Entrar en Miaurmario",
        "validity": "El enlace caduca en {ttl} minutos y solo funciona una vez.",
        "ignore": "Si no lo has pedido tú, ignóralo: sin este enlace nadie puede entrar en tu "
        "cuenta. Stinky sigue vigilando.",
        "password_hint": "¿Olvidaste tu contraseña? Entra con este enlace y cámbiala en "
        "Ajustes → Seguridad.",
    },
    "en": {
        "subject": "Your Miaurmario sign-in link",
        "preheader": "One tap and you're in. The link expires in {ttl} minutes.",
        "heading": "Stinky is holding the door",
        "intro": "Meow. Someone (hopefully you) asked to sign in to Miaurmario with this "
        "email. Tap the button and you'll be in your wardrobe in a moment.",
        "cta": "Sign in to Miaurmario",
        "validity": "The link expires in {ttl} minutes and works only once.",
        "ignore": "If you didn't ask for it, just ignore this email: nobody can get into your "
        "account without this link. Stinky is keeping watch.",
        "password_hint": "Forgot your password? Sign in with this link and change it in "
        "Settings → Security.",
    },
}


def render_magic_link_email(
    url: str,
    *,
    locale: str | None = None,
    ttl_minutes: int = 15,
    origin: str | None = None,
) -> RenderedEmail:
    loc = normalize_locale(locale)
    c = {k: v.format(ttl=ttl_minutes) for k, v in _MAGIC_LINK[loc].items()}
    body = _p(escape(c["intro"])) + _p(
        f"<strong>{escape(c['validity'])}</strong>",
        style=f"font-size:14px; color:{INK}; background:{PINK_SOFT}; padding:10px 14px; border-radius:14px;",
    )
    after = _p(escape(c["ignore"])) + _p(escape(c["password_hint"]), style="margin:0;")
    html = _layout(
        locale=loc,
        title=c["subject"],
        preheader=c["preheader"],
        heading=c["heading"],
        body_html=body,
        cta_label=c["cta"],
        cta_url=url,
        after_cta_html=after,
        origin=origin,
    )
    text = _text(
        c["heading"],
        c["intro"],
        f"{c['cta']}: {url}",
        c["validity"],
        c["ignore"],
        c["password_hint"],
        _text_footer(loc, origin),
    )
    return RenderedEmail(subject=c["subject"], html=html, text=text)


# --------------------------------------------------------------------------- #
# Family invite
# --------------------------------------------------------------------------- #

_INVITE = {
    "es": {
        "subject": "{inviter} te invita a {family} en Miaurmario",
        "preheader": "Comparte armario, conjuntos y valoraciones con tu familia.",
        "heading": "¡Te han invitado a una familia!",
        "intro": "<strong>{inviter}</strong> quiere compartir armario contigo en la familia "
        "<strong>{family}</strong>. Stinky ya te ha hecho sitio en el sofá.",
        "cta": "Aceptar invitación",
        "note": "Si aún no tienes cuenta en Miaurmario, te pediremos crearla primero: "
        "solo necesitas tu email.",
        "ignore": "¿No conoces a {inviter}? Ignora este correo y no pasará nada.",
    },
    "en": {
        "subject": "{inviter} invited you to {family} on Miaurmario",
        "preheader": "Share wardrobes, outfits and ratings with your family.",
        "heading": "You're invited to a family!",
        "intro": "<strong>{inviter}</strong> wants to share wardrobes with you in the "
        "<strong>{family}</strong> family. Stinky already saved you a spot on the sofa.",
        "cta": "Accept invitation",
        "note": "If you don't have a Miaurmario account yet, we'll ask you to create one "
        "first: all you need is your email.",
        "ignore": "Don't know {inviter}? Ignore this email and nothing will happen.",
    },
}


def render_family_invite_email(
    *,
    inviter_name: str,
    family_name: str,
    invite_url: str,
    locale: str | None = None,
    origin: str | None = None,
) -> RenderedEmail:
    loc = normalize_locale(locale)
    c = _INVITE[loc]
    inviter_e, family_e = escape(inviter_name), escape(family_name)
    subject = c["subject"].format(inviter=inviter_name, family=family_name)
    html = _layout(
        locale=loc,
        title=subject,
        preheader=c["preheader"],
        heading=c["heading"],
        body_html=_p(c["intro"].format(inviter=inviter_e, family=family_e)),
        cta_label=c["cta"],
        cta_url=invite_url,
        after_cta_html=_p(escape(c["note"]))
        + _p(escape(c["ignore"].format(inviter=inviter_name)), style="margin:0;"),
        origin=origin,
    )
    plain_intro = (
        c["intro"]
        .replace("<strong>", "")
        .replace("</strong>", "")
        .format(inviter=inviter_name, family=family_name)
    )
    text = _text(
        c["heading"],
        plain_intro,
        f"{c['cta']}: {invite_url}",
        c["note"],
        c["ignore"].format(inviter=inviter_name),
        _text_footer(loc, origin),
    )
    return RenderedEmail(subject=subject, html=html, text=text)


# --------------------------------------------------------------------------- #
# Generic notification (wash reminders, etc.) and outfit of the day
# --------------------------------------------------------------------------- #


def _manage_link(locale: str, origin: str | None, unsubscribe_url: str | None = None) -> str:
    chrome = _CHROME[normalize_locale(locale)]
    url = escape(f"{_asset_origin(origin)}/dashboard/notifications", quote=True)
    html = (
        f'<br><a href="{url}" style="color:{MUTED}; text-decoration:underline;">'
        f"{escape(chrome['manage'])}</a>"
    )
    if unsubscribe_url:
        html += (
            f' &middot; <a href="{escape(unsubscribe_url, quote=True)}" '
            f'style="color:{MUTED}; text-decoration:underline;">'
            f"{escape(chrome['unsubscribe'])}</a>"
        )
    return html


def _text_unsubscribe(locale: str, unsubscribe_url: str | None) -> str:
    if not unsubscribe_url:
        return ""
    return f"{_CHROME[normalize_locale(locale)]['unsubscribe']}: {unsubscribe_url}"


def render_notification_email(
    *,
    subject: str,
    heading: str,
    body: str,
    cta_text: str,
    cta_url: str,
    locale: str | None = None,
    origin: str | None = None,
) -> RenderedEmail:
    loc = normalize_locale(locale)
    html = _layout(
        locale=loc,
        title=subject,
        preheader=body[:120],
        heading=heading,
        body_html=_p(escape(body)),
        cta_label=cta_text,
        cta_url=cta_url,
        footer_links_html=_manage_link(loc, origin),
        origin=origin,
    )
    text = _text(heading, body, f"{cta_text}: {cta_url}", _text_footer(loc, origin))
    return RenderedEmail(subject=subject, html=html, text=text)


_OUTFIT = {
    "es": {
        "today": "de hoy",
        "tomorrow": "de mañana",
        "subject": "Tu conjunto {day}: {occasion}",
        "heading": "Tu conjunto {day} está listo",
        "occasion": "Ocasión",
        "forecast": "previsión",
        "fallback": "Tu conjunto está listo. Te lo he dejado preparado antes de la siesta.",
        "tip": "Consejo de Stinky",
        "cta": "Ver conjunto",
    },
    "en": {
        "today": "for today",
        "tomorrow": "for tomorrow",
        "subject": "Your outfit {day}: {occasion}",
        "heading": "Your outfit {day} is ready",
        "occasion": "Occasion",
        "forecast": "forecast",
        "fallback": "Your outfit is ready. I left it out for you before my nap.",
        "tip": "Stinky's tip",
        "cta": "View outfit",
    },
}


def render_outfit_email(
    *,
    occasion: str,
    reasoning: str | None,
    highlights: list[str],
    style_notes: str | None,
    temperature: object | None,
    condition: str | None,
    for_tomorrow: bool,
    cta_url: str,
    locale: str | None = None,
    origin: str | None = None,
    unsubscribe_url: str | None = None,
) -> RenderedEmail:
    loc = normalize_locale(locale)
    c = _OUTFIT[loc]
    day = c["tomorrow"] if for_tomorrow else c["today"]
    raw_occasion = occasion_label_es(occasion) if loc == "es" else occasion.replace("_", " ")
    occasion_t = raw_occasion.title()
    subject = c["subject"].format(day=day, occasion=occasion_t)
    heading = c["heading"].format(day=day)
    reasoning_t = reasoning or c["fallback"]

    weather_t = ""
    if temperature is not None or condition:
        weather_t = f"{temperature if temperature is not None else '?'}°C"
        if condition:
            weather_t += f", {condition}"
        if for_tomorrow:
            weather_t += f" ({c['forecast']})"

    meta = f"{escape(c['occasion'])}: <strong>{escape(occasion_t)}</strong>"
    if weather_t:
        meta += f" &middot; {escape(weather_t)}"
    body = _p(meta, style=f"font-size:14px; color:{MUTED};") + _p(escape(reasoning_t))
    if highlights:
        items = "".join(
            f'<li style="margin:0 0 6px 0;">{escape(str(h))}</li>' for h in highlights[:3]
        )
        body += f'<ul style="margin:0 0 14px 0; padding-left:20px;">{items}</ul>'
    if style_notes:
        body += _p(
            f"<strong>{escape(c['tip'])}:</strong> {escape(style_notes)}",
            style=f"font-size:14px; background:{PINK_SOFT}; padding:10px 14px; border-radius:14px;",
        )

    html = _layout(
        locale=loc,
        title=subject,
        preheader=reasoning_t[:120],
        heading=heading,
        body_html=body,
        cta_label=c["cta"],
        cta_url=cta_url,
        footer_links_html=_manage_link(loc, origin, unsubscribe_url),
        origin=origin,
    )
    lines = [f"{c['occasion']}: {occasion_t}" + (f" · {weather_t}" if weather_t else "")]
    text = _text(
        heading,
        "\n".join(lines),
        reasoning_t,
        "\n".join(f"- {h}" for h in highlights[:3]),
        f"{c['tip']}: {style_notes}" if style_notes else "",
        f"{c['cta']}: {cta_url}",
        _text_footer(loc, origin),
        _text_unsubscribe(loc, unsubscribe_url),
    )
    return RenderedEmail(subject=subject, html=html, text=text)


# --------------------------------------------------------------------------- #
# Social: friend request received / accepted
# --------------------------------------------------------------------------- #

_FRIEND_REQUEST = {
    "es": {
        "subject": "@{username} quiere ser tu amigo en Miaurmario",
        "preheader": "Acepta y veréis los looks que compartís.",
        "heading": "¡Tienes una solicitud de amistad!",
        "intro": "<strong>@{username}</strong> quiere añadirte como amigo en Miaurmario. "
        "Si aceptas, podréis ver los looks que compartís y reaccionar a ellos.",
        "cta": "Ver solicitud",
        "note": "¿No conoces a @{username}? Puedes rechazarla o bloquearle desde Amigos: "
        "no se enterará.",
    },
    "en": {
        "subject": "@{username} wants to be your friend on Miaurmario",
        "preheader": "Accept and you'll see each other's shared looks.",
        "heading": "You have a friend request!",
        "intro": "<strong>@{username}</strong> wants to add you as a friend on Miaurmario. "
        "If you accept, you'll see each other's shared looks and can react to them.",
        "cta": "View request",
        "note": "Don't know @{username}? You can decline or block them from Friends: "
        "they won't be told.",
    },
}

_FRIEND_ACCEPTED = {
    "es": {
        "subject": "@{username} ha aceptado tu solicitud",
        "preheader": "Ya sois amigos en Miaurmario.",
        "heading": "¡Ya sois amigos!",
        "intro": "<strong>@{username}</strong> ha aceptado tu solicitud de amistad. "
        "A partir de ahora veréis los looks que compartís. Stinky da el visto bueno "
        "desde el sofá.",
        "cta": "Ver amigos",
        "note": "",
    },
    "en": {
        "subject": "@{username} accepted your friend request",
        "preheader": "You're now friends on Miaurmario.",
        "heading": "You're friends now!",
        "intro": "<strong>@{username}</strong> accepted your friend request. From now on "
        "you'll see each other's shared looks. Stinky gives it the nod from the sofa.",
        "cta": "View friends",
        "note": "",
    },
}


def _render_social_email(
    copy: dict[str, dict[str, str]],
    *,
    username: str,
    cta_url: str,
    locale: str | None,
    origin: str | None,
    unsubscribe_url: str | None,
) -> RenderedEmail:
    loc = normalize_locale(locale)
    c = copy[loc]
    subject = c["subject"].format(username=username)
    note = c["note"].format(username=username)
    html = _layout(
        locale=loc,
        title=subject,
        preheader=c["preheader"],
        heading=c["heading"],
        body_html=_p(c["intro"].format(username=escape(username))),
        cta_label=c["cta"],
        cta_url=cta_url,
        after_cta_html=_p(escape(note), style="margin:0;") if note else "",
        footer_links_html=_manage_link(loc, origin, unsubscribe_url),
        origin=origin,
    )
    plain_intro = (
        c["intro"].replace("<strong>", "").replace("</strong>", "").format(username=username)
    )
    text = _text(
        c["heading"],
        plain_intro,
        f"{c['cta']}: {cta_url}",
        note,
        _text_footer(loc, origin),
        _text_unsubscribe(loc, unsubscribe_url),
    )
    return RenderedEmail(subject=subject, html=html, text=text)


def render_friend_request_email(
    *,
    username: str,
    cta_url: str,
    locale: str | None = None,
    origin: str | None = None,
    unsubscribe_url: str | None = None,
) -> RenderedEmail:
    return _render_social_email(
        _FRIEND_REQUEST,
        username=username,
        cta_url=cta_url,
        locale=locale,
        origin=origin,
        unsubscribe_url=unsubscribe_url,
    )


def render_friend_accepted_email(
    *,
    username: str,
    cta_url: str,
    locale: str | None = None,
    origin: str | None = None,
    unsubscribe_url: str | None = None,
) -> RenderedEmail:
    return _render_social_email(
        _FRIEND_ACCEPTED,
        username=username,
        cta_url=cta_url,
        locale=locale,
        origin=origin,
        unsubscribe_url=unsubscribe_url,
    )


_TEST = {
    "es": {
        "subject": "Miaurmario: correo de prueba",
        "heading": "¡Funciona!",
        "body": "Si lees esto, las notificaciones por email de Miaurmario están bien "
        "configuradas. Stinky lo aprueba con un ronroneo.",
    },
    "en": {
        "subject": "Miaurmario: test email",
        "heading": "It works!",
        "body": "If you can read this, Miaurmario email notifications are set up correctly. "
        "Stinky approves with a purr.",
    },
}


def render_test_email(*, locale: str | None = None, origin: str | None = None) -> RenderedEmail:
    loc = normalize_locale(locale)
    c = _TEST[loc]
    html = _layout(
        locale=loc,
        title=c["subject"],
        preheader=c["body"][:120],
        heading=c["heading"],
        body_html=_p(escape(c["body"])),
        footer_links_html=_manage_link(loc, origin),
        origin=origin,
    )
    return RenderedEmail(
        subject=c["subject"],
        html=html,
        text=_text(c["heading"], c["body"], _text_footer(loc, origin)),
    )


# --------------------------------------------------------------------------- #
# Waitlist approved (closed beta)
# --------------------------------------------------------------------------- #

_WAITLIST_APPROVED = {
    "es": {
        "subject": "¡Estás dentro de Miaurmario!",
        "preheader": "Stinky te abre la puerta: tu invitación te espera.",
        "heading": "¡Estás dentro! Stinky te abre la puerta",
        "intro": "Miau{name}. Te apuntaste a la lista de espera de Miaurmario y ya tienes sitio "
        "en la beta. Pulsa el botón, escribe este mismo correo y te mandamos tu enlace "
        "para entrar.",
        "cta": "Entrar en Miaurmario",
        "validity": "La invitación es solo para este correo, sirve una vez y caduca en "
        "{days} días.",
        "ignore": "¿No te suena haberte apuntado? Ignora este correo y no pasará nada.",
    },
    "en": {
        "subject": "You're in: welcome to Miaurmario!",
        "preheader": "Stinky is holding the door: your invitation is waiting.",
        "heading": "You're in! Stinky is holding the door",
        "intro": "Meow{name}. You joined the Miaurmario waitlist and there's a spot for you in "
        "the beta now. Tap the button, enter this same email and we'll send your sign-in "
        "link.",
        "cta": "Join Miaurmario",
        "validity": "The invitation only works for this email, once, and expires in {days} days.",
        "ignore": "Don't remember signing up? Ignore this email and nothing will happen.",
    },
}


def render_waitlist_approved_email(
    *,
    invite_url: str,
    name: str | None = None,
    locale: str | None = None,
    valid_days: int = 14,
    origin: str | None = None,
) -> RenderedEmail:
    loc = normalize_locale(locale)
    c = _WAITLIST_APPROVED[loc]
    name_part = f", {name.strip()}" if name and name.strip() else ""
    intro = c["intro"].format(name=name_part)
    validity = c["validity"].format(days=valid_days)
    body = _p(escape(intro)) + _p(
        f"<strong>{escape(validity)}</strong>",
        style=f"font-size:14px; color:{INK}; background:{PINK_SOFT}; padding:10px 14px; "
        "border-radius:14px;",
    )
    html = _layout(
        locale=loc,
        title=c["subject"],
        preheader=c["preheader"],
        heading=c["heading"],
        body_html=body,
        cta_label=c["cta"],
        cta_url=invite_url,
        after_cta_html=_p(escape(c["ignore"]), style="margin:0;"),
        origin=origin,
    )
    text = _text(
        c["heading"],
        intro,
        f"{c['cta']}: {invite_url}",
        validity,
        c["ignore"],
        _text_footer(loc, origin),
    )
    return RenderedEmail(subject=c["subject"], html=html, text=text)


# --------------------------------------------------------------------------- #
# Heads-up emails for site admins (Spanish only; admins are the owner):
# a new waitlist request, and someone asking for a Spotify seat
# --------------------------------------------------------------------------- #


def render_spotify_seat_email(
    *,
    spotify_email: str,
    requester_name: str | None,
    requester_email: str | None,
    cta_url: str,
    origin: str | None = None,
) -> RenderedEmail:
    """A user asks to be added to the Spotify app's User Management allowlist.

    Spotify's Development Mode caps the app at a handful of manually added
    accounts, so the only way in is the owner pasting ``spotify_email`` into the
    Spotify dashboard. This email is that to-do.
    """
    name = (requester_name or "").strip()
    who = name or requester_email or "Alguien"
    subject = f"{who} pide plaza de Spotify"
    heading = "Plaza de Spotify pedida"
    lines = [
        f"<strong>{escape(who)}</strong> quiere conectar Spotify en Miaurmario.",
        f"Correo de su cuenta de Spotify: <strong>{escape(spotify_email)}</strong>",
        "Añádelo en el panel de Spotify (tu app → User Management) y avísale cuando esté.",
    ]
    body = "".join(_p(line) for line in lines)
    html = _layout(
        locale="es",
        title=subject,
        preheader=f"Añade {spotify_email} en User Management.",
        heading=heading,
        body_html=body,
        cta_label="Abrir el panel de Spotify",
        cta_url=cta_url,
        origin=origin,
    )
    text = _text(
        heading,
        f"{who} quiere conectar Spotify en Miaurmario.",
        f"Correo de su cuenta de Spotify: {spotify_email}",
        "Añádelo en el panel de Spotify (tu app -> User Management) y avísale cuando esté.",
        f"Panel de Spotify: {cta_url}",
    )
    return RenderedEmail(subject=subject, html=html, text=text)


def render_waitlist_admin_email(
    *,
    email: str,
    name: str | None,
    message: str | None,
    pending: int,
    cta_url: str,
    origin: str | None = None,
) -> RenderedEmail:
    who = name.strip() if name and name.strip() else email
    subject = f"{who} quiere entrar en Miaurmario"
    heading = "Nueva solicitud en la lista de espera"
    lines = [f"<strong>{escape(who)}</strong> ({escape(email)}) ha pedido acceso a la beta."]
    if message:
        lines.append(f"«{escape(message)}»")
    pending_line = (
        "Es la única solicitud pendiente."
        if pending <= 1
        else f"Tienes {pending} solicitudes pendientes."
    )
    body = "".join(_p(line) for line in lines) + _p(escape(pending_line))
    html = _layout(
        locale="es",
        title=subject,
        preheader=f"{who} ha pedido acceso. {pending_line}",
        heading=heading,
        body_html=body,
        cta_label="Revisar solicitudes",
        cta_url=cta_url,
        origin=origin,
    )
    text = _text(
        heading,
        f"{who} ({email}) ha pedido acceso a la beta.",
        f"«{message}»" if message else "",
        pending_line,
        f"Revisar solicitudes: {cta_url}",
    )
    return RenderedEmail(subject=subject, html=html, text=text)


# --------------------------------------------------------------------------- #
# Daily alerts: the look of the morning, and what friends did
# --------------------------------------------------------------------------- #

_MORNING_LOOK = {
    "es": {
        "subject": "Tu look de la mañana",
        "preheader": "Lo que te he preparado para hoy.",
        "heading": "Tu look de la mañana",
        "intro": "Esto es lo que te he preparado para hoy:",
        "cta": "Ver en Hoy",
        "note": "Si hoy te apetece otra cosa, pide otra idea en Hoy: no me ofendo.",
    },
    "en": {
        "subject": "Your morning look",
        "preheader": "What I put together for you today.",
        "heading": "Your morning look",
        "intro": "Here's what I put together for you today:",
        "cta": "Open Today",
        "note": "Fancy something else today? Ask for another idea in Today: no offence taken.",
    },
}


def render_morning_look_email(
    *,
    line: str,
    items: list[str],
    cta_url: str,
    locale: str | None = None,
    origin: str | None = None,
    unsubscribe_url: str | None = None,
) -> RenderedEmail:
    """The one-line morning suggestion ("9 °C y lluvia: vaqueros, jersey y botas")."""
    loc = normalize_locale(locale)
    c = _MORNING_LOOK[loc]
    body = _p(escape(c["intro"]), style=f"font-size:14px; color:{MUTED};") + _p(
        f"<strong>{escape(line)}</strong>",
        style=f"font-size:17px; background:{PINK_SOFT}; padding:12px 16px; border-radius:14px;",
    )
    if items:
        rows = "".join(f'<li style="margin:0 0 6px 0;">{escape(i)}</li>' for i in items[:6])
        body += f'<ul style="margin:0 0 14px 0; padding-left:20px;">{rows}</ul>'
    html = _layout(
        locale=loc,
        title=c["subject"],
        preheader=line[:120] or c["preheader"],
        heading=c["heading"],
        body_html=body,
        cta_label=c["cta"],
        cta_url=cta_url,
        after_cta_html=_p(escape(c["note"]), style="margin:0;"),
        footer_links_html=_manage_link(loc, origin, unsubscribe_url),
        origin=origin,
    )
    text = _text(
        c["heading"],
        c["intro"],
        line,
        "\n".join(f"- {i}" for i in items[:6]),
        f"{c['cta']}: {cta_url}",
        c["note"],
        _text_footer(loc, origin),
        _text_unsubscribe(loc, unsubscribe_url),
    )
    return RenderedEmail(subject=c["subject"], html=html, text=text)


_FRIEND_ACTIVITY = {
    "es": {
        "subject": "Movimiento de amigos",
        "preheader": "Lo que ha pasado hoy entre tus amigos.",
        "heading": "Movimiento de amigos",
        "intro": "Resumen de hoy, todo junto para no darte la lata:",
        "cta": "Ver en Amigos",
        "note": "Un solo aviso al día como máximo, a la hora que tú elijas.",
    },
    "en": {
        "subject": "Friend activity",
        "preheader": "What your friends got up to today.",
        "heading": "Friend activity",
        "intro": "Today's round-up, all in one go so I don't pester you:",
        "cta": "Open Friends",
        "note": "One message a day at most, at the time you pick.",
    },
}


def render_friend_activity_email(
    *,
    lines: list[str],
    cta_url: str,
    locale: str | None = None,
    origin: str | None = None,
    unsubscribe_url: str | None = None,
) -> RenderedEmail:
    """The batched daily digest of reactions to your looks and friends' new looks."""
    loc = normalize_locale(locale)
    c = _FRIEND_ACTIVITY[loc]
    body = _p(escape(c["intro"]), style=f"font-size:14px; color:{MUTED};")
    rows = "".join(f'<li style="margin:0 0 8px 0;">{escape(line)}</li>' for line in lines)
    body += f'<ul style="margin:0 0 14px 0; padding-left:20px; font-size:16px;">{rows}</ul>'
    html = _layout(
        locale=loc,
        title=c["subject"],
        preheader=(" · ".join(lines))[:120] or c["preheader"],
        heading=c["heading"],
        body_html=body,
        cta_label=c["cta"],
        cta_url=cta_url,
        after_cta_html=_p(escape(c["note"]), style="margin:0;"),
        footer_links_html=_manage_link(loc, origin, unsubscribe_url),
        origin=origin,
    )
    text = _text(
        c["heading"],
        c["intro"],
        "\n".join(f"- {line}" for line in lines),
        f"{c['cta']}: {cta_url}",
        c["note"],
        _text_footer(loc, origin),
        _text_unsubscribe(loc, unsubscribe_url),
    )
    return RenderedEmail(subject=c["subject"], html=html, text=text)
