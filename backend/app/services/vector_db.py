from __future__ import annotations

from typing import TYPE_CHECKING

from app.config import settings

if TYPE_CHECKING:
    import psycopg

_CABLE_COLUMNS = ["name", "owners", "region", "status", "shape_length"]
_INCIDENT_COLUMNS = [
    "id",
    "canonical_cable_name",
    "original_cable_name",
    "date",
    "type",
    "specific_location",
    "cause",
    "suspected_actor",
    "nation_state_suspected",
    "outage_impact",
    "dollar_cost",
    "duration_of_outage",
    "status",
    "source",
    "links",
]


def get_connection() -> "psycopg.Connection":
    import psycopg
    from pgvector.psycopg import register_vector

    # prepare_threshold=None disables psycopg's automatic server-side prepared
    # statements -- required for Supabase's connection pooler (PgBouncer in
    # transaction mode), which doesn't support them and errors with
    # "prepared statement ... does not exist" after a handful of queries.
    conn = psycopg.connect(settings.database_url, autocommit=True, prepare_threshold=None)
    register_vector(conn)
    return conn


def search_cables(embedding: list[float], limit: int = 10) -> list[dict]:
    columns_sql = ", ".join(_CABLE_COLUMNS)
    with get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT {columns_sql}, 1 - (embedding <=> %s::vector) AS score
            FROM cables
            ORDER BY embedding <=> %s::vector
            LIMIT %s
            """,
            (embedding, embedding, limit),
        ).fetchall()
    columns = [*_CABLE_COLUMNS, "score"]
    return [dict(zip(columns, row)) for row in rows]


def search_incidents(embedding: list[float], limit: int = 10) -> list[dict]:
    columns_sql = ", ".join(_INCIDENT_COLUMNS)
    with get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT {columns_sql}, 1 - (embedding <=> %s::vector) AS score
            FROM incidents
            ORDER BY embedding <=> %s::vector
            LIMIT %s
            """,
            (embedding, embedding, limit),
        ).fetchall()
    columns = [*_INCIDENT_COLUMNS, "score"]
    return [dict(zip(columns, row)) for row in rows]
