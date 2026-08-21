"""Apply reviewed coordinates from incidents_coords_review.csv into incidents.csv.

This is the second, explicit step of the coordinate backfill workflow (see
backfill_coordinates.py for the first). It only writes Latitude/Longitude for
row ids that are still present in the review file with a non-empty proposed
lat/long -- delete rows from the review file (or blank out their proposed
values) for anything you don't want applied.

As a safety check, a row is skipped (with a warning) if incidents.csv already
has a Latitude/Longitude for that id by the time this runs, so a stale review
file can never silently overwrite real data.

Usage:
    python -m scripts.apply_coordinate_backfill
    python -m scripts.apply_coordinate_backfill --dry-run
    python -m scripts.apply_coordinate_backfill --review ../data/incidents_coords_review.csv
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DEFAULT_REVIEW_PATH = DEFAULT_DATA_DIR / "incidents_coords_review.csv"


def _load_csv_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fieldnames = list(reader.fieldnames or [])
        return fieldnames, list(reader)


def load_approved_coordinates(review_path: Path) -> dict[str, tuple[str, str]]:
    _, review_rows = _load_csv_rows(review_path)
    approved: dict[str, tuple[str, str]] = {}
    for row in review_rows:
        lat = (row.get("proposed_latitude") or "").strip()
        lon = (row.get("proposed_longitude") or "").strip()
        incident_id = (row.get("id") or "").strip()
        if incident_id and lat and lon:
            approved[incident_id] = (lat, lon)
    return approved


def apply_backfill(
    data_dir: Path, review_path: Path, out_path: Path, dry_run: bool = False
) -> None:
    incidents_path = data_dir / "incidents.csv"
    fieldnames, incidents = _load_csv_rows(incidents_path)
    approved = load_approved_coordinates(review_path)
    print(f"{len(approved)} approved coordinate(s) in {review_path}")

    applied = 0
    skipped_already_set = 0
    skipped_out_of_range = 0
    mismatches = 0
    coord_tolerance = 0.01  # ~1km; larger gaps are flagged rather than silently trusted

    for incident_id, (lat, lon) in approved.items():
        index = int(incident_id) - 1  # ids are 1-based, matching app._incident_id
        if index < 0 or index >= len(incidents):
            print(f"  id={incident_id}: no matching row in incidents.csv, skipping")
            skipped_out_of_range += 1
            continue

        row = incidents[index]
        existing_lat = (row.get("Latitude") or "").strip()
        existing_lon = (row.get("Longitude") or "").strip()
        row_changed = False

        for field, existing, proposed in (("Latitude", existing_lat, lat), ("Longitude", existing_lon, lon)):
            if not existing:
                row[field] = proposed
                row_changed = True
            else:
                try:
                    gap = abs(float(existing) - float(proposed))
                except ValueError:
                    gap = None
                if gap is not None and gap > coord_tolerance:
                    print(
                        f"  id={incident_id}: existing {field}={existing} differs from "
                        f"proposed {proposed}, leaving existing value untouched"
                    )
                    mismatches += 1

        if row_changed:
            applied += 1
        elif existing_lat and existing_lon:
            skipped_already_set += 1

    print(
        f"\n{applied} row(s) updated, {skipped_already_set} already fully set, "
        f"{mismatches} field(s) flagged as mismatched (left untouched), "
        f"{skipped_out_of_range} skipped (id not found)"
    )

    if dry_run:
        print("Dry run -- incidents.csv was not modified.")
        return

    if applied == 0:
        print("Nothing to write.")
        return

    with out_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(incidents)
    print(f"Wrote {applied} updated coordinate(s) to {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--review", type=Path, default=DEFAULT_REVIEW_PATH)
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Defaults to overwriting <data-dir>/incidents.csv in place.",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Print what would change without writing anything."
    )
    args = parser.parse_args()
    out_path = args.out or (args.data_dir / "incidents.csv")
    apply_backfill(args.data_dir, args.review, out_path, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
