"""Report missing/blank values across incidents.csv and cables_shortened.csv.

Read-only -- makes no changes. Run this any time to see the current state of
data completeness, e.g. before/after a cleanup pass like
backfill_coordinates.py / apply_coordinate_backfill.py.

Usage:
    python -m scripts.data_quality_report
    python -m scripts.data_quality_report --data-dir ../data
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / "data"

# Columns that are expected to often be blank (best-effort fields) -- still
# reported, but not necessarily actionable.
OPTIONAL_COLUMNS = {
    "Dollar Cost (USD)",
    "Duration of Outage",
    "Link #2",
    "Link #3",
}


def _load_csv_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        return list(reader.fieldnames or []), list(reader)


def _is_blank(value: str | None) -> bool:
    return not (value or "").strip()


def report_completeness(name: str, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    total = len(rows)
    print(f"\n{name}: {total} rows")
    if total == 0:
        return

    print(f"  {'column':<32} {'missing':>8} {'%':>7}  flag")
    for column in fieldnames:
        missing = sum(1 for row in rows if _is_blank(row.get(column)))
        if missing == 0:
            continue
        pct = 100 * missing / total
        flag = "(expected best-effort field)" if column in OPTIONAL_COLUMNS else ""
        print(f"  {column:<32} {missing:>8} {pct:>6.1f}%  {flag}")


def report_duplicate_names(name: str, rows: list[dict[str, str]], key: str) -> None:
    seen: dict[str, int] = {}
    for row in rows:
        value = (row.get(key) or "").strip()
        if value:
            seen[value] = seen.get(value, 0) + 1
    duplicates = {k: v for k, v in seen.items() if v > 1}
    if duplicates:
        print(f"\n{name}: {len(duplicates)} duplicate '{key}' value(s):")
        for value, count in sorted(duplicates.items(), key=lambda kv: -kv[1])[:20]:
            print(f"  {value!r}: {count} rows")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    args = parser.parse_args()

    incident_fields, incidents = _load_csv_rows(args.data_dir / "incidents.csv")
    cable_fields, cables = _load_csv_rows(args.data_dir / "cables_shortened.csv")

    report_completeness("incidents.csv", incident_fields, incidents)
    report_completeness("cables_shortened.csv", cable_fields, cables)
    report_duplicate_names("cables_shortened.csv", cables, "Cable Name")

    both_missing = sum(
        1 for row in incidents if _is_blank(row.get("Latitude")) and _is_blank(row.get("Longitude"))
    )
    one_missing = sum(
        1
        for row in incidents
        if _is_blank(row.get("Latitude")) != _is_blank(row.get("Longitude"))
    )
    print(
        f"\nincidents.csv coordinates: {both_missing} row(s) missing both lat/long, "
        f"{one_missing} row(s) missing only one (likely a data-entry gap worth checking by hand)."
    )


if __name__ == "__main__":
    main()
