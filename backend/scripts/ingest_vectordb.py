"""Load incidents.csv and cables_shortened.csv into Postgres/pgvector.

Reads the two source CSVs, builds a short text document per row, embeds each
document with the Gemini embeddings API, and writes rows + vectors into the
`cables` and `incidents` tables (see backend/db/schema.sql).

Requires a `GOOGLE_API_KEY` environment variable (same key used for
AI-found sources).

Usage:
    python -m scripts.ingest_vectordb
    python -m scripts.ingest_vectordb --database-url postgresql://... --model gemini-embedding-001
"""

from __future__ import annotations

import argparse
import csv
import os
import random
import time
from pathlib import Path

import psycopg
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pgvector.psycopg import register_vector

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DEFAULT_DATABASE_URL = "postgresql://cableincidents:cableincidents@localhost:5432/cableincidents"
DEFAULT_MODEL = "gemini-embedding-001"
EMBEDDING_DIMENSIONS = 768
EMBED_BATCH_SIZE = 20
# Free-tier embed_content quota is ~100 requests/minute; pace batches to stay
# comfortably under that instead of bursting and hitting 429s.
EMBED_BATCH_DELAY_SECONDS = 8.0
EMBED_MAX_RETRIES = 6
SCHEMA_PATH = Path(__file__).resolve().parent.parent / "db" / "schema.sql"


def _load_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _clean(value: str | None) -> str | None:
    text = (value or "").strip()
    return text or None


def _parse_float(value: str | None) -> float | None:
    text = _clean(value)
    if text is None:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _cable_document(row: dict[str, str]) -> str:
    fields = [
        ("Cable", row.get("Cable Name")),
        ("Owners", row.get("Owners")),
        ("Region", row.get("region")),
        ("Status", row.get("status")),
    ]
    return "\n".join(f"{label}: {value}" for label, value in fields if _clean(value))


def _incident_links(row: dict[str, str]) -> list[str]:
    links = []
    for key in ("Link #1", "Link #2", "Link #3"):
        value = _clean(row.get(key))
        if value:
            links.append(value)
    return links


def _incident_document(row: dict[str, str]) -> str:
    fields = [
        ("Cable", row.get("Canonical_Cable_Name")),
        ("Original cable name", row.get("Original Cable Name")),
        ("Date", row.get("Date")),
        ("Type", row.get("Type")),
        ("Location", row.get("Specific Location")),
        ("Cause", row.get("Cause")),
        ("Suspected actor", row.get("Suspected Actor (Vessel/Individual)")),
        ("Nation state suspected", row.get("Nation State Suspected")),
        ("Outage impact", row.get("Outage Impact")),
        ("Dollar cost (USD)", row.get("Dollar Cost (USD)")),
        ("Duration of outage", row.get("Duration of Outage")),
        ("Status", row.get("Status")),
    ]
    return "\n".join(f"{label}: {value}" for label, value in fields if _clean(value))


def build_cable_rows(data_dir: Path) -> list[dict]:
    rows = []
    seen: set[str] = set()
    for raw in _load_csv_rows(data_dir / "cables_shortened.csv"):
        name = _clean(raw.get("Cable Name"))
        if not name or name in seen:
            continue
        seen.add(name)
        rows.append(
            {
                "name": name,
                "owners": _clean(raw.get("Owners")),
                "region": _clean(raw.get("region")),
                "status": _clean(raw.get("status")),
                "shape_length": _parse_float(raw.get("SHAPE__Length")),
                "document": _cable_document(raw),
            }
        )
    return rows


