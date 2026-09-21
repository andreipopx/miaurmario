import logging
from functools import lru_cache

from pydantic import Field, PostgresDsn, RedisDsn
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

DEFAULT_SECRET_KEY = "change-me-in-production"

# Nominatim requires an identifying User-Agent with a contact URL.
DEFAULT_GEOCODING_USER_AGENT = "Miaurmario/1.0 (+https://github.com/andreipopx/miaurmario)"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        env_ignore_empty=True,
    )

    # Application
    app_name: str = "Miaurmario"
    debug: bool = False
    secret_key: str = Field(default=DEFAULT_SECRET_KEY)
    studio_disabled: bool = False

    # CORS
    cors_origins: list[str] = Field(
        default=[
            "http://localhost:3000",
            "http://localhost:8081",
            "http://miaurmario.home",
            "https://miaurmario.andreipop.org",
        ]
    )

    # Database
    database_url: PostgresDsn = Field(
        default="postgresql+asyncpg://wardrobe:wardrobe@localhost:5432/wardrobe"
    )
    database_echo: bool = False

    # Redis
    redis_url: RedisDsn = Field(default="redis://localhost:6379/0")

    # Authentication - OIDC
    oidc_issuer_url: str | None = Field(default=None)
    oidc_client_id: str | None = Field(default=None)
    oidc_client_secret: str | None = None
    oidc_mobile_client_id: str | None = None
    oidc_ca_bundle: str | None = Field(default=None)

    # Authentication - API access tokens (HS256 JWT signed with SECRET_KEY).
    # Clients slide the session with POST /auth/refresh, so an active user is
    # never logged out; a token unused for this many days expires.
    access_token_days: int = Field(default=30, ge=1, le=365)

    # Authentication - optional password login (argon2id). Magic link always
    # stays available; this only toggles POST /auth/password/login.
    password_login_enabled: bool = Field(default=True)

    # Authentication - Magic link (Sprint 2)
    resend_api_key: str | None = Field(default=None)
    resend_from_email: str = Field(default="Miaurmario <hola@miaurmario.andreipop.org>")
    # Public origin the emailed link points to. Falls back to APP_URL when unset.
    # Must be fixed config (never derived from the request Host header).
    magic_link_base_url: str | None = Field(default=None)

    # Canonical public origin of the web app (notification/invite links, etc.)
    app_url: str = Field(default="http://localhost:3000")

    # Authorization - admin promotion
    admin_emails: str = Field(default="")

    # AI capability switches.
    # ai_internal_enabled is the master switch; ai_vision_enabled / ai_text_enabled
    # inherit it when left unset (None). Defaults preserve current behavior
    # (internal AI on). When a capability is disabled, no AI client is constructed
    # for it and the corresponding work is deferred to an external agent.
    ai_internal_enabled: bool = Field(default=True)
    ai_vision_enabled: bool | None = Field(default=None)
    ai_text_enabled: bool | None = Field(default=None)

    # AI Service (OpenAI-compatible API - supports Ollama, OpenAI, etc.)
    ai_base_url: str = Field(default="")
    ai_api_key: str | None = Field(default=None)
    ai_vision_model: str = Field(default="gpt-4o")  # comma-separated for model rotation
    ai_text_model: str = Field(default="gpt-4o")  # comma-separated for model rotation
    ai_timeout: int = Field(default=120)
    ai_max_retries: int = Field(default=3)
    ai_max_tokens: int = Field(default=8000)

    # "Habla con Stinky" chat
    stinky_chat_max_tokens: int = Field(default=4000)  # per provider call (reasoning included)
    stinky_chat_turn_token_budget: int = Field(default=60000)  # all calls of one user message
    stinky_chat_max_tool_rounds: int = Field(default=4)
    stinky_chat_max_message_chars: int = Field(default=1000)
    stinky_chat_max_conversations: int = Field(default=30)
    stinky_chat_history_messages: int = Field(default=40)
    stinky_chat_rate_limit_per_minute: int = Field(default=10)
    stinky_chat_rate_limit_per_day: int = Field(default=200)
    # Sent only to api.deepseek.com (other providers may reject the field).
    stinky_chat_reasoning_effort: str | None = Field(default="low")

    # Weather
    openmeteo_url: str = Field(default="https://api.open-meteo.com/v1")
    geocoding_user_agent: str | None = Field(default=None)

    # Music enrichment (Stylist mood input)
    lastfm_api_key: str | None = Field(default=None)
    # Música tab: let users with AI access refine the heuristic daily mood with
    # one small batched LLM call per day (counts towards their AI usage).
    music_mood_ai_enabled: bool = Field(default=True)

    # Notifications - default ntfy channel (used when user has none configured)
    ntfy_server: str | None = None
    ntfy_topic: str | None = None
    ntfy_token: str | None = None
    # Legacy/other providers
    mattermost_webhook_url: str | None = None
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    # Storage
    storage_path: str = Field(default="/data/wardrobe")
    max_upload_size_mb: int = Field(default=10)
    max_bulk_upload_count: int = Field(default=20)

    # Background removal
    bg_removal_provider: str = Field(default="rembg")  # "rembg" or "http"
    bg_removal_model: str = Field(default="u2net")  # rembg model name
    bg_removal_url: str | None = Field(default=None)  # URL for http provider (e.g. withoutbg)
    bg_removal_api_key: str | None = Field(default=None)  # API key for http provider

    # Security headers
    security_headers_enabled: bool = True
    hsts_enabled: bool = False
    hsts_max_age: int = 31536000

    # Image processing
    thumbnail_size: int = 400
    medium_size: int = 800
    original_max_size: int = 2400
    image_quality: int = 90

    # Pinterest integration (Sprint 4)
    pinterest_client_id: str | None = Field(default=None)
    pinterest_client_secret: str | None = Field(default=None)
    pinterest_redirect_uri: str = Field(
        default="https://miaurmario.andreipop.org/api/v1/integrations/pinterest/callback"
    )
    # Legacy name for the integrations Fernet key; still honoured as a fallback.
    pinterest_token_encryption_key: str | None = Field(default=None)

    # Spotify integration (mood input for the Stylist)
    spotify_client_id: str | None = Field(default=None)
    spotify_client_secret: str | None = Field(default=None)
    spotify_redirect_uri: str = Field(
        default="https://miaurmario.andreipop.org/api/v1/integrations/spotify/callback"
    )

    # Fernet key used to cipher third-party OAuth tokens at rest (Pinterest, Spotify).
    # Generate with:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    integrations_token_encryption_key: str | None = Field(default=None)

    # Admin panel: AI cost estimate defaults (editable at runtime from the admin
    # panel; these are only the fallbacks). Prices are USD per 1M tokens
    # (default: DeepSeek off-peak), converted with USD_EUR_RATE.
    ai_price_input_usd_per_m: float = Field(default=0.15, ge=0)
    ai_price_output_usd_per_m: float = Field(default=0.60, ge=0)
    usd_eur_rate: float = Field(default=0.92, gt=0)
    ai_monthly_budget_eur: float | None = Field(default=None, ge=0)

    # Admin panel: system status. BACKUP_STATUS_PATH points at the host's
    # last-backup.json mounted read-only into the backend container, e.g.
    #   /var/lib/backup-pop/last-backup.json:/run/backup-status.json:ro
    backup_status_path: str | None = Field(default=None)
    # Build identification shown in the admin panel (injected at deploy time).
    app_version: str | None = Field(default=None)
    git_sha: str | None = Field(default=None)
    # Spotify apps in development mode allow at most this many users.
    spotify_dev_mode_slots: int = Field(default=5, ge=0)

    # Feedback inbox: screenshot upload limit.
    feedback_max_upload_mb: int = Field(default=5, ge=1, le=20)

    @property
    def effective_ai_vision_enabled(self) -> bool:
        """Whether internal vision (auto-tagging) is active.

        vision = ai_internal_enabled AND ai_vision_enabled, where ai_vision_enabled
        inherits the master switch when unset (None).
        """
        if not self.ai_internal_enabled:
            return False
        return True if self.ai_vision_enabled is None else self.ai_vision_enabled

    @property
    def effective_ai_text_enabled(self) -> bool:
        """Whether internal text (suggestions/pairings) is active.

        text = ai_internal_enabled AND ai_text_enabled, where ai_text_enabled
        inherits the master switch when unset (None).
        """
        if not self.ai_internal_enabled:
            return False
        return True if self.ai_text_enabled is None else self.ai_text_enabled

    @property
    def ai_enabled(self) -> bool:
        """True if any internal AI capability is active."""
        return self.effective_ai_vision_enabled or self.effective_ai_text_enabled

    def validate_security(self) -> str | None:
        if self.secret_key == DEFAULT_SECRET_KEY and not self.debug:
            raise RuntimeError(
                "SECRET_KEY is still the default value. "
                "Set a secure SECRET_KEY or enable DEBUG mode for development."
            )

        oidc_issuer = bool(self.oidc_issuer_url)
        oidc_client = bool(self.oidc_client_id)
        if oidc_issuer != oidc_client:
            raise RuntimeError(
                "OIDC is partially configured: both OIDC_ISSUER_URL and OIDC_CLIENT_ID must be set together."
            )

        oidc_configured = oidc_issuer and oidc_client
        is_dev = self.debug and self.secret_key == DEFAULT_SECRET_KEY
        magic_link_configured = bool(self.resend_api_key)
        if not oidc_configured and not is_dev and not magic_link_configured:
            return (
                "No authentication method configured. "
                "Set OIDC_ISSUER_URL + OIDC_CLIENT_ID, RESEND_API_KEY, or enable DEBUG mode."
            )

        return None

    def get_auth_mode(self) -> str:
        if self.debug and self.secret_key == DEFAULT_SECRET_KEY:
            return "dev"
        if self.oidc_issuer_url and self.oidc_client_id:
            return "oidc"
        if self.resend_api_key:
            return "magic_link"
        return "unknown"

    @property
    def magic_link_origin(self) -> str:
        return (self.magic_link_base_url or self.app_url).rstrip("/")

    @property
    def token_encryption_key(self) -> str | None:
        """Fernet key for integration tokens (new name first, legacy Pinterest name second)."""
        return self.integrations_token_encryption_key or self.pinterest_token_encryption_key

    @property
    def email_asset_origin(self) -> str:
        """Public origin for images embedded in emails (must be reachable from the
        recipient's mail client, so the public magic-link origin wins over APP_URL)."""
        return self.magic_link_origin

    def public_app_url(self) -> str:
        """Public base URL of the frontend for post-OAuth browser redirects.

        Reuses MAGIC_LINK_BASE_URL when it is configured. Otherwise returns "" so
        callers emit a *relative* Location header, which the browser resolves against
        the public URL it actually used. Deliberately does NOT fall back to APP_URL:
        docker-compose.prod.yml always injects APP_URL (defaulting to
        https://localhost:3000), and a relative redirect is correct in every
        deployment. Never derived from the Host header (the Cloudflare tunnel
        rewrites Host to the LAN name).
        """
        if self.magic_link_base_url:
            return self.magic_link_base_url.rstrip("/")
        return ""

    def admin_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.admin_emails.split(",") if e.strip()}

    def get_geocoding_user_agent(self) -> str:
        return self.geocoding_user_agent or DEFAULT_GEOCODING_USER_AGENT


@lru_cache
def get_settings() -> Settings:
    return Settings()
