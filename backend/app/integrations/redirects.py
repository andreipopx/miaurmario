"""Browser redirects after an OAuth callback."""

from urllib.parse import urlencode

from fastapi.responses import RedirectResponse

from app.config import get_settings


def frontend_redirect(path: str, **params: str) -> RedirectResponse:
    """Redirect the browser to a frontend page.

    Uses Settings.public_app_url() (MAGIC_LINK_BASE_URL when configured) or a
    relative Location otherwise — never the request Host header, which the
    Cloudflare tunnel rewrites to the LAN name.
    """
    base = get_settings().public_app_url()
    query = f"?{urlencode(params)}" if params else ""
    return RedirectResponse(url=f"{base}{path}{query}", status_code=302)
