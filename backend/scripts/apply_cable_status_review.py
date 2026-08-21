"""Apply the confident ("derived") rows from data/cables_status_review.csv
into data/cables_shortened.csv, leaving everything else untouched.

Usage:
    cd backend
    python -m scripts.apply_cable_status_review
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
CABLES_CSV = DATA_DIR / "cables_shortened.csv"
REVIEW_CSV = DATA_DIR / "cables_status_review.csv"


def main() -> None:
    with REVIEW_CSV.open(encoding="utf-8-sig") as handle:
        review_rows = list(csv.DictReader(handle))

    proposed_by_name = {
        row["cable_name"].strip().lower(): row["proposed_status"].strip()
        for row in review_rows
        if row["confidence"] == "derived" and row["proposed_status"].strip()
    }

    with CABLES_CSV.open(encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        fieldnames = reader.fieldnames
        cables = list(reader)

    applied = 0
    for row in cables:
        if (row.get("status") or "").strip():
            continue
        proposed = proposed_by_name.get(row["Cable Name"].strip().lower())
        if proposed:
            row["status"] = proposed
            applied += 1

    with CABLES_CSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(cables)

    print(f"Applied {applied} status values into {CABLES_CSV}")


if __name__ == "__main__":
    main()
