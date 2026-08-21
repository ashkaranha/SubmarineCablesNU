"""Propose lat/long values for incidents.csv rows missing coordinates.

Read-only against incidents.csv -- never modifies it. For each row missing
Latitude/Longitude, tries two non-AI techniques, in order:

1. Parse coordinates already written out in the "Specific Location" text
   (e.g. "55 deg 17' 50\" N 14 deg 26' 07\" E, ..."). This is an exact
   transcription of digits already in the source data, not a derived value.
2. Geocode the location text against Nominatim (OpenStreetMap's free, public,
   real geocoding database) -- a real lookup, not a guess.

Every match (both "precise" and "vague" confidence) is written to a review
CSV. Nothing is applied to incidents.csv here; see apply_coordinate_backfill.py
for the second, explicit step that does that, and only for rows you keep in
the review file.

Usage:
    python -m scripts.backfill_coordinates
    python -m scripts.backfill_coordinates --data-dir ../data --out ../data/incidents_coords_review.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    # Some source location text contains characters (e.g. degree symbols)
    # that aren't representable in the default Windows console codepage.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DEFAULT_OUT_PATH = DEFAULT_DATA_DIR / "incidents_coords_review.csv"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_RATE_LIMIT_SECONDS = 1.0
USER_AGENT = "SubmarineCablesNU-data-backfill/1.0 (one-off coordinate research script)"

# Matches degree/minute/second coordinate pairs written out in free text, e.g.
# 55°17'50"N 14°26'07"E  or  55 17 50 N, 14 26 07 E. Also tolerates "?" and
# the unicode replacement character in place of °/'/" -- some rows in the
# source CSV have those symbols mangled by a prior encoding round-trip, but
# the surrounding digits are still the original, real data.
_DEG = "°\u00b0\ufffd?"
_MIN_SEC = "'\u2019\u2032\"\u2033?"
_DMS_PAIR = re.compile(
    rf"(?P<lat_deg>\d{{1,3}})\s*[{_DEG}]\s*(?P<lat_min>\d{{1,2}})\s*[{_MIN_SEC}]\s*"
    rf"(?P<lat_sec>\d{{1,2}}(?:\.\d+)?)?\s*[{_MIN_SEC}]?\s*(?P<lat_hem>[NSns])"
    r"[\s,]+"
    rf"(?P<lon_deg>\d{{1,3}})\s*[{_DEG}]\s*(?P<lon_min>\d{{1,2}})\s*[{_MIN_SEC}]\s*"
    rf"(?P<lon_sec>\d{{1,2}}(?:\.\d+)?)?\s*[{_MIN_SEC}]?\s*(?P<lon_hem>[EWew])"
)

_LOCATION_PREFIXES = re.compile(r"^(off|near|approximately|about|offshore of)\s+", re.IGNORECASE)

# A bounding box wider than this (in degrees) is treated as a vague/regional
# match rather than a precise point (e.g. "Taiwan Strait" resolves to a huge
# box; a named town resolves to a small one).
VAGUE_BBOX_DEGREES = 1.0

# Nominatim's free-text search treats "Off Malaysia" or "Taiwan, Philippines"
# as an address to parse, and happily returns a business/road/POI that merely
# contains one of those words (e.g. a reservoir named "... Off River Storage",
# or a restaurant literally named "Taiwan"). Those are not real matches for
# the query's *meaning* -- only accept results that are an actual place
# (country/region/city/natural feature), not a POI/building/road, and that
# have a non-trivial importance score (real places score much higher than
# incidentally-matched POIs).
ALLOWED_CATEGORIES = {"place", "boundary", "natural", "water", "waterway"}
MIN_IMPORTANCE = 0.05


def _is_trustworthy_result(result: dict) -> bool:
    if result.get("category") not in ALLOWED_CATEGORIES:
        return False
    try:
        importance = float(result.get("importance", 0))
    except (TypeError, ValueError):
        importance = 0.0
    return importance >= MIN_IMPORTANCE


def _load_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _dms_to_decimal(deg: str, minutes: str, seconds: str | None, hemisphere: str) -> float:
    value = float(deg) + float(minutes) / 60 + (float(seconds) if seconds else 0.0) / 3600
    if hemisphere.upper() in ("S", "W"):
        value = -value
    return value


def parse_embedded_coordinates(text: str) -> tuple[float, float] | None:
    """Extract a lat/long pair already written out in free text, if present."""
    match = _DMS_PAIR.search(text)
    if not match:
        return None
    lat = _dms_to_decimal(match["lat_deg"], match["lat_min"], match["lat_sec"], match["lat_hem"])
    lon = _dms_to_decimal(match["lon_deg"], match["lon_min"], match["lon_sec"], match["lon_hem"])
    return lat, lon


class NominatimClient:
    """Thin wrapper around Nominatim's public search API.

    Caches lookups by query string (many incidents share the same location
    text) and enforces Nominatim's 1 request/second usage policy.
    """

    def __init__(self) -> None:
        self._cache: dict[str, list[dict] | None] = {}
        self._last_request_time: float = 0.0

    def search(self, query: str) -> list[dict] | None:
        query = query.strip()
        if not query:
            return None
        if query in self._cache:
            return self._cache[query]

        elapsed = time.monotonic() - self._last_request_time
        if elapsed < NOMINATIM_RATE_LIMIT_SECONDS:
            time.sleep(NOMINATIM_RATE_LIMIT_SECONDS - elapsed)

        params = urllib.parse.urlencode({"q": query, "format": "jsonv2", "limit": 1})
        request = urllib.request.Request(
            f"{NOMINATIM_URL}?{params}",
            headers={"User-Agent": USER_AGENT},
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                results = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            print(f"  geocoding request failed for {query!r}: {exc}")
            results = None
        finally:
            self._last_request_time = time.monotonic()

        self._cache[query] = results or None
        return self._cache[query]


def _bbox_span_degrees(result: dict) -> float:
    box = result.get("boundingbox")
    if not box or len(box) != 4:
        return VAGUE_BBOX_DEGREES  # unknown -> treat conservatively as vague
    south, north, west, east = (float(v) for v in box)
    return max(north - south, east - west)


def geocode_location(client: NominatimClient, location_text: str) -> tuple[float, float, str, str] | None:
    """Returns (lat, lon, confidence, matched_display_name) or None.

    Tries the prefix-stripped text first (e.g. "Malaysia" instead of "Off
    Malaysia") since the raw "Off "/"Near " phrasing is more likely to trip
    up Nominatim into matching an unrelated POI; falls back to the raw text
    only if that yields nothing.
    """
    cleaned = _LOCATION_PREFIXES.sub("", location_text).strip()
    candidates = [cleaned, location_text] if cleaned and cleaned != location_text else [location_text]

    for candidate in candidates:
        results = client.search(candidate)
        if not results:
            continue
        result = results[0]
        if not _is_trustworthy_result(result):
            continue
        span = _bbox_span_degrees(result)
        confidence = "vague" if span >= VAGUE_BBOX_DEGREES else "precise"
        return float(result["lat"]), float(result["lon"]), confidence, result.get("display_name", "")
    return None


def build_review_rows(data_dir: Path) -> list[dict[str, str]]:
    incidents = _load_csv_rows(data_dir / "incidents.csv")
    client = NominatimClient()
    review_rows: list[dict[str, str]] = []

    missing = [
        (index, row)
        for index, row in enumerate(incidents, start=1)
        if not (row.get("Latitude") or "").strip() or not (row.get("Longitude") or "").strip()
    ]
    print(f"{len(missing)} incidents missing coordinates out of {len(incidents)} total.")

    for count, (incident_id, row) in enumerate(missing, start=1):
        location = (row.get("Specific Location") or "").strip()
        cable = (row.get("Canonical_Cable_Name") or "").strip()
        print(f"[{count}/{len(missing)}] id={incident_id} {cable!r} location={location!r}")

        if not location:
            review_rows.append(
                {
                    "id": str(incident_id),
                    "canonical_cable_name": cable,
                    "specific_location": location,
                    "proposed_latitude": "",
                    "proposed_longitude": "",
                    "source": "",
                    "confidence": "not_found",
                    "note": "Specific Location is blank; nothing to parse or geocode.",
                }
            )
            continue

        parsed = parse_embedded_coordinates(location)
        if parsed:
            lat, lon = parsed
            review_rows.append(
                {
                    "id": str(incident_id),
                    "canonical_cable_name": cable,
                    "specific_location": location,
                    "proposed_latitude": f"{lat:.6f}",
                    "proposed_longitude": f"{lon:.6f}",
                    "source": "parsed",
                    "confidence": "precise",
                    "note": "Coordinates were already written out in Specific Location.",
                }
            )
            continue

        geocoded = geocode_location(client, location)
        if geocoded:
            lat, lon, confidence, display_name = geocoded
            review_rows.append(
                {
                    "id": str(incident_id),
                    "canonical_cable_name": cable,
                    "specific_location": location,
                    "proposed_latitude": f"{lat:.6f}",
                    "proposed_longitude": f"{lon:.6f}",
                    "source": "geocoded",
                    "confidence": confidence,
                    "note": f"Nominatim match: {display_name}",
                }
            )
        else:
            review_rows.append(
                {
                    "id": str(incident_id),
                    "canonical_cable_name": cable,
                    "specific_location": location,
                    "proposed_latitude": "",
                    "proposed_longitude": "",
                    "source": "",
                    "confidence": "not_found",
                    "note": "No geocoding match found for this location text.",
                }
            )

    return review_rows


def write_review_csv(rows: list[dict[str, str]], out_path: Path) -> None:
    fieldnames = [
        "id",
        "canonical_cable_name",
        "specific_location",
        "proposed_latitude",
        "proposed_longitude",
        "source",
        "confidence",
        "note",
    ]
    with out_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_PATH)
    args = parser.parse_args()

    rows = build_review_rows(args.data_dir)
    write_review_csv(rows, args.out)

    precise = sum(1 for r in rows if r["confidence"] == "precise")
    vague = sum(1 for r in rows if r["confidence"] == "vague")
    not_found = sum(1 for r in rows if r["confidence"] == "not_found")
    print(
        f"\nWrote {len(rows)} rows to {args.out}\n"
        f"  precise: {precise}\n"
        f"  vague:   {vague}\n"
        f"  not found: {not_found}\n"
        "Review the file, delete any rows you don't want applied, then run "
        "apply_coordinate_backfill.py."
    )


if __name__ == "__main__":
    main()
