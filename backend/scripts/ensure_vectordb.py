"""Idempotently populate the vector DB on API startup.

Run automatically (in the background, non-blocking) from app.main's lifespan
so semantic search works with just `docker compose up` -- no separate manual
`ingest_vectordb` step required, and no API key needed since embeddings are
computed locally. Skips quietly, leaving semantic search unavailable, if the
database isn't reachable yet; the rest of the app is unaffected either way.

Can also be run directly:
    python -m scripts.ensure_vectordb
"""

from __future__ import annotations

import os
from pathlib import Path

from app.services.embeddings import EMBEDDING_DIMENSIONS
from scripts.ingest_vectordb import (
    DEFAULT_DATA_DIR,
    DEFAULT_DATABASE_URL,
    DEFAULT_MODEL,
    EMBED_BATCH_SIZE,
    build_cable_rows,
    build_incident_rows,
    ingest,
)


def _table_state(cur, table: str) -> tuple[int, int | None]:
    """Returns (row_count, embedding_dimension_of_first_row_or_None)."""
    cur.execute(f"select to_regclass('public.{table}')")
    if cur.fetchone()[0] is None:
        return 0, None
    cur.execute(f"select count(*), max(vector_dims(embedding)) from {table}")
    count, dims = cur.fetchone()
    return count, dims


def main() -> None:
    import psycopg

    database_url = os.environ.get("CABLEINCIDENTS_DATABASE_URL", DEFAULT_DATABASE_URL)
    data_dir = Path(os.environ.get("CABLEINCIDENTS_DATA_DIR", str(DEFAULT_DATA_DIR)))
    model_name = os.environ.get("CABLEINCIDENTS_EMBEDDING_MODEL_NAME", DEFAULT_MODEL)

    expected_cables = len(build_cable_rows(data_dir))
    expected_incidents = len(build_incident_rows(data_dir))

    try:
        with psycopg.connect(database_url, connect_timeout=5, prepare_threshold=None) as conn:
            with conn.cursor() as cur:
                current_incidents, incident_dims = _table_state(cur, "incidents")
                current_cables, cable_dims = _table_state(cur, "cables")

                # A table left over from a previous embedding model (different dimension)
                # can't be reused -- drop it so ingest() rebuilds it at the current size,
                # rather than failing later with a pgvector dimension mismatch.
                stale_incidents = incident_dims is not None and incident_dims != EMBEDDING_DIMENSIONS
                stale_cables = cable_dims is not None and cable_dims != EMBEDDING_DIMENSIONS
                if stale_incidents:
                    print(f"Existing incidents embeddings are {incident_dims}-dim, expected {EMBEDDING_DIMENSIONS} - dropping to re-ingest.")
                    cur.execute("DROP TABLE incidents CASCADE")
                    current_incidents = 0
                if stale_cables:
                    print(f"Existing cables embeddings are {cable_dims}-dim, expected {EMBEDDING_DIMENSIONS} - dropping to re-ingest.")
                    cur.execute("DROP TABLE cables CASCADE")
                    current_cables = 0
            conn.commit()
    except Exception as exc:
        print(f"Vector DB not reachable ({exc}) - skipping automatic semantic search setup.")
        return

    skip_incidents = expected_incidents > 0 and current_incidents == expected_incidents
    skip_cables = expected_cables > 0 and current_cables == expected_cables
    if skip_incidents and skip_cables:
        print(
            f"Vector DB already populated ({current_incidents} incidents, "
            f"{current_cables} cables) - semantic search is ready."
        )
        return

    print("Populating vector DB for semantic search (one-time; re-run manually to refresh data)...")
    try:
        ingest(
            data_dir,
            database_url,
            model_name,
            EMBED_BATCH_SIZE,
            skip_cables=skip_cables,
            skip_incidents=skip_incidents,
        )
        print("Semantic search is ready.")
    except Exception as exc:
        print(f"Automatic semantic search setup failed ({exc}); semantic search will be unavailable.")


if __name__ == "__main__":
    main()
