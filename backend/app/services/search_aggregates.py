"""Deterministic group-by/count aggregates over the in-memory DataStore.

Used by search_intent.py to answer analytical queries (e.g. "most
incident-prone cable") that per-document vector similarity cannot answer,
without any embedding/LLM call.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime

from app.models.schemas import AggregateItem
from app.services.data_loader import DataStore

_DATE_FORMATS = ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y")


def _year_from_date(value: str | None) -> str | None:
    text = (value or "").strip()
    for fmt in _DATE_FORMATS:
        try:
            return str(datetime.strptime(text, fmt).year)
        except ValueError:
            continue
    return None


def top_cables(store: DataStore, limit: int = 10, ascending: bool = False) -> list[AggregateItem]:
    cables = [c for c in store.list_cables() if c.incident_count > 0]
    cables.sort(key=lambda cable: (cable.incident_count, cable.name.lower()), reverse=not ascending)
    return [AggregateItem(label=cable.name, count=cable.incident_count) for cable in cables[:limit]]


def top_by_field(
    store: DataStore, field: str, limit: int = 10, ascending: bool = False
) -> list[AggregateItem]:
    counts: Counter[str] = Counter()
    for incident in store.incidents:
        value = (getattr(incident, field, None) or "").strip()
        if value:
            counts[value] += 1
    items = sorted(counts.items(), key=lambda pair: (pair[1], pair[0].lower()), reverse=not ascending)
    return [AggregateItem(label=label, count=count) for label, count in items[:limit]]


def incidents_by_year(store: DataStore) -> list[AggregateItem]:
    counts: Counter[str] = Counter()
    for incident in store.incidents:
        year = _year_from_date(incident.date)
        if year:
            counts[year] += 1
    return [AggregateItem(label=year, count=count) for year, count in sorted(counts.items())]


def resolved_breakdown(store: DataStore) -> list[AggregateItem]:
    meta = store.filter_meta()
    return [AggregateItem(label=status.value, count=status.count) for status in meta.statuses]
