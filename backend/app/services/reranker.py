"""Cross-encoder reranking for semantic search results.

The bi-encoder used for the initial vector search (see `embeddings.py` /
`vector_db.py`) scores query and document independently, then compares
vectors with cosine similarity. On short, formulaic documents like
"Cable: X | Cause: Y", that leaves very little score separation between
genuinely relevant results and unrelated ones -- e.g. searching "hurricane"
returned incidents about anchor drag or suspected state-sponsored sabotage
with nearly the same score as actual storm-related incidents.

A cross-encoder scores the query and document *together* in a single pass,
so it can actually judge whether the document addresses the query topic.
It's slower per-pair than the bi-encoder, so it's only used to rerank a
modest pool of candidates already retrieved by the vector search, not the
whole corpus.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import TYPE_CHECKING, Callable

from app.config import settings

if TYPE_CHECKING:
    from fastembed.rerank.cross_encoder import TextCrossEncoder

logger = logging.getLogger(__name__)

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

    return TextCrossEncoder(model_name=settings.reranker_model_name)


def _cable_document(row: dict) -> str:
    fields = [
        ("Cable", row.get("name")),
        ("Owners", row.get("owners")),
        ("Region", row.get("region")),
        ("Status", row.get("status")),
    ]
    return "\n".join(f"{label}: {value}" for label, value in fields if value)


def _incident_document(row: dict) -> str:
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


def rerank(
    query: str,
    rows: list[dict],
    text_fn: Callable[[dict], str],
    relative_margin: float = RELATIVE_MARGIN,
) -> list[dict]:
    """Reorder and filter `rows` by cross-encoder relevance to `query`.

    Falls back to returning `rows` unchanged (original bi-encoder order) if
    the reranker model can't be loaded or scoring fails, so a reranking
    problem degrades search quality rather than breaking it outright.
    """
    if not rows:
        return rows

    try:
        model = get_reranker_model()
        documents = [text_fn(row) for row in rows]
        scores = list(model.rerank(query, documents))
    except Exception:
        logger.warning("Cross-encoder reranking unavailable, falling back to vector search order", exc_info=True)
        return rows

    ranked = sorted(zip(scores, rows), key=lambda pair: pair[0], reverse=True)
    best_score = ranked[0][0]
    return [row for score, row in ranked if score >= best_score - relative_margin]


def rerank_incidents(query: str, rows: list[dict]) -> list[dict]:
    return rerank(query, rows, _incident_document)


def rerank_cables(query: str, rows: list[dict]) -> list[dict]:
    return rerank(query, rows, _cable_document)
