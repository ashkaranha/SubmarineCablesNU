"""Propose `status` values for cables in data/cables_shortened.csv that are missing one.

This does NOT guess or AI-generate statuses. For each cable missing a status,
it looks up the cable's own entry in TeleGeography's public per-cable API
(the same public source data/telegeography/*.json already comes from) and
uses only the fields TeleGeography itself publishes:

    - is_planned == true               -> "Planned"
    - is_planned == false + past rfs   -> "In Service"

TeleGeography's data does not track outages/damage/retirement, so any cable
that currently has a non-resolved-looking incident in incidents.csv is
skipped (flagged for manual review) rather than defaulted to "In Service",
since that default could be wrong for exactly the cables most likely to
need a real status update. Cables with no match in TeleGeography's dataset
(e.g. non-telecom cables like power/gas interconnectors) are also flagged.

Writes proposals to data/cables_status_review.csv for manual review -- it
does NOT modify cables_shortened.csv directly. Same pattern as the existing
data/incidents_coords_review.csv backfill.

Usage:
    cd backend
    python -m scripts.backfill_cable_status
"""

from __future__ import annotations

import csv
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
CABLES_CSV = DATA_DIR / "cables_shortened.csv"
INCIDENTS_CSV = DATA_DIR / "incidents.csv"
CABLE_ALL_JSON = DATA_DIR / "telegeography" / "cable-all.json"
OUTPUT_CSV = DATA_DIR / "cables_status_review.csv"

API_URL_TEMPLATE = "https://www.submarinecablemap.com/api/v3/cable/{id}.json"
REQUEST_DELAY_SECONDS = 0.4
USER_AGENT = "SubmarineCablesNU-data-backfill/1.0 (manual research project; contact via GitHub repo)"


def _load_telegeography_ids() -> dict[str, str]:
    with CABLE_ALL_JSON.open(encoding="utf-8") as handle:
        entries = json.load(handle)
    return {entry["name"].strip().lower(): entry["id"] for entry in entries if entry.get("name")}


def _load_unresolved_cable_names() -> set[str]:
    """Cable names with an incident whose Status doesn't read as resolved/closed."""
    unresolved: set[str] = set()
    with INCIDENTS_CSV.open(encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            status = (row.get("Status") or "").strip().lower()
            if not status:
                continue
            if "resolved" in status or "closed" in status or "concluded" in status:
                continue
            name = (row.get("Canonical_Cable_Name") or "").strip().lower()
            if name:
                unresolved.add(name)
    return unresolved


def _fetch_cable_detail(cable_id: str) -> dict | None:
    url = API_URL_TEMPLATE.format(id=cable_id)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        print(f"  HTTP {exc.code} for {cable_id}")
        return None
    except Exception as exc:  # noqa: BLE001 - best-effort network call
        print(f"  Error fetching {cable_id}: {exc}")
        return None


def main() -> None:
    telegeography_ids = _load_telegeography_ids()
    unresolved_cable_names = _load_unresolved_cable_names()

    with CABLES_CSV.open(encoding="utf-8-sig") as handle:
        cables = list(csv.DictReader(handle))

    missing = [row for row in cables if not (row.get("status") or "").strip()]
    print(f"{len(missing)} cables missing a status out of {len(cables)} total.\n")

    results: list[dict[str, str]] = []
    for i, row in enumerate(missing, start=1):
        name = row["Cable Name"].strip()
        name_lower = name.lower()
        print(f"[{i}/{len(missing)}] {name}")

        if name_lower in unresolved_cable_names:
            results.append(
                {
                    "cable_name": name,
                    "proposed_status": "",
                    "source": "",
                    "confidence": "needs_manual_review",
                    "note": "Has a non-resolved-looking incident status in incidents.csv; "
                    "TeleGeography data doesn't track outages, so don't default this one.",
                }
            )
            continue

        cable_id = telegeography_ids.get(name_lower)
        if not cable_id:
            results.append(
                {
                    "cable_name": name,
                    "proposed_status": "",
                    "source": "",
                    "confidence": "not_found",
                    "note": "No matching entry in TeleGeography's dataset "
                    "(may not be a telecom cable, or name doesn't match exactly).",
                }
            )
            continue

        detail = _fetch_cable_detail(cable_id)
        time.sleep(REQUEST_DELAY_SECONDS)
        if detail is None:
            results.append(
                {
                    "cable_name": name,
                    "proposed_status": "",
                    "source": "",
                    "confidence": "fetch_failed",
                    "note": "Request to TeleGeography's API failed; retry later.",
                }
            )
            continue

        is_planned = detail.get("is_planned")
        rfs_year = detail.get("rfs_year")
        if is_planned:
            proposed = "Planned"
        elif rfs_year:
            proposed = "In Service"
        else:
            proposed = ""

        results.append(
            {
                "cable_name": name,
                "proposed_status": proposed,
                "source": f"telegeography:{cable_id}",
                "confidence": "derived" if proposed else "insufficient_data",
                "note": f"is_planned={is_planned!r}, rfs_year={rfs_year!r}",
            }
        )

    with OUTPUT_CSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=["cable_name", "proposed_status", "source", "confidence", "note"]
        )
        writer.writeheader()
        writer.writerows(results)

    from collections import Counter

    print("\nDone. Summary:")
    print(Counter(r["confidence"] for r in results))
    print(f"\nWrote {len(results)} rows to {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
