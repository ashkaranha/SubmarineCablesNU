import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.routes import create_router
from app.config import settings
from app.services.data_loader import DataStore, load_data_store

store: DataStore | None = None


async def _ensure_vector_db_background() -> None:
    """Populate the vector DB in the background so semantic search is ready
    without a separate manual step, without blocking API startup on it."""
    from scripts import ensure_vectordb

    try:
        await asyncio.to_thread(ensure_vectordb.main)
    except Exception as exc:  # pragma: no cover - best-effort background setup
        print(f"Automatic semantic search setup failed: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global store
    store = load_data_store()
    app.include_router(create_router(store))
    asyncio.create_task(_ensure_vector_db_background())
    yield


app = FastAPI(title="CableIncidentsDB API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "CableIncidentsDB API", "docs": "/docs"}
