from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from app.models.schemas import (
    CableDetail,
    CableSummary,
    FilterMeta,
    HealthResponse,
    IncidentListItem,
    IncidentSummary,
    MarkerGroup,
)
from app.services.data_loader import DataStore

router = APIRouter(prefix="/api/v1")


def _split_csv_param(values: list[str] | None) -> list[str]:
    if not values:
        return []
    result: list[str] = []
    for value in values:
        for part in value.split(","):
            cleaned = part.strip()
            if cleaned:
                result.append(cleaned)
    return result


def create_router(store: DataStore) -> APIRouter:
    @router.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            incident_count=len(store.incidents),
            cable_count=len(store.cables),
            marker_count=len(store.marker_groups),
        )

    @router.get("/meta/filters", response_model=FilterMeta)
    def meta_filters() -> FilterMeta:
        return store.filter_meta()

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
    def list_incidents(
        q: str | None = Query(default=None),
        region: list[str] | None = Query(default=None),
        actor_tier: list[str] | None = Query(default=None),
        status: str | None = Query(default=None),
    ) -> list[IncidentListItem]:
        filtered = store.filter_incidents(
            q=q,
            regions=_split_csv_param(region),
            actor_tiers=_split_csv_param(actor_tier),
            status=status,
        )
        return [store.to_list_item(incident) for incident in filtered]

    @router.get("/incidents/{incident_id}", response_model=IncidentSummary)
    def get_incident(incident_id: str) -> IncidentSummary:
        incident = store.incidents_by_id.get(incident_id)
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        return incident

    @router.get("/markers", response_model=list[MarkerGroup])
    def list_markers(
        q: str | None = Query(default=None),
        region: list[str] | None = Query(default=None),
        actor_tier: list[str] | None = Query(default=None),
        status: str | None = Query(default=None),
    ) -> list[MarkerGroup]:
        return store.filter_markers(
            q=q,
            regions=_split_csv_param(region),
            actor_tiers=_split_csv_param(actor_tier),
            status=status,
        )

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
