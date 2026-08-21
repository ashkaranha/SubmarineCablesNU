from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from app.models.schemas import (
    CableDetail,
    CableSearchResult,
    CableSummary,
    FilterMeta,
    HealthResponse,
    IncidentListItem,
    IncidentMarker,
    IncidentSearchResult,
    IncidentSourcesResponse,
    IncidentSummary,
    SearchResponse,
)
from app.services import reranker, search_lexical
from app.services.data_loader import DataStore
from app.services.search_intent import classify_query
from app.services.source_finder import find_additional_sources

router = APIRouter(prefix="/api/v1")

# How many BM25 candidates to pull before reranking. Wider than what's
# ultimately shown so the cross-encoder has enough to work with, but kept
# modest -- every extra candidate is another document run through the
# cross-encoder's forward pass in the same batch, which raises the peak
# memory a single request needs on a host that's already tight on RAM.
CANDIDATE_POOL_SIZE = 20


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
    incident_rows = [search_lexical.incident_row(incident) for incident in store.incidents]
    incident_documents = [reranker.incident_document(row) for row in incident_rows]
    incident_index = search_lexical.build_index(incident_documents)

    cable_rows = [search_lexical.cable_row(cable) for cable in store.cables.values()]
    cable_documents = [reranker.cable_document(row) for row in cable_rows]
    cable_index = search_lexical.build_index(cable_documents)

    @router.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            incident_count=len(store.incidents),
            cable_count=len(store.cables),
            marker_count=len(store.markers),
        )

    @router.get("/meta/filters", response_model=FilterMeta)
    def meta_filters(
        q: str | None = Query(default=None),
        region: list[str] | None = Query(default=None),
        actor_tier: list[str] | None = Query(default=None),
        investigation_status: list[str] | None = Query(default=None),
        suspected_country: list[str] | None = Query(default=None),
        cable_type: list[str] | None = Query(default=None),
    ) -> FilterMeta:
        return store.filter_meta(
            q=q,
            regions=_split_csv_param(region),
            actor_tiers=_split_csv_param(actor_tier),
            investigation_statuses=_split_csv_param(investigation_status),
            suspected_countries=_split_csv_param(suspected_country),
            cable_types=_split_csv_param(cable_type),
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
    def list_incidents(
        q: str | None = Query(default=None),
        region: list[str] | None = Query(default=None),
        actor_tier: list[str] | None = Query(default=None),
        investigation_status: list[str] | None = Query(default=None),
        suspected_country: list[str] | None = Query(default=None),
        cable_type: list[str] | None = Query(default=None),
    ) -> list[IncidentListItem]:
        filtered = store.filter_incidents(
            q=q,
            regions=_split_csv_param(region),
            actor_tiers=_split_csv_param(actor_tier),
            investigation_statuses=_split_csv_param(investigation_status),
            suspected_countries=_split_csv_param(suspected_country),
            cable_types=_split_csv_param(cable_type),
        )
        return [store.to_list_item(incident) for incident in filtered]

    @router.get("/incidents/{incident_id}", response_model=IncidentSummary)
    def get_incident(incident_id: str) -> IncidentSummary:
        incident = store.incidents_by_id.get(incident_id)
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        return incident

    @router.get("/markers", response_model=list[IncidentMarker])
    def list_markers(
        q: str | None = Query(default=None),
        region: list[str] | None = Query(default=None),
        actor_tier: list[str] | None = Query(default=None),
        investigation_status: list[str] | None = Query(default=None),
        suspected_country: list[str] | None = Query(default=None),
        cable_type: list[str] | None = Query(default=None),
    ) -> list[IncidentMarker]:
        return store.filter_markers(
            q=q,
            regions=_split_csv_param(region),
            actor_tiers=_split_csv_param(actor_tier),
            investigation_statuses=_split_csv_param(investigation_status),
            suspected_countries=_split_csv_param(suspected_country),
            cable_types=_split_csv_param(cable_type),
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

    @router.get("/incidents/{incident_id}/sources", response_model=IncidentSourcesResponse)
    def incident_sources(incident_id: str) -> IncidentSourcesResponse:
        incident = store.incidents_by_id.get(incident_id)
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        try:
            llm_sources = find_additional_sources(incident)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"Source search unavailable: {exc}") from exc
        return IncidentSourcesResponse(
            incident_id=incident.id,
            existing_sources=incident.links,
            llm_sources=llm_sources,
        )

    @router.get("/search", response_model=SearchResponse)
    def search(
        q: str = Query(..., min_length=1),
        search_type: str = Query(default="all", alias="type", pattern="^(all|incidents|cables)$"),
        limit: int = Query(default=10, ge=1, le=50),
    ) -> SearchResponse:
        aggregate = classify_query(store, q, limit=limit)
        if aggregate is not None:
            return SearchResponse(query=q, aggregate=aggregate)

        incidents: list[IncidentSearchResult] = []
        cables: list[CableSearchResult] = []
        if search_type in ("all", "incidents"):
            candidate_indices = search_lexical.top_candidates(incident_index, q, CANDIDATE_POOL_SIZE)
            pool = [incident_rows[i] for i in candidate_indices]
            ranked = reranker.rerank_incidents(q, pool)
            incidents = [IncidentSearchResult(**row, score=score) for row, score in ranked[:limit]]
        if search_type in ("all", "cables"):
            candidate_indices = search_lexical.top_candidates(cable_index, q, CANDIDATE_POOL_SIZE)
            pool = [cable_rows[i] for i in candidate_indices]
            ranked = reranker.rerank_cables(q, pool)
            cables = [CableSearchResult(**row, score=score) for row, score in ranked[:limit]]

        return SearchResponse(query=q, incidents=incidents, cables=cables)

    return router
