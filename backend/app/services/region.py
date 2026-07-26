"""Derive geographic theater labels from incident coordinates.

The cables_shortened.csv `region` field is unreliable for filtering, so we
classify incidents into named basins using lat/lng bounding boxes.
"""

from __future__ import annotations

# Ordered most-specific first. Each entry: (name, lat_min, lat_max, lng_min, lng_max)
# Longitude ranges that cross the antimeridian use lng_min > lng_max.
THEATERS: list[tuple[str, float, float, float, float]] = [
    ("Baltic Sea", 53.0, 66.5, 9.0, 30.5),
    ("North Sea / Norwegian Sea", 51.0, 72.0, -5.0, 20.0),
    ("Mediterranean", 30.0, 46.0, -6.0, 37.0),
    ("Red Sea / Arabian Sea", 10.0, 31.0, 32.0, 75.0),
    ("Taiwan Strait / SCS", 0.0, 28.0, 100.0, 130.0),
    ("Caribbean", 8.0, 28.0, -90.0, -58.0),
    ("Arctic", 66.0, 90.0, -180.0, 180.0),
    ("North Atlantic", 20.0, 66.0, -80.0, 0.0),
    ("Pacific", -60.0, 65.0, 120.0, -70.0),  # crosses antimeridian
]

UNKNOWN = "Unknown"
OTHER = "Other"


def _in_lng_range(lng: float, lng_min: float, lng_max: float) -> bool:
    if lng_min <= lng_max:
        return lng_min <= lng <= lng_max
    # Antimeridian-crossing range (e.g. Pacific)
    return lng >= lng_min or lng <= lng_max


def classify_theater(latitude: float | None, longitude: float | None) -> str:
    if latitude is None or longitude is None:
        return UNKNOWN

    for name, lat_min, lat_max, lng_min, lng_max in THEATERS:
        if lat_min <= latitude <= lat_max and _in_lng_range(longitude, lng_min, lng_max):
            return name

    return OTHER


def all_theater_names() -> list[str]:
    names = [name for name, *_ in THEATERS]
    names.extend([OTHER, UNKNOWN])
    return names
