from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from app.config import settings
from app.models.schemas import (
    CableDetail,
    CableSummary,
    IncidentListItem,
    IncidentSummary,
    MarkerGroup,
)
from app.services.actor_tier import (
    badge_color_for,
    classify_actor_tier,
    marker_color_for,
    marker_severity,
)


def _parse_float(value: str | None) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _parse_date(value: str | None) -> datetime:
    text = (value or "").strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return datetime.min


def _format_length(length_km: float | None, shape_length: str | None) -> tuple[float | None, str | None]:
    if length_km is not None:
        return length_km, f"{length_km:,.0f} km"
    shape = _parse_float(shape_length)
    if shape is None:
        return None, None
    return shape, f"{shape:,.0f} (projected units; verify)"


def _link_hostname(url: str) -> str:
    try:
        host = urlparse(url).netloc.replace("www.", "")
        return host or url
    except Exception:
        return url


@dataclass
class DataStore:
    cables: dict[str, dict[str, Any]] = field(default_factory=dict)
    incidents: list[IncidentSummary] = field(default_factory=list)
    incidents_by_id: dict[str, IncidentSummary] = field(default_factory=dict)
    incidents_by_cable: dict[str, list[IncidentSummary]] = field(default_factory=dict)
    marker_groups: list[MarkerGroup] = field(default_factory=list)
    cable_geojson: dict[str, Any] = field(default_factory=dict)
    landing_geojson: dict[str, Any] = field(default_factory=dict)
    telegeography_by_name: dict[str, dict[str, Any]] = field(default_factory=dict)
    landing_coords_by_id: dict[str, tuple[float, float]] = field(default_factory=dict)

    def get_cable(self, name: str) -> CableDetail | None:
        cable_row = self.cables.get(name)
        if not cable_row:
            return None
        incidents = self.incidents_by_cable.get(name, [])
        length_km, length_display = self._cable_length(name, cable_row)
        return CableDetail(
            name=name,
            owners=cable_row.get("owners"),
            region=cable_row.get("region"),
            status=cable_row.get("status"),
            length_km=length_km,
            length_display=length_display,
            incident_count=len(incidents),
            incidents=incidents,
        )

    def list_cables(self) -> list[CableSummary]:
        summaries: list[CableSummary] = []
        for name, row in self.cables.items():
            length_km, length_display = self._cable_length(name, row)
            summaries.append(
                CableSummary(
                    name=name,
                    owners=row.get("owners"),
                    region=row.get("region"),
                    status=row.get("status"),
                    length_km=length_km,
                    length_display=length_display,
                    incident_count=len(self.incidents_by_cable.get(name, [])),
                )
            )
        summaries.sort(key=lambda item: (-item.incident_count, item.name.lower()))
        return summaries

    def _cable_length(self, name: str, row: dict[str, Any]) -> tuple[float | None, str | None]:
        tg = self.telegeography_by_name.get(name.lower())
        if tg and tg.get("length") is not None:
            try:
                km = float(tg["length"])
                return km, f"{km:,.0f} km"
            except (TypeError, ValueError):
                pass
        return _format_length(None, row.get("shape_length"))


def _load_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _normalize_cable_row(row: dict[str, str]) -> dict[str, Any]:
    return {
        "name": (row.get("Cable Name") or "").strip(),
        "owners": (row.get("Owners") or "").strip() or None,
        "region": (row.get("region") or "").strip() or None,
        "status": (row.get("status") or "").strip() or None,
        "shape_length": (row.get("SHAPE__Length") or "").strip() or None,
    }


def _incident_links(row: dict[str, str]) -> list[str]:
    links: list[str] = []
    for key in ("Link #1", "Link #2", "Link #3"):
        value = (row.get(key) or "").strip()
        if value:
            links.append(value)
    return links


def _incident_id(index: int) -> str:
    return str(index)


def _landing_midpoint(
    cable_name: str,
    telegeography_by_name: dict[str, dict[str, Any]],
    landing_coords_by_id: dict[str, tuple[float, float]],
) -> tuple[float, float] | None:
    tg = telegeography_by_name.get(cable_name.lower())
    if not tg:
        return None
    coords: list[tuple[float, float]] = []
    for landing in tg.get("landing_points", []):
        landing_id = landing.get("id")
        if landing_id and landing_id in landing_coords_by_id:
            coords.append(landing_coords_by_id[landing_id])
    if not coords:
        return None
    lng = sum(point[0] for point in coords) / len(coords)
    lat = sum(point[1] for point in coords) / len(coords)
    return lat, lng


