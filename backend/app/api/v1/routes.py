from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from app.models.schemas import (
    CableDetail,
    CableSummary,
    HealthResponse,
    IncidentListItem,
    IncidentSummary,
    MarkerGroup,
)
from app.services.data_loader import DataStore

router = APIRouter(prefix="/api/v1")


def create_router(store: DataStore) -> APIRouter:
    @router.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            incident_count=len(store.incidents),
            cable_count=len(store.cables),
            marker_count=len(store.marker_groups),
        )

    @router.get("/cables", response_model=list[CableSummary])
    def list_cables() -> list[CableSummary]:
        return store.list_cables()

    @router.get("/cables/{name}", response_model=CableDetail)
    def get_cable(name: str) -> CableDetail:
        cable = store.get_cable(name)
        if not cable:
            raise HTTPException(status_code=404, detail="Cable not found")
        return cable

    @router.get("/incidents", response_model=list[IncidentListItem])
    def list_incidents() -> list[IncidentListItem]:
        return [
            IncidentListItem(
                id=incident.id,
                canonical_cable_name=incident.canonical_cable_name,
                original_cable_name=incident.original_cable_name,
                date=incident.date,
                status=incident.status,
                actor_tier=incident.actor_tier,
                marker_color=incident.marker_color,
                latitude=incident.latitude,
                longitude=incident.longitude,
                marker_group_id=incident.marker_group_id,
            )
            for incident in store.incidents
        ]

    @router.get("/incidents/{incident_id}", response_model=IncidentSummary)
    def get_incident(incident_id: str) -> IncidentSummary:
        incident = store.incidents_by_id.get(incident_id)
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        return incident

    @router.get("/markers", response_model=list[MarkerGroup])
    def list_markers() -> list[MarkerGroup]:
        return store.marker_groups

    @router.get("/map/cables")
    def map_cables() -> JSONResponse:
        return JSONResponse(store.cable_geojson)

    @router.get("/map/landing-points")
    def map_landing_points() -> JSONResponse:
        return JSONResponse(store.landing_geojson)

    @router.get("/cables/{name}/incidents")
    def cable_incidents(name: str) -> list[IncidentSummary]:
        incidents = store.incidents_by_cable.get(name)
        if incidents is None:
            raise HTTPException(status_code=404, detail="Cable not found")
        return incidents

    return router
