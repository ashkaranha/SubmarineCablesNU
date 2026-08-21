from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING

from app.config import settings

if TYPE_CHECKING:
    from fastembed import TextEmbedding

EMBEDDING_DIMENSIONS = 384


@lru_cache(maxsize=1)
def get_embedding_model() -> "TextEmbedding":
    # fastembed runs a small ONNX model instead of PyTorch/sentence-transformers,
    # which uses far less memory -- important on memory-capped hosts (e.g. Render's
    # free tier, 512MB) where importing torch alone can blow the budget.
    from fastembed import TextEmbedding

    return TextEmbedding(model_name=settings.embedding_model_name)


def embed_text(text: str) -> list[float]:
    model = get_embedding_model()
    (embedding,) = model.embed([text])
    return embedding.tolist()
