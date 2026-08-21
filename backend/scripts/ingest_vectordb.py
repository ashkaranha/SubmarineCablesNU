"""Load incidents.csv and cables_shortened.csv into Postgres/pgvector.

Reads the two source CSVs, builds a short text document per row, embeds each
document with a local fastembed (ONNX Runtime) model, and writes rows +
vectors into the `cables` and `incidents` tables (see backend/db/schema.sql).
Runs fully locally -- no API key or network calls needed beyond the one-time
model download, and no PyTorch dependency (much lighter on memory than
sentence-transformers, which matters on memory-capped hosts).

Usage:
    python -m scripts.ingest_vectordb
    $env:CABLEINCIDENTS_DATABASE_URL = "postgresql://..."; python -m scripts.ingest_vectordb
"""

from __future__ import annotations

import argparse
import csv
import os
from pathlib import Path

import psycopg
from pgvector.psycopg import register_vector

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DEFAULT_DATABASE_URL = "postgresql://cableincidents:cableincidents@localhost:5432/cableincidents"
DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"
EMBED_BATCH_SIZE = 64
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


def _apply_schema(conn: psycopg.Connection) -> None:
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        for statement in filter(None, (s.strip() for s in schema_sql.split(";"))):
            cur.execute(statement)


def _write_cables(conn: psycopg.Connection, cable_rows: list[dict], cable_embeddings: list) -> None:
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


def _write_incidents(conn: psycopg.Connection, incident_rows: list[dict], incident_embeddings: list) -> None:
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
) -> None:
    from fastembed import TextEmbedding

    print(f"Loading embedding model {model_name}...")
    model = TextEmbedding(model_name=model_name)

    cable_rows = build_cable_rows(data_dir)
    incident_rows = build_incident_rows(data_dir)
    print(f"Loaded {len(cable_rows)} cables, {len(incident_rows)} incidents")

    print("Connecting to database...")
    # prepare_threshold=None disables psycopg's automatic server-side prepared
    # statements -- required for Supabase's connection pooler (PgBouncer in
    # transaction mode), which doesn't support them and errors with
    # "prepared statement ... does not exist" after a handful of queries.
    with psycopg.connect(database_url, autocommit=True, prepare_threshold=None) as conn:
        _apply_schema(conn)
        register_vector(conn)

        if skip_cables:
            print("Skipping cables (--skip-cables).")
        else:
            print("Embedding cables...")
            cable_embeddings = list(
                model.embed([row["document"] for row in cable_rows], batch_size=batch_size)
            )
            _write_cables(conn, cable_rows, cable_embeddings)

        if skip_incidents:
            print("Skipping incidents (--skip-incidents).")
        else:
            print("Embedding incidents...")
            incident_embeddings = list(
                model.embed([row["document"] for row in incident_rows], batch_size=batch_size)
            )
            _write_incidents(conn, incident_rows, incident_embeddings)

    print("Done.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument(
        "--database-url",
        default=os.environ.get("CABLEINCIDENTS_DATABASE_URL", DEFAULT_DATABASE_URL),
        help="Defaults to $CABLEINCIDENTS_DATABASE_URL if set, so the connection string never needs to "
        "be typed on the command line / land in shell history.",
    )
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--batch-size", type=int, default=EMBED_BATCH_SIZE)
    parser.add_argument(
        "--skip-cables", action="store_true", help="Skip (re-)embedding cables, e.g. if already ingested."
    )
    parser.add_argument(
        "--skip-incidents", action="store_true", help="Skip (re-)embedding incidents, e.g. if already ingested."
    )
    args = parser.parse_args()
    ingest(
        args.data_dir,
        args.database_url,
        args.model,
        args.batch_size,
        skip_cables=args.skip_cables,
        skip_incidents=args.skip_incidents,
    )


if __name__ == "__main__":
    main()
