"""Lightweight in-memory lexical (BM25) search over the DataStore.

Used as the candidate-retrieval stage for semantic search, replacing the
previous dense bi-encoder + pgvector pipeline. Running the bi-encoder
alongside the cross-encoder reranker (see reranker.py) cost ~280MB of
resident memory for the two ONNX models alone, which was enough to push
Render's 512MB free-tier instance over budget on every search. The
cross-encoder already does the real relevance judgment, so this stage only
needs a cheap way to narrow the corpus (~1600 documents total) down to a
candidate pool -- classic BM25 term-overlap scoring is more than adequate
for that and needs no model, no download, and no extra memory.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field

from app.models.schemas import IncidentSummary

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_STOPWORDS = {
    "the", "a", "an", "of", "in", "on", "at", "to", "for", "and", "or",
    "is", "was", "were", "by", "from", "near", "with", "it", "this",
    "that", "as", "be", "are", "which", "cable", "cables",
}

_K1 = 1.5
_B = 0.75

# BM25 only matches literal tokens, so without help it can't tell that
# "hurricane" and "typhoon" describe the same kind of event -- unlike the
# bi-encoder embeddings this replaced, which understood that semantically.
# This is a small, targeted synonym expansion for the handful of concepts
# that actually show up worded differently across incidents.csv (storms,
# sabotage, seabed movement, vessel anchors), not an attempt at general
# synonymy. Expansion is symmetric: each group maps every term in it to
# every other term in it.
_SYNONYM_GROUPS = [
    {"hurricane", "typhoon", "cyclone", "storm", "tropical"},
    {"sabotage", "deliberate", "attack", "severed", "destroyed"},
    {"earthquake", "seismic", "landslide", "tremor"},
    {"anchor", "dragging", "drag", "dragged"},
    {"russia", "russian"},
    {"china", "chinese"},
]
_SYNONYMS: dict[str, set[str]] = {}
for _group in _SYNONYM_GROUPS:
    for _term in _group:
        _SYNONYMS.setdefault(_term, set()).update(_group - {_term})


def _tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN_RE.findall(text.lower()) if t not in _STOPWORDS and len(t) > 1]


def _expand_query_terms(terms: set[str]) -> set[str]:
    expanded = set(terms)
    for term in terms:
        expanded.update(_SYNONYMS.get(term, ()))
    return expanded


@dataclass
class LexicalIndex:
    doc_term_freqs: list[Counter] = field(default_factory=list)
    doc_lengths: list[int] = field(default_factory=list)
    doc_freq: Counter = field(default_factory=Counter)
    avg_len: float = 0.0
    n_docs: int = 0


def build_index(documents: list[str]) -> LexicalIndex:
    doc_term_freqs: list[Counter] = []
    doc_lengths: list[int] = []
    doc_freq: Counter = Counter()
    for doc in documents:
        tokens = _tokenize(doc)
        tf = Counter(tokens)
        doc_term_freqs.append(tf)
        doc_lengths.append(len(tokens))
        for term in tf:
            doc_freq[term] += 1
    avg_len = (sum(doc_lengths) / len(doc_lengths)) if doc_lengths else 0.0
    return LexicalIndex(
        doc_term_freqs=doc_term_freqs,
        doc_lengths=doc_lengths,
        doc_freq=doc_freq,
        avg_len=avg_len,
        n_docs=len(documents),
    )


def top_candidates(index: LexicalIndex, query: str, limit: int) -> list[int]:
    """Return document indices ranked by BM25 score against `query`."""
    terms = _expand_query_terms(set(_tokenize(query)))
    if not terms or index.n_docs == 0:
        return []

    scores = [0.0] * index.n_docs
    for term in terms:
        df = index.doc_freq.get(term, 0)
        if df == 0:
            continue
        idf = math.log((index.n_docs - df + 0.5) / (df + 0.5) + 1)
        for i, tf in enumerate(index.doc_term_freqs):
            freq = tf.get(term, 0)
            if freq == 0:
                continue
            doc_len = index.doc_lengths[i]
            denom = freq + _K1 * (1 - _B + _B * doc_len / (index.avg_len or 1))
            scores[i] += idf * (freq * (_K1 + 1)) / denom

    ranked = sorted(range(index.n_docs), key=lambda i: scores[i], reverse=True)
    return [i for i in ranked[:limit] if scores[i] > 0]


def incident_row(incident: IncidentSummary) -> dict:
    """Build an IncidentSearchResult-shaped dict (minus `score`) from a store incident."""
    return {
        "id": int(incident.id),
        "canonical_cable_name": incident.canonical_cable_name,
        "original_cable_name": incident.original_cable_name,
        "date": incident.date,
        "type": incident.type,
        "specific_location": incident.specific_location,
        "cause": incident.cause,
        "suspected_actor": incident.suspected_actor,
        "nation_state_suspected": incident.nation_state_suspected,
        "outage_impact": incident.outage_impact,
        "dollar_cost": incident.dollar_cost,
        "duration_of_outage": incident.duration_of_outage,
        "status": incident.status,
        "source": incident.source,
        "links": list(incident.links),
    }


def cable_row(cable: dict) -> dict:
    """Build a CableSearchResult-shaped dict (minus `score`) from a store cable entry."""
    shape_length = cable.get("shape_length")
    try:
        shape_length_value = float(shape_length) if shape_length else None
    except (TypeError, ValueError):
        shape_length_value = None
    return {
        "name": cable.get("name"),
        "owners": cable.get("owners"),
        "region": cable.get("region"),
        "status": cable.get("status"),
        "shape_length": shape_length_value,
    }
