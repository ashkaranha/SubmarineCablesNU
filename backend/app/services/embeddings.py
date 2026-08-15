from __future__ import annotations

from functools import lru_cache

from app.config import settings

EMBEDDING_DIMENSIONS = 768


@lru_cache(maxsize=1)
def _get_client():
    from google import genai

    return genai.Client(api_key=settings.google_api_key) if settings.google_api_key else genai.Client()


def embed_text(text: str, task_type: str = "RETRIEVAL_QUERY") -> list[float]:
    from google.genai import types

    client = _get_client()
    result = client.models.embed_content(
        model=settings.embedding_model_name,
        contents=text,
        config=types.EmbedContentConfig(
            output_dimensionality=EMBEDDING_DIMENSIONS,
            task_type=task_type,
        ),
    )
    return result.embeddings[0].values
