import json
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"
)


def _parse_cors_origins(value: str) -> list[str]:
    """Accept a JSON array, a comma-separated string, or a mangled version of either.

    Shells (PowerShell in particular) often strip embedded quotes when passing
    `--set-env-vars CABLEINCIDENTS_CORS_ORIGINS=["https://..."]`, turning it
    into invalid JSON like `[https://...]`. Rather than crashing the app or
    silently dropping the origin (which breaks CORS with a confusing "Failed
    to fetch" on the frontend), tolerate missing quotes/brackets and fall back
    to splitting on commas.
    """
    stripped = value.strip()
    if not stripped:
        return []

    try:
        parsed = json.loads(stripped)
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
    except json.JSONDecodeError:
        pass

    cleaned = stripped.strip("[]")
    return [origin.strip().strip('"').strip("'") for origin in cleaned.split(",") if origin.strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CABLEINCIDENTS_")

    data_dir: Path = Path(__file__).resolve().parents[2] / "data"

    # Kept as a raw string (not list[str]) so pydantic-settings doesn't try to
    # auto-JSON-decode the env var before we get a chance to sanitize it.
    cors_origins_raw: str = Field(
        default=_DEFAULT_CORS_ORIGINS,
        validation_alias="CABLEINCIDENTS_CORS_ORIGINS",
    )

    @property
    def cors_origins(self) -> list[str]:
        return _parse_cors_origins(self.cors_origins_raw)

    database_url: str = "postgresql://cableincidents:cableincidents@localhost:5432/cableincidents"
    embedding_model_name: str = "BAAI/bge-small-en-v1.5"
    reranker_model_name: str = "Xenova/ms-marco-MiniLM-L-6-v2"

    google_api_key: str | None = Field(default=None, validation_alias="GOOGLE_API_KEY")
    google_model_name: str = "gemini-3.6-flash"


settings = Settings()
