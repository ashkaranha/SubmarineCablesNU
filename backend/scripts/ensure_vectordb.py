"""Idempotently populate the vector DB on API startup.

Run automatically (in the background, non-blocking) from app.main's lifespan
so semantic search works with just `docker compose up` -- no separate manual
`ingest_vectordb` step required. Skips quietly, leaving semantic search
unavailable, if GOOGLE_API_KEY isn't set or the database isn't reachable yet;
the rest of the app is unaffected either way.

Can also be run directly:
    python -m scripts.ensure_vectordb
"""

from __future__ import annotations

import os
from pathlib import Path

from scripts.ingest_vectordb import (
    DEFAULT_DATA_DIR,
    DEFAULT_DATABASE_URL,
    DEFAULT_MODEL,
    EMBED_BATCH_SIZE,
    build_cable_rows,
    build_incident_rows,
    ingest,
)


def main() -> None:
    if not os.environ.get("GOOGLE_API_KEY"):
        print("GOOGLE_API_KEY not set - skipping automatic semantic search setup.")
        return

    import psycopg

    database_url = os.environ.get("CABLEINCIDENTS_DATABASE_URL", DEFAULT_DATABASE_URL)
    data_dir = Path(os.environ.get("CABLEINCIDENTS_DATA_DIR", str(DEFAULT_DATA_DIR)))
    model_name = os.environ.get("CABLEINCIDENTS_EMBEDDING_MODEL_NAME", DEFAULT_MODEL)

    expected_cables = len(build_cable_rows(data_dir))
    expected_incidents = len(build_incident_rows(data_dir))

    try:
        with psycopg.connect(database_url, connect_timeout=5) as conn:
            with conn.cursor() as cur:
                cur.execute("select to_regclass('public.incidents'), to_regclass('public.cables')")
                incidents_exists, cables_exists = cur.fetchone()
                current_incidents = 0
                current_cables = 0
                if incidents_exists:
                    cur.execute("select count(*) from incidents")
                    current_incidents = cur.fetchone()[0]
                if cables_exists:
                    cur.execute("select count(*) from cables")
                    current_cables = cur.fetchone()[0]
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
    except SystemExit as exc:
        print(f"Automatic semantic search setup skipped: {exc}")
    except Exception as exc:
        print(f"Automatic semantic search setup failed ({exc}); semantic search will be unavailable.")


if __name__ == "__main__":
    main()
