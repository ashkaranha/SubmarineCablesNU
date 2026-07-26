from typing import Literal

from pydantic import BaseModel, Field


ActorTier = Literal["confirmed", "suspected", "none"]
MarkerColor = Literal["red", "yellow", "green", "gray"]
BadgeColor = Literal["red", "yellow", "green"]
StatusFilter = Literal["resolved", "unresolved"]


class IncidentSummary(BaseModel):
    id: str
    canonical_cable_name: str
    original_cable_name: str
    date: str
    type: str | None = None
    specific_location: str | None = None
    cause: str | None = None
    suspected_actor: str | None = None
    nation_state_suspected: str | None = None
    outage_impact: str | None = None
    dollar_cost: str | None = None
    duration_of_outage: str | None = None
    status: str | None = None
    source: str | None = None
    links: list[str] = Field(default_factory=list)
    actor_tier: ActorTier
    marker_color: MarkerColor
    badge_color: BadgeColor
    region: str = "Unknown"
    latitude: float | None = None
    longitude: float | None = None
    marker_group_id: str | None = None
    coordinate_source: Literal["csv", "landing_midpoint", "none"] = "none"


class IncidentListItem(BaseModel):
    id: str
    canonical_cable_name: str
    original_cable_name: str
    date: str
    status: str | None = None
    cause: str | None = None
    nation_state_suspected: str | None = None
    actor_tier: ActorTier
    marker_color: MarkerColor
    badge_color: BadgeColor
    region: str = "Unknown"
    latitude: float | None = None
    longitude: float | None = None
    marker_group_id: str | None = None


class MarkerGroup(BaseModel):
    id: str
    latitude: float
    longitude: float
    marker_color: MarkerColor
    incident_ids: list[str]
    incident_count: int


class CableSummary(BaseModel):
    name: str
    owners: str | None = None
    region: str | None = None
    status: str | None = None
    length_km: float | None = None
    length_display: str | None = None
    incident_count: int = 0


class CableDetail(CableSummary):
    incidents: list[IncidentSummary] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str
    incident_count: int
    cable_count: int
    marker_count: int


class FilterCount(BaseModel):
    value: str
    count: int


class FilterMeta(BaseModel):
    regions: list[FilterCount]
    actor_tiers: list[FilterCount]
    statuses: list[FilterCount]
    total: int
