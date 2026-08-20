"""Deterministic keyword/pattern routing for analytical search queries.

Recognizes a fixed set of aggregate question shapes (e.g. "most incident-prone
cable", "which region has the fewest incidents") and answers them with real
group-by/count aggregates instead of falling through to per-document vector
similarity, which cannot answer this kind of question. Returns None for any
query that doesn't match a known pattern, so the caller falls back to the
existing embedding-based search untouched.
"""

from __future__ import annotations

import re

from app.models.schemas import AggregateResult
from app.services import search_aggregates as aggregates
from app.services.data_loader import DataStore

_MOST = re.compile(r"\b(most|top|highest|greatest|worst|riskiest)\b")
_LEAST = re.compile(r"\b(least|fewest|lowest|safest|best)\b")

_CABLE = re.compile(r"\bcables?\b")
_REGION = re.compile(r"\bregions?\b")
_CAUSE = re.compile(r"\bcauses?\b|\bwhy\b")
_NATION = re.compile(r"\bnations?\b|\bstates?\b|\bcountr(y|ies)\b")
_ACTOR = re.compile(r"\bactors?\b|\bvessels?\b|\bindividuals?\b")
_YEAR = re.compile(r"\byears?\b|\bwhen\b|\bover time\b|\btimeline\b")
_RESOLVED = re.compile(r"\bresolved\b|\bunresolved\b|\bongoing\b|\breported\b|\binvestigation status\b")


def classify_query(store: DataStore, query: str, limit: int = 10) -> AggregateResult | None:
    text = query.lower()
    if not (_MOST.search(text) or _LEAST.search(text) or _YEAR.search(text) or _RESOLVED.search(text)):
        return None

    ascending = bool(_LEAST.search(text))

    if _CABLE.search(text):
        items = aggregates.top_cables(store, limit=limit, ascending=ascending)
        if items:
            title = "Least incident-prone cables" if ascending else "Most incident-prone cables"
            return AggregateResult(title=title, items=items)

    if _NATION.search(text):
        items = aggregates.top_by_field(store, "nation_state_suspected", limit=limit, ascending=ascending)
        if items:
            title = "Least suspected nation states" if ascending else "Most suspected nation states"
            return AggregateResult(title=title, items=items)

    if _ACTOR.search(text):
        items = aggregates.top_by_field(store, "suspected_actor", limit=limit, ascending=ascending)
        if items:
            title = "Least common suspected actors" if ascending else "Most common suspected actors"
            return AggregateResult(title=title, items=items)

    if _REGION.search(text):
        items = aggregates.top_by_field(store, "region", limit=limit, ascending=ascending)
        if items:
            title = "Regions with the fewest incidents" if ascending else "Regions with the most incidents"
            return AggregateResult(title=title, items=items)

    if _CAUSE.search(text):
        items = aggregates.top_by_field(store, "cause", limit=limit, ascending=ascending)
        if items:
            title = "Least common causes" if ascending else "Most common causes"
            return AggregateResult(title=title, items=items)

    if _YEAR.search(text):
        items = aggregates.incidents_by_year(store)
        if items:
            return AggregateResult(title="Incidents by year", items=items)

    if _RESOLVED.search(text):
        items = aggregates.resolved_breakdown(store)
        if items:
            return AggregateResult(title="Incidents by investigation status", items=items)

    return None
