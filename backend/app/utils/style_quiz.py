"""«Tu estilo con Stinky»: the swipe deck's vocabulary and what it means.

The cards the user swipes are pure taste — looks, silhouettes and palettes —
never anything about their body. The **copy** lives in the frontend messages
(``firstRun.styleQuiz.cards.<id>``); what a card *means* lives here, because
both the stylist prompts and the non-AI scorer need the same mapping:

* ``styles`` are item ``style`` tags (see ``STYLE_TAGS_ES`` in
  ``app.utils.style_profile``) — a liked card lifts items carrying them.
* ``colors`` are item colour tags — a liked palette lifts those colours.
* ``label_es`` is the short Spanish name used in the prompt block and in the
  "esto he entendido" summary, so the user reads exactly what Stinky reads.

Keep the id list in sync with ``frontend/lib/style-quiz/cards.ts``; unknown ids
coming from an older/newer client are dropped rather than rejected.

Besides the cards, the quiz stores two optional preferences about *clothes*:

* ``garment_pref`` — which section of a shop the user wants to be dressed from.
  It is asked, never inferred, and leaving it unanswered is a first-class answer
  that changes nothing anywhere.
* ``layering`` — «Me gusta superponer prendas», off by default. It is the one
  answer about *how* to combine what they own, and it is a permission rather
  than an instruction (see ``LAYERING_PROMPT_ES``).

Habitual sizes are deliberately **not** here: they live with the other
measurements on the user, so there is one place that knows them.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from app.utils.style_profile import COLOR_NAMES_ES

StyleCardCategory = Literal["aesthetic", "silhouette", "palette"]


@dataclass(frozen=True)
class StyleCard:
    id: str
    category: StyleCardCategory
    label_es: str
    styles: tuple[str, ...] = ()
    colors: tuple[str, ...] = ()


STYLE_CARDS: tuple[StyleCard, ...] = (
    # --- Looks / aesthetics -------------------------------------------------
    StyleCard("minimal", "aesthetic", "minimalismo limpio", ("minimalist", "modern")),
    StyleCard("streetwear", "aesthetic", "streetwear", ("streetwear", "casual")),
    StyleCard("tailored", "aesthetic", "sastrería", ("formal", "elegant", "smart-casual")),
    StyleCard("boho", "aesthetic", "bohemio", ("bohemian",)),
    StyleCard("preppy", "aesthetic", "preppy", ("preppy", "classic")),
    StyleCard("vintage", "aesthetic", "vintage y segunda mano", ("vintage",)),
    StyleCard("sporty", "aesthetic", "deportivo y athleisure", ("sporty", "athletic")),
    StyleCard("romantic", "aesthetic", "romántico y fluido", ("elegant", "bohemian")),
    StyleCard("utility", "aesthetic", "workwear y utilitario", ("rugged", "casual")),
    # --- Silhouettes --------------------------------------------------------
    StyleCard("oversize", "silhouette", "volúmenes holgados", ("streetwear", "casual")),
    StyleCard("fitted", "silhouette", "líneas ajustadas", ("elegant", "modern")),
    StyleCard("wide-leg", "silhouette", "pantalón ancho", ("modern",)),
    StyleCard("layers", "silhouette", "capas largas", ("modern",)),
    # --- Colour palettes ----------------------------------------------------
    StyleCard("monochrome", "palette", "un solo color de arriba abajo"),
    StyleCard(
        "neutrals",
        "palette",
        "neutros cálidos",
        colors=("beige", "cream", "tan", "khaki", "brown"),
    ),
    StyleCard("black-white", "palette", "blanco y negro", colors=("black", "white", "gray")),
    StyleCard("pastels", "palette", "pasteles", colors=("light-blue", "pink", "cream")),
    StyleCard("brights", "palette", "colores vivos", colors=("red", "yellow", "orange", "green")),
    StyleCard(
        "jewel",
        "palette",
        "tonos profundos",
        colors=("burgundy", "navy", "olive", "purple", "teal"),
    ),
)

STYLE_CARDS_BY_ID: dict[str, StyleCard] = {c.id: c for c in STYLE_CARDS}
STYLE_CARD_IDS: tuple[str, ...] = tuple(c.id for c in STYLE_CARDS)

#: "¿Qué ropa quieres que te proponga Stinky?" — a preference about *clothes*,
#: the section they want to be dressed from. It is never a statement about the
#: person, and nothing else in the app may infer it from a name, a photo, a
#: handle or a wardrobe. Unanswered (``None``) and ``"sin_decir"`` behave
#: exactly like ``"ambas"``: no line reaches any prompt.
GARMENT_PREFS: tuple[str, ...] = ("masculina", "femenina", "ambas", "sin_decir")

#: The only two values that change a prompt, and what they change: the words
#: used for garments, and which section to look in for something not owned yet.
GARMENT_PREF_PROMPT_ES: dict[str, str] = {
    "masculina": (
        "- Ropa que quiere que le proponga: de la sección masculina. Usa ese "
        "vocabulario al nombrar prendas (camisa, pantalón, jersey) y, si le "
        "sugieres algo que todavía no tiene, búscalo ahí. Es una preferencia "
        "de ropa: no digas nada sobre la persona."
    ),
    "femenina": (
        "- Ropa que quiere que le proponga: de la sección femenina. Usa ese "
        "vocabulario al nombrar prendas (blusa, falda, vestido) y, si le "
        "sugieres algo que todavía no tiene, búscalo ahí. Es una preferencia "
        "de ropa: no digas nada sobre la persona."
    ),
}

#: Read back to the user in "esto he entendido". "sin_decir" is a refusal, so
#: it is never echoed.
GARMENT_PREF_SUMMARY_ES: dict[str, str] = {
    "masculina": "Te propongo ropa de la sección masculina.",
    "femenina": "Te propongo ropa de la sección femenina.",
    "ambas": "Te propongo ropa de cualquier sección.",
}

FIT_CHOICES: tuple[str, ...] = ("holgado", "ajustado", "mixto")
FIT_ES: dict[str, str] = {
    "holgado": "holgado y con aire",
    "ajustado": "ajustado y limpio",
    "mixto": "mezcla: una parte holgada y la otra ajustada",
}

#: «Me gusta superponer prendas» — the one thing the quiz says about *how* to
#: combine what the user owns rather than about what they like. Off by default:
#: with it off nothing anywhere behaves differently from before it existed.
#:
#: It is a **permission, never an obligation**. The stylist may put a dress over
#: trousers or a top under another top when the look asks for it, and is told in
#: as many words that one piece is still a perfectly good answer.
LAYERING_PROMPT_ES = (
    "- Puede combinar capas: un vestido sobre pantalón, un top bajo otro top, "
    "una camisa bajo un vestido — solo si queda bien. Es un permiso, no una "
    "obligación: si el look pide una sola pieza, déjalo en una."
)

LAYERING_SUMMARY_ES = "Puedo superponer prendas: un vestido sobre pantalón, un top bajo otro top."

#: Shape of the stored dict. Bump only when a reader has to branch on it.
QUIZ_VERSION = 1

#: Free-text answers: chips, so short and few. Longer input is trimmed, not refused.
MAX_CHIPS = 12
MAX_CHIP_LENGTH = 60

#: The answers themselves — everything ``is_answered`` looks at. ``version``,
#: ``updated_at`` and ``completed`` are bookkeeping, not answers.
ANSWER_FIELDS: tuple[str, ...] = (
    "liked",
    "disliked",
    "brands",
    "never_wear",
    "colors_avoid",
    "occasions",
    "fit",
    "garment_pref",
    "layering",
)


def empty_quiz() -> dict[str, Any]:
    """The shape every reader can rely on, for a user who has not answered."""
    return {
        "liked": [],
        "disliked": [],
        "brands": [],
        "never_wear": [],
        "colors_avoid": [],
        "occasions": [],
        "fit": None,
        "garment_pref": None,
        "layering": False,
        "completed": False,
        "version": QUIZ_VERSION,
        "updated_at": None,
    }


def _clean_chips(values: Any) -> list[str]:
    """Trim, drop blanks, de-duplicate case-insensitively, cap the count."""
    if not isinstance(values, (list, tuple)):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for raw in values:
        if not isinstance(raw, str):
            continue
        text = " ".join(raw.split())[:MAX_CHIP_LENGTH].strip()
        if not text or text.casefold() in seen:
            continue
        seen.add(text.casefold())
        out.append(text)
        if len(out) >= MAX_CHIPS:
            break
    return out


def _clean_cards(values: Any, *, exclude: Iterable[str] = ()) -> list[str]:
    """Known card ids only, in catalogue order, never in both piles at once."""
    if not isinstance(values, (list, tuple)):
        return []
    picked = {v for v in values if isinstance(v, str) and v in STYLE_CARDS_BY_ID}
    picked -= set(exclude)
    return [cid for cid in STYLE_CARD_IDS if cid in picked]


def normalize_quiz(data: Mapping[str, Any] | None) -> dict[str, Any]:
    """Whatever is stored or posted -> the canonical, safe quiz dict.

    Liking wins over disliking when a card somehow ends up in both piles, and
    anything unknown is dropped: this runs on user input and on rows written by
    older versions of the app.
    """
    src: Mapping[str, Any] = data if isinstance(data, Mapping) else {}
    liked = _clean_cards(src.get("liked"))
    quiz = empty_quiz()
    quiz["liked"] = liked
    quiz["disliked"] = _clean_cards(src.get("disliked"), exclude=liked)
    quiz["brands"] = _clean_chips(src.get("brands"))
    quiz["never_wear"] = _clean_chips(src.get("never_wear"))
    quiz["colors_avoid"] = _clean_chips(src.get("colors_avoid"))
    quiz["occasions"] = _clean_chips(src.get("occasions"))
    fit = src.get("fit")
    quiz["fit"] = fit if fit in FIT_CHOICES else None
    garment_pref = src.get("garment_pref")
    quiz["garment_pref"] = garment_pref if garment_pref in GARMENT_PREFS else None
    quiz["layering"] = bool(src.get("layering"))
    quiz["completed"] = bool(src.get("completed"))
    # Set server-side on every write; a client-sent value is ignored.
    updated_at = src.get("updated_at")
    quiz["updated_at"] = updated_at if isinstance(updated_at, str) and updated_at else None
    return quiz


def stamp_now(quiz: Mapping[str, Any]) -> dict[str, Any]:
    """The quiz as saved: canonical, versioned and dated *now*."""
    return {
        **normalize_quiz(quiz),
        "version": QUIZ_VERSION,
        "updated_at": datetime.now(UTC).isoformat(),
    }


def is_answered(quiz: Mapping[str, Any] | None) -> bool:
    """True once the user has told us anything at all."""
    q = normalize_quiz(quiz)
    return any(q[field] for field in ANSWER_FIELDS)


def layering_allowed(quiz: Mapping[str, Any] | None) -> bool:
    """Has the user asked for layered combinations? False unless they said so.

    The single reader for «Me gusta superponer prendas»: the stylist prompts,
    the body-slot rules and the heuristic composer all go through here, so a
    user who never touched the toggle is treated exactly as before.
    """
    return bool(normalize_quiz(quiz)["layering"])


def _labels(card_ids: Iterable[str]) -> str:
    return ", ".join(STYLE_CARDS_BY_ID[c].label_es for c in card_ids if c in STYLE_CARDS_BY_ID)


def quiz_prompt_lines(quiz: Mapping[str, Any] | None) -> list[str]:
    """Bullet lines for ``{style_profile_text}``. Empty when nothing was answered."""
    q = normalize_quiz(quiz)
    lines: list[str] = []
    if q["liked"]:
        lines.append(f"- Le gusta (lo eligió en el test de estilo): {_labels(q['liked'])}")
    if q["disliked"]:
        lines.append(f"- No le va: {_labels(q['disliked'])}")
    if q["fit"]:
        lines.append(f"- Cómo le gusta que le siente la ropa: {FIT_ES[q['fit']]}")
    # Unanswered, "ambas" and "sin_decir" all add nothing: the prompt then
    # behaves exactly as it did before this question existed.
    if q["garment_pref"] in GARMENT_PREF_PROMPT_ES:
        lines.append(GARMENT_PREF_PROMPT_ES[q["garment_pref"]])
    if q["layering"]:
        lines.append(LAYERING_PROMPT_ES)
    if q["colors_avoid"]:
        lines.append(f"- Colores que prefiere no llevar: {', '.join(q['colors_avoid'])}")
    if q["never_wear"]:
        lines.append(f"- No se pone nunca: {', '.join(q['never_wear'])}. No se lo propongas.")
    if q["brands"]:
        lines.append(
            f"- Referencias que le gustan: {', '.join(q['brands'])}. "
            "Úsalas como brújula de gusto, no las nombres ni las imites."
        )
    if q["occasions"]:
        lines.append(f"- Para lo que más se viste: {', '.join(q['occasions'])}")
    return lines


def quiz_summary_lines(quiz: Mapping[str, Any] | None) -> list[str]:
    """ "Esto es lo que he entendido": the same facts, addressed to the user.

    Plain Spanish, about taste only — never about the person.
    """
    q = normalize_quiz(quiz)
    lines: list[str] = []
    if q["liked"]:
        lines.append(f"Te gusta: {_labels(q['liked'])}.")
    if q["disliked"]:
        lines.append(f"No te va: {_labels(q['disliked'])}.")
    if q["fit"]:
        lines.append(f"Prefieres que la ropa te quede {FIT_ES[q['fit']]}.")
    if q["garment_pref"] in GARMENT_PREF_SUMMARY_ES:
        lines.append(GARMENT_PREF_SUMMARY_ES[q["garment_pref"]])
    if q["layering"]:
        lines.append(LAYERING_SUMMARY_ES)
    if q["colors_avoid"]:
        lines.append(f"Evito estos colores: {', '.join(q['colors_avoid'])}.")
    if q["never_wear"]:
        lines.append(f"No te propongo: {', '.join(q['never_wear'])}.")
    if q["brands"]:
        lines.append(f"Tomo nota de tus referencias: {', '.join(q['brands'])}.")
    if q["occasions"]:
        lines.append(f"Te vistes sobre todo para: {', '.join(q['occasions'])}.")
    return lines


@dataclass(frozen=True)
class QuizBias:
    """What the non-AI scorer needs, pre-flattened."""

    liked_styles: frozenset[str]
    disliked_styles: frozenset[str]
    liked_colors: frozenset[str]
    avoided_colors: frozenset[str]

    def __bool__(self) -> bool:
        return bool(
            self.liked_styles or self.disliked_styles or self.liked_colors or self.avoided_colors
        )


def _avoid_color_tags(chips: Iterable[str]) -> set[str]:
    """Free-text "colores que evito" -> colour tags, when they match the vocabulary.

    The user types freely ("rosa chicle"), so we match the Spanish name and the
    English tag as substrings; anything unmatched still reaches the prompt.
    """
    tags: set[str] = set()
    for chip in chips:
        text = chip.casefold()
        for tag, name in COLOR_NAMES_ES.items():
            if name in text or tag in text:
                tags.add(tag)
    return tags


def quiz_bias(quiz: Mapping[str, Any] | None) -> QuizBias:
    """Turn the answers into style/colour sets for ``item_scorer``."""
    q = normalize_quiz(quiz)
    liked_styles: set[str] = set()
    liked_colors: set[str] = set()
    disliked_styles: set[str] = set()
    disliked_colors: set[str] = set()

    for cid in q["liked"]:
        card = STYLE_CARDS_BY_ID[cid]
        liked_styles.update(card.styles)
        liked_colors.update(card.colors)
    for cid in q["disliked"]:
        card = STYLE_CARDS_BY_ID[cid]
        disliked_styles.update(card.styles)
        disliked_colors.update(card.colors)

    # A tag on both sides is ambiguous (e.g. "casual" from streetwear and from
    # utility): the like wins, so a swipe right is never punished.
    disliked_styles -= liked_styles
    disliked_colors -= liked_colors
    avoided = (disliked_colors | _avoid_color_tags(q["colors_avoid"])) - liked_colors

    return QuizBias(
        liked_styles=frozenset(liked_styles),
        disliked_styles=frozenset(disliked_styles),
        liked_colors=frozenset(liked_colors),
        avoided_colors=frozenset(avoided),
    )
