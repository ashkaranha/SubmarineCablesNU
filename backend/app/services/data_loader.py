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
    FilterCount,
    FilterMeta,
    IncidentListItem,
    IncidentMarker,
    IncidentSummary,
)
from app.services.actor_tier import (
    badge_color_for,
    classify_actor_tier,
    extract_suspected_countries,
    is_resolved_status,
    marker_fill_for,
    status_stroke_for,
)
from app.services.region import classify_theater


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
    markers: list[IncidentMarker] = field(default_factory=list)
    cable_geojson: dict[str, Any] = field(default_factory=dict)
    landing_geojson: dict[str, Any] = field(default_factory=dict)
    telegeography_by_name: dict[str, dict[str, Any]] = field(default_factory=dict)
    landing_coords_by_id: dict[str, tuple[float, float]] = field(default_factory=dict)
    cable_route_midpoints: dict[str, tuple[float, float]] = field(default_factory=dict)

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

    def to_list_item(self, incident: IncidentSummary) -> IncidentListItem:
        return IncidentListItem(
            id=incident.id,
            canonical_cable_name=incident.canonical_cable_name,
            original_cable_name=incident.original_cable_name,
            date=incident.date,
            type=incident.type,
            status=incident.status,
            cause=incident.cause,
            nation_state_suspected=incident.nation_state_suspected,
            actor_tier=incident.actor_tier,
            marker_fill=incident.marker_fill,
            status_stroke=incident.status_stroke,
            resolved=incident.resolved,
            badge_color=incident.badge_color,
            region=incident.region,
            latitude=incident.latitude,
            longitude=incident.longitude,
            suspected_countries=incident.suspected_countries,
        )

    def to_marker(self, incident: IncidentSummary) -> IncidentMarker | None:
        if incident.latitude is None or incident.longitude is None:
            return None
        return IncidentMarker(
            id=incident.id,
            latitude=incident.latitude,
            longitude=incident.longitude,
            actor_tier=incident.actor_tier,
            resolved=incident.resolved,
            marker_fill=incident.marker_fill,
            status_stroke=incident.status_stroke,
            canonical_cable_name=incident.canonical_cable_name,
            original_cable_name=incident.original_cable_name,
            date=incident.date,
        )

    def filter_incidents(
        self,
        *,
        q: str | None = None,
        regions: list[str] | None = None,
        actor_tiers: list[str] | None = None,
        status: str | None = None,
        suspected_countries: list[str] | None = None,
        cable_types: list[str] | None = None,
    ) -> list[IncidentSummary]:
        query = (q or "").strip().lower()
        region_set = {value.strip() for value in (regions or []) if value.strip()}
        tier_set = {value.strip() for value in (actor_tiers or []) if value.strip()}
        status_filter = (status or "").strip().lower() or None
        country_set = {value.strip() for value in (suspected_countries or []) if value.strip()}
        type_set = {value.strip() for value in (cable_types or []) if value.strip()}

        results: list[IncidentSummary] = []
        for incident in self.incidents:
            if region_set and incident.region not in region_set:
                continue
            if tier_set and incident.actor_tier not in tier_set:
                continue
            if status_filter == "resolved" and not is_resolved_status(incident.status):
                continue
            if status_filter == "unresolved" and is_resolved_status(incident.status):
                continue
            if country_set and not country_set.intersection(incident.suspected_countries):
                continue
            if type_set and incident.type not in type_set:
                continue
            if query and not _incident_matches_query(incident, query):
                continue
            results.append(incident)
        return results

    def filter_markers(
        self,
        *,
        q: str | None = None,
        regions: list[str] | None = None,
        actor_tiers: list[str] | None = None,
        status: str | None = None,
        suspected_countries: list[str] | None = None,
        cable_types: list[str] | None = None,
    ) -> list[IncidentMarker]:
        filtered = self.filter_incidents(
            q=q,
            regions=regions,
            actor_tiers=actor_tiers,
            status=status,
            suspected_countries=suspected_countries,
            cable_types=cable_types,
        )
        markers: list[IncidentMarker] = []
        for incident in filtered:
            marker = self.to_marker(incident)
            if marker is not None:
                markers.append(marker)
        return markers

    def filter_meta(self) -> FilterMeta:
        region_counts: dict[str, int] = {}
        tier_counts: dict[str, int] = {"confirmed": 0, "suspected": 0, "none": 0}
        country_counts: dict[str, int] = {}
        type_counts: dict[str, int] = {}
        resolved = 0
        unresolved = 0
        for incident in self.incidents:
            region_counts[incident.region] = region_counts.get(incident.region, 0) + 1
            tier_counts[incident.actor_tier] = tier_counts.get(incident.actor_tier, 0) + 1
            if is_resolved_status(incident.status):
                resolved += 1
            else:
                unresolved += 1
            for country in incident.suspected_countries:
                country_counts[country] = country_counts.get(country, 0) + 1
            if incident.type:
                type_counts[incident.type] = type_counts.get(incident.type, 0) + 1

        regions = [
            FilterCount(value=name, count=count)
            for name, count in sorted(region_counts.items(), key=lambda item: (-item[1], item[0]))
        ]
        actor_tiers = [
            FilterCount(value=name, count=tier_counts.get(name, 0))
            for name in ("confirmed", "suspected", "none")
        ]
        statuses = [
            FilterCount(value="resolved", count=resolved),
            FilterCount(value="unresolved", count=unresolved),
        ]
        suspected_countries = [
            FilterCount(value=name, count=count)
            for name, count in sorted(country_counts.items(), key=lambda item: (-item[1], item[0]))
        ]
        cable_types = [
            FilterCount(value=name, count=count)
            for name, count in sorted(type_counts.items(), key=lambda item: (-item[1], item[0]))
        ]
        return FilterMeta(
            regions=regions,
            actor_tiers=actor_tiers,
            statuses=statuses,
            suspected_countries=suspected_countries,
            cable_types=cable_types,
            total=len(self.incidents),
        )