def build_incident_rows(data_dir: Path) -> list[dict]:
    rows = []
    for raw in _load_csv_rows(data_dir / "incidents.csv"):
        rows.append(
            {
                "canonical_cable_name": _clean(raw.get("Canonical_Cable_Name")) or "",
                "original_cable_name": _clean(raw.get("Original Cable Name")),
                "date": _clean(raw.get("Date")),
                "type": _clean(raw.get("Type")),
                "specific_location": _clean(raw.get("Specific Location")),
                "cause": _clean(raw.get("Cause")),
                "suspected_actor": _clean(raw.get("Suspected Actor (Vessel/Individual)")),
                "nation_state_suspected": _clean(raw.get("Nation State Suspected")),
                "outage_impact": _clean(raw.get("Outage Impact")),
                "dollar_cost": _clean(raw.get("Dollar Cost (USD)")),
                "duration_of_outage": _clean(raw.get("Duration of Outage")),
                "status": _clean(raw.get("Status")),
                "source": _clean(raw.get("Source")),
                "links": _incident_links(raw),
                "document": _incident_document(raw),
            }
        )
    return rows


def _retry_delay_seconds(exc: "genai_errors.ClientError", attempt: int) -> float:
    """Best-effort extraction of the server-suggested retry delay, with a
    growing fallback if the API didn't provide one."""
    details = getattr(exc, "details", None)
    if isinstance(details, dict):
        for item in details.get("details", []):
            retry_delay = item.get("retryDelay") if isinstance(item, dict) else None
            if isinstance(retry_delay, str) and retry_delay.endswith("s"):
                try:
                    return float(retry_delay[:-1]) + 1.0
                except ValueError:
                    pass
    return min(60.0, EMBED_BATCH_DELAY_SECONDS * (2**attempt))


def _embed_batch_with_retry(client: "genai.Client", model_name: str, batch: list[str]) -> list[list[float]]:
    for attempt in range(EMBED_MAX_RETRIES):
        try:
            result = client.models.embed_content(
                model=model_name,
                contents=batch,
                config=types.EmbedContentConfig(
                    output_dimensionality=EMBEDDING_DIMENSIONS,
                    task_type="RETRIEVAL_DOCUMENT",
                ),
            )
            return [item.values for item in result.embeddings]
        except genai_errors.ClientError as exc:
            if exc.code != 429 or attempt == EMBED_MAX_RETRIES - 1:
                raise
            delay = _retry_delay_seconds(exc, attempt)
            print(f"  rate limited, waiting {delay:.0f}s before retrying this batch...")
            time.sleep(delay)
    raise RuntimeError("unreachable")  # pragma: no cover


def embed_documents(client: "genai.Client", model_name: str, texts: list[str], batch_size: int) -> list[list[float]]:
    embeddings: list[list[float]] = []
    for start in range(0, len(texts), batch_size):
        batch = texts[start : start + batch_size]
        embeddings.extend(_embed_batch_with_retry(client, model_name, batch))
        print(f"  embedded {min(start + batch_size, len(texts))}/{len(texts)}")
        if start + batch_size < len(texts):
            time.sleep(EMBED_BATCH_DELAY_SECONDS)
    return embeddings


def fake_embed_documents(texts: list[str]) -> list[list[float]]:
    """Random unit-ish vectors, for exercising the DB write path without
    calling the Gemini API (see --fake-embeddings)."""
    return [[random.uniform(-1.0, 1.0) for _ in range(EMBEDDING_DIMENSIONS)] for _ in texts]


def _apply_schema(conn: psycopg.Connection) -> None:
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        for statement in filter(None, (s.strip() for s in schema_sql.split(";"))):
            cur.execute(statement)


def _write_cables(conn: psycopg.Connection, cable_rows: list[dict], cable_embeddings: list[list[float]]) -> None:
    print("Writing cables...")
    conn.execute("TRUNCATE cables RESTART IDENTITY")
    with conn.cursor() as cur:
        for row, embedding in zip(cable_rows, cable_embeddings):
            cur.execute(
                """
                INSERT INTO cables (name, owners, region, status, shape_length, document, embedding)
                VALUES (%(name)s, %(owners)s, %(region)s, %(status)s, %(shape_length)s, %(document)s, %(embedding)s)
                """,
                {**row, "embedding": embedding},
            )


