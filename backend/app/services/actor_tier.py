from typing import Literal

ActorTier = Literal["confirmed", "suspected", "none"]
MarkerFill = Literal["red", "amber", "slate"]
StatusStroke = Literal["resolved", "unresolved"]
BadgeColor = Literal["red", "yellow", "green"]

NONE_PATTERNS = (
    "unknown",
    "none",
    "none confirmed",
    "none (accidental",
    "none (operator",
    "criminal, not state",
)

STATE_HINTS = (
    "china",
    "russia",
    "iran",
    "yemen",
    "uk ",
    "usa",
    "ukraine",
    "egypt",
    "georgia",
    "kazakh",
    "azerbaijan",
    "australia",
    "houthis",
    "gchq",
    "nsa",
)


def _normalize(value: str | None) -> str:
    return (value or "").strip()


def classify_actor_tier(nation_state_suspected: str | None) -> ActorTier:
    text = _normalize(nation_state_suspected)
    if not text:
        return "none"

    lowered = text.lower()

    if any(lowered.startswith(pattern) or lowered == pattern for pattern in NONE_PATTERNS):
        return "none"

    if "admitted" in lowered and "suspected" not in lowered:
        return "confirmed"

    if "suspected" in lowered or "possible" in lowered:
        return "suspected"

    if lowered.startswith("unknown"):
        if any(hint in lowered for hint in STATE_HINTS):
            return "suspected"
        return "none"

    if any(hint in lowered for hint in STATE_HINTS):
        return "confirmed"

    # outage-impact strings that leaked into the column
    if "cable disrupted" in lowered or "cables disrupted" in lowered:
        return "none"

    return "suspected"


def is_resolved_status(status: str | None) -> bool:
    return _normalize(status).lower().startswith("resolved")


def marker_fill_for(actor_tier: ActorTier) -> MarkerFill:
    if actor_tier == "confirmed":
        return "red"
    if actor_tier == "suspected":
        return "amber"
    return "slate"


def status_stroke_for(status: str | None) -> StatusStroke:
    return "resolved" if is_resolved_status(status) else "unresolved"


def badge_color_for(actor_tier: ActorTier, status: str | None) -> BadgeColor:
    if is_resolved_status(status):
        return "green"
    if actor_tier == "confirmed":
        return "red"
    return "yellow"
