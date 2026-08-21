from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.routes import create_router
from app.config import settings
from app.services.data_loader import DataStore, load_data_store

store: DataStore | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Semantic search now runs entirely in-process (BM25 candidate retrieval +
    # cross-encoder reranking over the in-memory data store -- see
    # app/services/search_lexical.py and app/services/reranker.py), so there's
    # no vector DB to populate on startup anymore. That background bulk-embed
    # job used to embed the whole corpus (~1600 rows) on every deploy, which
    # was the original cause of Render OOM crashes before it was ever moved
    # off the request path.
    global store
    store = load_data_store()
    app.include_router(create_router(store))
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
