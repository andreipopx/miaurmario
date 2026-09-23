from typing import Literal

from pydantic import BaseModel, Field

from app.utils.style_quiz import MAX_CHIP_LENGTH, MAX_CHIPS, QUIZ_VERSION


class AIEndpoint(BaseModel):
    name: str = Field(description="Display name for this endpoint")
    url: str = Field(description="Base URL for the AI API (e.g., http://localhost:11434/v1)")
    vision_model: str = Field(default="moondream", description="Model for image analysis")
    text_model: str = Field(default="phi3:mini", description="Model for text generation")
    enabled: bool = Field(default=True, description="Whether this endpoint is active")


class StyleProfile(BaseModel):
    casual: int = Field(default=50, ge=0, le=100, description="Casual style preference 0-100")
    formal: int = Field(default=50, ge=0, le=100, description="Formal style preference 0-100")
    sporty: int = Field(default=50, ge=0, le=100, description="Sporty style preference 0-100")
    minimalist: int = Field(
        default=50, ge=0, le=100, description="Minimalist style preference 0-100"
    )
    bold: int = Field(default=50, ge=0, le=100, description="Bold/statement style preference 0-100")


class PreferenceBase(BaseModel):
    # Color preferences
    color_favorites: list[str] = Field(default_factory=list, description="Favorite colors")
    color_avoid: list[str] = Field(default_factory=list, description="Colors to avoid")

    # Style preferences
    style_profile: StyleProfile = Field(default_factory=StyleProfile)

    # Occasion settings
    default_occasion: str = Field(
        default="casual", description="Default occasion for recommendations"
    )

    # Temperature/comfort
    temperature_unit: str = Field(
        default="celsius",
        pattern="^(celsius|fahrenheit)$",
        description="Preferred temperature display unit",
    )
    temperature_sensitivity: str = Field(
        default="normal",
        pattern="^(low|normal|high)$",
        description="Temperature sensitivity level",
    )
    cold_threshold: int = Field(
        default=10, ge=-20, le=30, description="Temperature (C) considered cold"
    )
    hot_threshold: int = Field(
        default=25, ge=10, le=45, description="Temperature (C) considered hot"
    )
    layering_preference: str = Field(
        default="moderate",
        pattern="^(minimal|moderate|heavy)$",
        description="Layering preference",
    )

    # Recommendation settings
    avoid_repeat_days: int = Field(
        default=7, ge=0, le=30, description="Days before repeating items"
    )
    prefer_underused_items: bool = Field(default=True, description="Prioritize less worn items")
    variety_level: str = Field(
        default="moderate",
        pattern="^(low|moderate|high)$",
        description="Outfit variety preference",
    )

    # AI Settings
    ai_endpoints: list[AIEndpoint] = Field(
        default_factory=list,
        description="AI endpoints in priority order (first available is used)",
    )


class PreferenceCreate(PreferenceBase):
    pass


class PreferenceUpdate(BaseModel):
    color_favorites: list[str] | None = None
    color_avoid: list[str] | None = None
    style_profile: StyleProfile | None = None
    default_occasion: str | None = None
    temperature_unit: str | None = Field(default=None, pattern="^(celsius|fahrenheit)$")
    temperature_sensitivity: str | None = Field(default=None, pattern="^(low|normal|high)$")
    cold_threshold: int | None = Field(default=None, ge=-20, le=30)
    hot_threshold: int | None = Field(default=None, ge=10, le=45)
    layering_preference: str | None = Field(default=None, pattern="^(minimal|moderate|heavy)$")
    avoid_repeat_days: int | None = Field(default=None, ge=0, le=30)
    prefer_underused_items: bool | None = None
    variety_level: str | None = Field(default=None, pattern="^(low|moderate|high)$")
    ai_endpoints: list[AIEndpoint] | None = None


class PreferenceResponse(PreferenceBase):
    class Config:
        from_attributes = True


# --- "Tu estilo con Stinky" ---------------------------------------------------

Chips = list[str]


class StyleQuizProfile(BaseModel):
    """The swipe deck plus the free-text answers.

    Only taste and which clothes to propose, never the person: no body, size or
    "what flatters you" field exists here by design (habitual sizes live with
    the other measurements on the user, not in this block). Unknown card ids and over-long chips are cleaned up
    server-side (``app.utils.style_quiz.normalize_quiz``) instead of rejected,
    so an older or newer client never gets a 422 in the middle of onboarding.
    """

    liked: Chips = Field(default_factory=list, description="Card ids swiped right")
    disliked: Chips = Field(default_factory=list, description="Card ids swiped left")
    brands: Chips = Field(
        default_factory=list, description="Brands, designers or references they like"
    )
    never_wear: Chips = Field(default_factory=list, description="Things they never wear")
    colors_avoid: Chips = Field(default_factory=list, description="Colours they would rather avoid")
    occasions: Chips = Field(default_factory=list, description="What they dress for most")
    fit: Literal["holgado", "ajustado", "mixto"] | None = Field(
        default=None, description="How they like clothes to sit"
    )
    garment_pref: Literal["masculina", "femenina", "ambas", "sin_decir"] | None = Field(
        default=None,
        description=(
            "Which section of a shop to dress them from. Optional; unanswered "
            "behaves exactly like 'ambas' and is never inferred from anything else"
        ),
    )
    completed: bool = Field(
        default=False, description="They reached the end of the deck (vs. skipped)"
    )
    version: int = Field(default=QUIZ_VERSION, description="Shape of the stored answers")
    updated_at: str | None = Field(
        default=None, description="When it was last saved (ISO 8601, set server-side)"
    )


class StyleQuizResponse(BaseModel):
    """The saved answers plus what Stinky understood, in plain Spanish."""

    profile: StyleQuizProfile
    answered: bool = Field(description="They have told us something")
    summary: list[str] = Field(
        default_factory=list, description="Spanish sentences shown back to the user"
    )
    cards: list[str] = Field(default_factory=list, description="Card ids the backend knows")
    max_chips: int = Field(default=MAX_CHIPS)
    max_chip_length: int = Field(default=MAX_CHIP_LENGTH)