def _write_incidents(
    conn: psycopg.Connection, incident_rows: list[dict], incident_embeddings: list[list[float]]
) -> None:
    print("Writing incidents...")
    conn.execute("TRUNCATE incidents RESTART IDENTITY")
    with conn.cursor() as cur:
        for row, embedding in zip(incident_rows, incident_embeddings):
            cur.execute(
                """
                INSERT INTO incidents (
                    canonical_cable_name, original_cable_name, date, type, specific_location,
                    cause, suspected_actor, nation_state_suspected, outage_impact, dollar_cost,
                    duration_of_outage, status, source, links, document, embedding
                ) VALUES (
                    %(canonical_cable_name)s, %(original_cable_name)s, %(date)s, %(type)s, %(specific_location)s,
                    %(cause)s, %(suspected_actor)s, %(nation_state_suspected)s, %(outage_impact)s, %(dollar_cost)s,
                    %(duration_of_outage)s, %(status)s, %(source)s, %(links)s, %(document)s, %(embedding)s
                )
                """,
                {**row, "embedding": embedding},
            )


def ingest(
    data_dir: Path,
    database_url: str,
    model_name: str,
    batch_size: int,
    skip_cables: bool = False,
    skip_incidents: bool = False,
    fake_embeddings: bool = False,
) -> None:
    client = None
    if fake_embeddings:
        print("Using FAKE random embeddings (no Gemini calls) -- for testing the DB path only.")
    else:
        api_key = os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            raise SystemExit("GOOGLE_API_KEY environment variable is required to compute embeddings.")
        client = genai.Client(api_key=api_key)

    cable_rows = build_cable_rows(data_dir)
    incident_rows = build_incident_rows(data_dir)
    print(f"Loaded {len(cable_rows)} cables, {len(incident_rows)} incidents")

    print("Connecting to database...")
    with psycopg.connect(database_url, autocommit=True) as conn:
        _apply_schema(conn)
        register_vector(conn)

        if skip_cables:
            print("Skipping cables (--skip-cables).")
        else:
            print(f"Embedding cables with {model_name}...")
            if fake_embeddings:
                cable_embeddings = fake_embed_documents([row["document"] for row in cable_rows])
            else:
                cable_embeddings = embed_documents(
                    client, model_name, [row["document"] for row in cable_rows], batch_size
                )
            _write_cables(conn, cable_rows, cable_embeddings)

        if skip_incidents:
            print("Skipping incidents (--skip-incidents).")
        else:
            print(f"Embedding incidents with {model_name}...")
            if fake_embeddings:
                incident_embeddings = fake_embed_documents([row["document"] for row in incident_rows])
            else:
                incident_embeddings = embed_documents(
                    client, model_name, [row["document"] for row in incident_rows], batch_size
                )
            _write_incidents(conn, incident_rows, incident_embeddings)

    print("Done.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--database-url", default=DEFAULT_DATABASE_URL)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--batch-size", type=int, default=EMBED_BATCH_SIZE)
    parser.add_argument(
        "--skip-cables", action="store_true", help="Skip (re-)embedding cables, e.g. if already ingested."
    )
    parser.add_argument(
        "--skip-incidents", action="store_true", help="Skip (re-)embedding incidents, e.g. if already ingested."
    )
    parser.add_argument(
        "--fake-embeddings",
        action="store_true",
        help="Use random vectors instead of calling the Gemini API. For testing the DB write path "
        "(schema, connectivity, inserts) without spending embedding quota. Overwritten by a real run later.",
    )
    args = parser.parse_args()
    ingest(
        args.data_dir,
        args.database_url,
        args.model,
        args.batch_size,
        skip_cables=args.skip_cables,
        skip_incidents=args.skip_incidents,
        fake_embeddings=args.fake_embeddings,
    )


if __name__ == "__main__":
    main()
