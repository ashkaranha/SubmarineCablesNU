import type { FeatureCollection } from 'geojson'
import type {
  CableDetail,
  CableSummary,
  FilterMeta,
  IncidentListItem,
  IncidentMarker,
  IncidentQuery,
  IncidentSourcesResponse,
  IncidentSummary,
  SemanticSearchResponse,
  SemanticSearchType,
} from '../types/api'
import { normalizeMarkers } from './markerNormalization'

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1'

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`)
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { detail?: string }) => body?.detail)
      .catch(() => null)
    throw new Error(detail || `Request failed: ${response.status}`)
  }
  return response.json() as Promise<T>
}

function buildQueryString(query?: Partial<IncidentQuery>): string {
  if (!query) {
    return ''
  }
  const params = new URLSearchParams()
  if (query.q?.trim()) {
    params.set('q', query.q.trim())
  }
  for (const region of query.regions ?? []) {
    params.append('region', region)
  }
  for (const tier of query.actorTiers ?? []) {
    params.append('actor_tier', tier)
  }
  if (query.status) {
    params.set('status', query.status)
  }
  for (const country of query.suspectedCountries ?? []) {
    params.append('suspected_country', country)
  }
  for (const cableType of query.cableTypes ?? []) {
    params.append('cable_type', cableType)
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function fetchCableGeoJson(): Promise<FeatureCollection> {
  return getJson<FeatureCollection>('/map/cables')
}

export function fetchMarkers(
  query?: Partial<IncidentQuery>,
  incidents: IncidentListItem[] = [],
): Promise<IncidentMarker[]> {
  return getJson<unknown[]>(`/markers${buildQueryString(query)}`).then((markers) =>
    normalizeMarkers(markers, incidents),
  )
}

export function fetchCable(name: string): Promise<CableDetail> {
  return getJson<CableDetail>(`/cables/${encodeURIComponent(name)}`)
}

export function fetchCables(): Promise<CableSummary[]> {
  return getJson<CableSummary[]>('/cables')
}

export function fetchIncident(id: string): Promise<IncidentSummary> {
  return getJson<IncidentSummary>(`/incidents/${encodeURIComponent(id)}`)
}

export function fetchIncidents(query?: Partial<IncidentQuery>): Promise<IncidentListItem[]> {
  return getJson<IncidentListItem[]>(`/incidents${buildQueryString(query)}`)
}

export function fetchFilterMeta(query?: Partial<IncidentQuery>): Promise<FilterMeta> {
  return getJson<FilterMeta>(`/meta/filters${buildQueryString(query)}`)
}

export function fetchIncidentSources(id: string): Promise<IncidentSourcesResponse> {
  return getJson<IncidentSourcesResponse>(`/incidents/${encodeURIComponent(id)}/sources`)
}

export function fetchSemanticSearch(
  query: string,
  type: SemanticSearchType = 'all',
  limit = 10,
): Promise<SemanticSearchResponse> {
  const params = new URLSearchParams({ q: query, type, limit: String(limit) })
  return getJson<SemanticSearchResponse>(`/search?${params.toString()}`)
}
