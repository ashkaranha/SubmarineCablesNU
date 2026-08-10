from __future__ import annotations

import json
import re

from app.config import settings
from app.models.schemas import IncidentSummary, LLMSource


def _build_prompt(incident: IncidentSummary) -> str:
    known = "\n".join(f"- {link}" for link in incident.links) or "(none)"
    fields = [
        ("Cable", incident.canonical_cable_name),
        ("Date", incident.date),
        ("Type", incident.type),
        ("Location", incident.specific_location),
        ("Cause", incident.cause),
        ("Suspected actor", incident.suspected_actor),
        ("Nation state suspected", incident.nation_state_suspected),
        ("Outage impact", incident.outage_impact),
        ("Status", incident.status),
    ]
    details = "\n".join(f"{label}: {value}" for label, value in fields if value)
    return (
        "Search the web for reputable, real sources (news articles, official "
        "statements, technical or industry reports) about this specific submarine "
        "cable incident:\n\n"
        f"{details}\n\n"
        "Sources already known for this incident (do not repeat these URLs, and "
        "do not invent close variants of them):\n"
        f"{known}\n\n"
        "Respond with ONLY a JSON array (no prose, no markdown code fences) of up "
        "to 5 objects with keys \"url\", \"title\", and \"snippet\" (one sentence "
        "on why it's relevant), for genuinely distinct sources you found via web "
        "search. Only include URLs you actually found through search. If you find "
        "no new distinct sources, respond with []."
    )


def _extract_json_array(text: str) -> list[dict]:
    text = text.strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed
    except json.JSONDecodeError:
        pass
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass
    return []


def find_additional_sources(incident: IncidentSummary) -> list[LLMSource]:
    from google import genai
    from google.genai import types

    client = (
        genai.Client(api_key=settings.google_api_key) if settings.google_api_key else genai.Client()
    )

    response = client.models.generate_content(
        model=settings.google_model_name,
        contents=_build_prompt(incident),
        config=types.GenerateContentConfig(
            tools=[types.Tool(google_search=types.GoogleSearch())],
        ),
    )

    items = _extract_json_array(response.text or "")

    sources: list[LLMSource] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        url = item.get("url")
        if not url:
            continue
        sources.append(LLMSource(url=url, title=item.get("title"), snippet=item.get("snippet")))
    return sources