def _incident_matches_query(incident: IncidentSummary, query: str) -> bool:
    haystacks = [
        incident.canonical_cable_name,
        incident.original_cable_name,
        incident.specific_location,
        incident.cause,
        incident.suspected_actor,
        incident.nation_state_suspected,
        incident.source,
        incident.status,
        incident.region,
        incident.outage_impact,
    ]
    return any(query in (value or "").lower() for value in haystacks)


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


def _line_endpoints(coordinates: Any) -> tuple[list[float], list[float]] | None:
    if not isinstance(coordinates, list) or not coordinates:
        return None
    first = coordinates[0]
    if isinstance(first, (int, float)) and len(coordinates) >= 2:
        # Position: [lng, lat]
        return [float(coordinates[0]), float(coordinates[1])], [
            float(coordinates[0]),
            float(coordinates[1]),
        ]
    if isinstance(first, list) and first and isinstance(first[0], (int, float)):
        # LineString: [[lng, lat], ...]
        start = coordinates[0]
        end = coordinates[-1]
        return [float(start[0]), float(start[1])], [float(end[0]), float(end[1])]
    if isinstance(first, list) and first and isinstance(first[0], list):
        # MultiLineString
        start = coordinates[0][0]
        end = coordinates[-1][-1]
        return [float(start[0]), float(start[1])], [float(end[0]), float(end[1])]
    return None


def _build_cable_route_midpoints(cable_geojson: dict[str, Any]) -> dict[str, tuple[float, float]]:
    midpoints: dict[str, tuple[float, float]] = {}
    for feature in cable_geojson.get("features", []):
        props = feature.get("properties", {})
        name = (props.get("name") or "").strip()
        if not name:
            continue
        geometry = feature.get("geometry") or {}
        endpoints = _line_endpoints(geometry.get("coordinates"))
        if not endpoints:
            continue
        start, end = endpoints
        lng = (start[0] + end[0]) / 2
        lat = (start[1] + end[1]) / 2
        # Prefer first feature if duplicates; keep existing
        midpoints.setdefault(name.lower(), (lat, lng))
    return midpoints


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

    store.cable_route_midpoints = _build_cable_route_midpoints(store.cable_geojson)

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
        suspected_countries = extract_suspected_countries(nation_state)
        marker_fill = marker_fill_for(actor_tier)
        stroke = status_stroke_for(status)
        badge_color = badge_color_for(actor_tier, status)
        resolved = is_resolved_status(status)

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
            else:
                route_mid = store.cable_route_midpoints.get(canonical.lower())
                if route_mid:
                    latitude, longitude = route_mid
                    coordinate_source = "cable_route"

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
            marker_fill=marker_fill,
            status_stroke=stroke,
            resolved=resolved,
            badge_color=badge_color,
            region=classify_theater(latitude, longitude),
            latitude=latitude,
            longitude=longitude,
            coordinate_source=coordinate_source,  # type: ignore[arg-type]
            suspected_countries=suspected_countries,
        )
        raw_incidents.append(incident)

    raw_incidents.sort(key=lambda item: _parse_date(item.date), reverse=True)
    store.incidents = raw_incidents
    store.incidents_by_id = {incident.id: incident for incident in raw_incidents}
    store.markers = [marker for incident in raw_incidents if (marker := store.to_marker(incident))]

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
