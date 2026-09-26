import logging
from collections.abc import Collection, Iterable
from uuid import UUID

logger = logging.getLogger(__name__)

ITEM_ROLE: dict[str, str] = {
    "shirt": "base_top",
    "t-shirt": "base_top",
    "blouse": "base_top",
    "polo": "base_top",
    "tank-top": "base_top",
    "top": "base_top",
    "sweater": "base_top",
    "pants": "bottom",
    "jeans": "bottom",
    "shorts": "bottom",
    "skirt": "bottom",
    "dress": "full_body",
    "jumpsuit": "full_body",
    "cardigan": "mid_layer",
    "vest": "mid_layer",
    "jacket": "outer_layer",
    "blazer": "outer_layer",
    "coat": "outer_layer",
    "hoodie": "outer_layer",
    "shoes": "footwear",
    "sneakers": "footwear",
    "boots": "footwear",
    "sandals": "footwear",
    "socks": "socks",
    "tie": "neckwear",
    "hat": "accessory",
    "scarf": "accessory",
    "belt": "accessory",
    "bag": "accessory",
    "accessories": "accessory",
}


# --- Layered looks -----------------------------------------------------------
#
# Two garments in the same body slot are usually a mistake the stylist made
# (shorts *and* trousers), which is what `deduplicate_by_body_slot` is for. But
# some of those collisions are a deliberate look: a dress over trousers, a top
# under another top, a shirt under a dress. Those are described as *layer keys*
# — the pair of roles involved, order-free, so a role worn twice is the
# one-element key `{"base_top"}`.

#: A collision between two garments in the same slot, as a set of roles.
LayerKey = frozenset[str]


def layer_key(role_a: str, role_b: str) -> LayerKey:
    """The order-free key for one same-slot collision.

    Two garments in the *same* role collapse to a one-element key, which is
    exactly what distinguishes "two tops" from "a dress and a top".
    """
    return frozenset({role_a, role_b})


#: The collisions that read as layering rather than as a slip. Used when the
#: user has turned «Me gusta superponer prendas» on; never applied by default.
LAYERABLE_KEYS: frozenset[LayerKey] = frozenset(
    {
        layer_key("full_body", "bottom"),
        layer_key("full_body", "base_top"),
        layer_key("base_top", "base_top"),
    }
)


def layer_keys_in_look(item_types: Iterable[str]) -> set[LayerKey]:
    """Which same-slot collisions one look actually contains.

    Pure: takes the look's garment types (any case, unknown types ignored) and
    returns the layer keys present. Feeding the keys of everything a user has
    already worn back into `deduplicate_by_body_slot` is what stops the rules
    from second-guessing a combination that person wears for real.
    """
    counts: dict[str, int] = {}
    for item_type in item_types:
        role = ITEM_ROLE.get((item_type or "").strip().lower())
        if not role or role == "accessory":
            continue
        counts[role] = counts.get(role, 0) + 1

    keys: set[LayerKey] = set()
    for role, count in counts.items():
        if count > 1:
            keys.add(layer_key(role, role))
    if "full_body" in counts:
        for role in ("base_top", "bottom"):
            if role in counts:
                keys.add(layer_key("full_body", role))
    return keys


def deduplicate_by_body_slot(
    item_ids: list[UUID],
    item_type_map: dict[UUID, str],
    keep_pairs: Collection[LayerKey] | None = None,
) -> list[UUID]:
    """Drop garments that fight over a body slot, keeping the first of each.

    ``keep_pairs`` spares named collisions (see `layer_key`): pass the layer
    keys this user has already worn together, or `LAYERABLE_KEYS` when they
    have asked for layered looks. Omitted — the default — nothing is spared and
    the behaviour is exactly what it has always been.
    """
    kept_keys: frozenset[LayerKey] = frozenset(keep_pairs or ())
    seen_roles: dict[str, UUID] = {}
    result: list[UUID] = []
    has_full_body = any(
        ITEM_ROLE.get(item_type_map.get(iid, "")) == "full_body" for iid in item_ids
    )
    for iid in item_ids:
        item_type = item_type_map.get(iid, "")
        role = ITEM_ROLE.get(item_type)
        if not role:
            result.append(iid)
            continue
        if role == "accessory":
            result.append(iid)
            continue
        if has_full_body and role in ("base_top", "bottom") and role not in seen_roles:
            if layer_key("full_body", role) not in kept_keys:
                logger.warning(f"Removing {item_type} item {iid}: full_body item present")
                continue
            logger.info(f"Keeping {item_type} item {iid} layered over/under a full_body piece")
            seen_roles[role] = iid
            result.append(iid)
            continue
        if role in seen_roles:
            if layer_key(role, role) not in kept_keys:
                logger.warning(
                    f"Removing duplicate {role} item {iid} ({item_type}): "
                    f"role already filled by {seen_roles[role]}"
                )
                continue
            logger.info(f"Keeping a second {role} item {iid} ({item_type}) as a layer")
            result.append(iid)
            continue
        seen_roles[role] = iid
        result.append(iid)
    return result


_CANONICAL_ROLE_ORDER = [
    "full_body",
    "base_top",
    "mid_layer",
    "outer_layer",
    "bottom",
    "footwear",
    "socks",
    "neckwear",
    "accessory",
]

_ROLE_SORT_INDEX: dict[str, int] = {role: idx for idx, role in enumerate(_CANONICAL_ROLE_ORDER)}


def canonical_item_order(item_ids: list[UUID], item_type_map: dict[UUID, str]) -> list[UUID]:
    original_positions = {iid: idx for idx, iid in enumerate(item_ids)}

    def sort_key(item_id: UUID) -> tuple[int, int]:
        item_type = item_type_map.get(item_id, "")
        role = ITEM_ROLE.get(item_type)
        role_idx = (
            _ROLE_SORT_INDEX.get(role, len(_CANONICAL_ROLE_ORDER))
            if role
            else len(_CANONICAL_ROLE_ORDER)
        )
        return (role_idx, original_positions[item_id])

    return sorted(item_ids, key=sort_key)