def _group_markers(incidents: list[IncidentSummary]) -> list[MarkerGroup]:
    groups: dict[str, list[IncidentSummary]] = {}
    for incident in incidents:
        if incident.latitude is None or incident.longitude is None:
            continue
        key = f"{incident.latitude:.4f}:{incident.longitude:.4f}"
        groups.setdefault(key, []).append(incident)

    marker_groups: list[MarkerGroup] = []
    for index, (_, group_incidents) in enumerate(groups.items()):
        group_incidents.sort(key=lambda item: _parse_date(item.date), reverse=True)
        marker_color = max(
            (incident.marker_color for incident in group_incidents),
            key=marker_severity,
        )
        group_id = f"group-{index}"
        for incident in group_incidents:
            incident.marker_group_id = group_id
        primary = group_incidents[0]
        marker_groups.append(
            MarkerGroup(
                id=group_id,
                latitude=primary.latitude or 0,
                longitude=primary.longitude or 0,
                marker_color=marker_color,
                incident_ids=[incident.id for incident in group_incidents],
                incident_count=len(group_incidents),
            )
        )
    return marker_groups


def load_data_store(data_dir: Path | None = None) -> DataStore:
    root = data_dir or settings.data_dir
    store = DataStore()

    with (root / "telegeography" / "cable-geo.json").open(encoding="utf-8") as handle:
        store.cable_geojson = json.load(handle)
    with (root / "telegeography" / "landing-point-geo.json").open(encoding="utf-8") as handle:
        store.landing_geojson = json.load(handle)
    with (root / "telegeography" / "cable-all.json").open(encoding="utf-8") as handle:
        all_cables = json.load(handle)
    for cable in all_cables:
        name = (cable.get("name") or "").strip()
        if name:
            store.telegeography_by_name[name.lower()] = cable

    for feature in store.landing_geojson.get("features", []):
        props = feature.get("properties", {})
        landing_id = props.get("id")
        geometry = feature.get("geometry", {})
        coords = geometry.get("coordinates")
        if landing_id and isinstance(coords, list) and len(coords) >= 2:
            store.landing_coords_by_id[landing_id] = (float(coords[0]), float(coords[1]))

    for row in _load_csv_rows(root / "cables_shortened.csv"):
        normalized = _normalize_cable_row(row)
        if normalized["name"]:
            store.cables[normalized["name"]] = normalized

    raw_incidents: list[IncidentSummary] = []
    for index, row in enumerate(_load_csv_rows(root / "incidents.csv"), start=1):
        canonical = (row.get("Canonical_Cable_Name") or "").strip()
        nation_state = (row.get("Nation State Suspected") or "").strip() or None
        status = (row.get("Status") or "").strip() or None
        actor_tier = classify_actor_tier(nation_state)
        marker_color = marker_color_for(actor_tier, status)
        badge_color = badge_color_for(actor_tier, status)

        latitude = _parse_float(row.get("Latitude"))
        longitude = _parse_float(row.get("Longitude"))
        coordinate_source: str = "none"
        if latitude is not None and longitude is not None:
            coordinate_source = "csv"
        else:
            midpoint = _landing_midpoint(canonical, store.telegeography_by_name, store.landing_coords_by_id)
            if midpoint:
                latitude, longitude = midpoint
                coordinate_source = "landing_midpoint"

        incident = IncidentSummary(
            id=_incident_id(index),
            canonical_cable_name=canonical,
            original_cable_name=(row.get("Original Cable Name") or "").strip(),
            date=(row.get("Date") or "").strip(),
            type=(row.get("Type") or "").strip() or None,
            specific_location=(row.get("Specific Location") or "").strip() or None,
            cause=(row.get("Cause") or "").strip() or None,
            suspected_actor=(row.get("Suspected Actor (Vessel/Individual)") or "").strip() or None,
            nation_state_suspected=nation_state,
            outage_impact=(row.get("Outage Impact") or "").strip() or None,
            dollar_cost=(row.get("Dollar Cost (USD)") or "").strip() or None,
            duration_of_outage=(row.get("Duration of Outage") or "").strip() or None,
            status=status,
            source=(row.get("Source") or "").strip() or None,
            links=_incident_links(row),
            actor_tier=actor_tier,
            marker_color=marker_color,
            badge_color=badge_color,
            latitude=latitude,
            longitude=longitude,
            coordinate_source=coordinate_source,  # type: ignore[arg-type]
        )
        raw_incidents.append(incident)

    raw_incidents.sort(key=lambda item: _parse_date(item.date), reverse=True)
    store.marker_groups = _group_markers(raw_incidents)
    store.incidents = raw_incidents
    store.incidents_by_id = {incident.id: incident for incident in raw_incidents}

    incidents_by_cable: dict[str, list[IncidentSummary]] = {}
    for incident in raw_incidents:
        incidents_by_cable.setdefault(incident.canonical_cable_name, []).append(incident)
    for cable_name, cable_incidents in incidents_by_cable.items():
        cable_incidents.sort(key=lambda item: _parse_date(item.date), reverse=True)
    store.incidents_by_cable = incidents_by_cable

    return store


def link_label(url: str, fallback: str) -> str:
    host = _link_hostname(url)
    return host if host else fallback
