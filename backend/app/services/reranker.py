"""Cross-encoder reranking for semantic search results.

A cheap bi-encoder or BM25 candidate pool scores query and document
independently (or by term overlap), which leaves very little separation
between genuinely relevant results and unrelated ones on short, formulaic
documents like "Cable: X | Cause: Y" -- e.g. searching "hurricane" used to
return incidents about anchor drag or suspected state-sponsored sabotage
with nearly the same score as actual storm-related incidents.

A cross-encoder scores the query and document *together* in a single pass,
so it can actually judge whether the document addresses the query topic.
It's slower per-pair, so it's only used to rerank a modest candidate pool
(see `search_lexical.py`), not the whole corpus.
"""

from __future__ import annotations

import ctypes
import logging
import sys
from functools import lru_cache
from typing import TYPE_CHECKING, Callable

from app.config import settings

if TYPE_CHECKING:
    from fastembed.rerank.cross_encoder import TextCrossEncoder

logger = logging.getLogger(__name__)

_libc: ctypes.CDLL | None = None
if sys.platform.startswith("linux"):
    try:
        _libc = ctypes.CDLL("libc.so.6")
    except OSError:
        _libc = None


def _release_memory_to_os() -> None:
    """Ask glibc to hand freed heap memory back to the OS.

    Disabling ONNX Runtime's own memory arena (below) stops *it* from
    permanently reserving a large scratch buffer, but on Linux, glibc's
    malloc has its own habit of keeping freed memory in the process instead
    of returning it via sbrk/munmap -- especially after the kind of bursty,
    varied-size allocations a transformer forward pass does. That can make a
    process's RSS climb request-over-request even though nothing is actually
    leaking at the Python level, which is consistent with search working
    once and then the process getting OOM-killed on the next call. This is a
    no-op everywhere except Linux glibc.
    """
    if _libc is None:
        return
    try:
        _libc.malloc_trim(0)
    except Exception:  # pragma: no cover - best-effort cleanup
        pass

# How far below the top reranked score a candidate can be and still be kept.
# A relative cutoff (rather than a fixed absolute one) is needed because the
# cross-encoder's logit scale shifts with how well-represented the query
# topic is in the corpus -- e.g. a well-covered topic like "sabotage" has its
# best match near 0, while a vaguer query like "weather today" tops out
# around -10. Validated against the real corpus across several test queries.
RELATIVE_MARGIN = 6.0


@lru_cache(maxsize=1)
def get_reranker_model() -> "TextCrossEncoder":
    from fastembed.rerank.cross_encoder import TextCrossEncoder

    # ONNX Runtime's default memory arena grows to fit the largest batch it's
    # ever seen and never shrinks -- on real (not tiny synthetic) documents,
    # that meant a single search request could permanently balloon this
    # process from ~210MB to 500MB+, which is what was pushing Render's
    # 512MB free tier over budget. Disabling the arena (and limiting to one
    # thread, which has no measurable latency impact at this batch size)
    # keeps memory flat regardless of how many candidates get reranked.
    return TextCrossEncoder(
        model_name=settings.reranker_model_name,
        enable_cpu_mem_arena=False,
        threads=1,
    )


def cable_document(row: dict) -> str:
    fields = [
        ("Cable", row.get("name")),
        ("Owners", row.get("owners")),
        ("Region", row.get("region")),
        ("Status", row.get("status")),
    ]
    return "\n".join(f"{label}: {value}" for label, value in fields if value)


def incident_document(row: dict) -> str:
    fields = [
        ("Cable", row.get("canonical_cable_name")),
        ("Original cable name", row.get("original_cable_name")),
        ("Date", row.get("date")),
        ("Type", row.get("type")),
        ("Location", row.get("specific_location")),
        ("Cause", row.get("cause")),
        ("Suspected actor", row.get("suspected_actor")),
        ("Nation state suspected", row.get("nation_state_suspected")),
        ("Outage impact", row.get("outage_impact")),
        ("Dollar cost (USD)", row.get("dollar_cost")),
        ("Duration of outage", row.get("duration_of_outage")),
        ("Status", row.get("status")),
    ]
    return "\n".join(f"{label}: {value}" for label, value in fields if value)


# Fallback display score (0-1, shown to the frontend as an "X% match" badge)
# used when the cross-encoder itself is unavailable and only the original
# candidate order survives.
_FALLBACK_DISPLAY_SCORE = 0.5


def _display_score(score: float, best_score: float, relative_margin: float) -> float:
    """Map a raw cross-encoder logit onto a 0.5-0.99 range for display.

    Cross-encoder logits aren't a calibrated 0-1 probability (a "good" match
    might score -2, a "bad" one -11), so a fixed sigmoid would show
    confusingly low percentages. Since every row passed in here already
    scored within `relative_margin` of the best result for this query, a
    linear scale within that window gives a sensible, monotonic "how good
    relative to the best match" percentage instead.
    """
    if relative_margin <= 0:
        return 0.99
    ratio = max(0.0, min(1.0, 1 - (best_score - score) / relative_margin))
    return 0.5 + ratio * 0.49


def rerank(
    query: str,
    rows: list[dict],
    text_fn: Callable[[dict], str],
    relative_margin: float = RELATIVE_MARGIN,
) -> list[tuple[dict, float]]:
    """Reorder and filter `rows` by cross-encoder relevance to `query`.

    Returns (row, display_score) pairs, sorted by relevance, keeping only
    rows within `relative_margin` of the best score. Falls back to the
    original candidate order (with a neutral display score) if the
    reranker model can't be loaded or scoring fails, so a reranking
    problem degrades search quality rather than breaking it outright.
    """
    if not rows:
        return []

    try:
        model = get_reranker_model()
        documents = [text_fn(row) for row in rows]
        scores = list(model.rerank(query, documents))
    except Exception:
        logger.warning("Cross-encoder reranking unavailable, falling back to candidate order", exc_info=True)
        return [(row, _FALLBACK_DISPLAY_SCORE) for row in rows]
    finally:
        _release_memory_to_os()

    ranked = sorted(zip(scores, rows), key=lambda pair: pair[0], reverse=True)
    best_score = ranked[0][0]
    return [
        (row, _display_score(score, best_score, relative_margin))
        for score, row in ranked
        if score >= best_score - relative_margin
    ]


def rerank_incidents(query: str, rows: list[dict]) -> list[tuple[dict, float]]:
    return rerank(query, rows, incident_document)


def rerank_cables(query: str, rows: list[dict]) -> list[tuple[dict, float]]:
    return rerank(query, rows, cable_document)
