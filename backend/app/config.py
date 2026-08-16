from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CABLEINCIDENTS_")

    data_dir: Path = Path(__file__).resolve().parents[2] / "data"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ]

    database_url: str = "postgresql://cableincidents:cableincidents@localhost:5432/cableincidents"
    embedding_model_name: str = "gemini-embedding-001"

    google_api_key: str | None = Field(default=None, validation_alias="GOOGLE_API_KEY")
    google_model_name: str = "gemini-3.6-flash"


settings = Settings()
