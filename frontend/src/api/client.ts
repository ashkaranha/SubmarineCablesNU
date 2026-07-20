import type { FeatureCollection } from 'geojson'
import type {
  CableDetail,
  IncidentListItem,
  IncidentSummary,
  MarkerGroup,
} from '../types/api'

const API_BASE = '/api/v1'

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`)
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }
  return response.json() as Promise<T>
}

export function fetchCableGeoJson(): Promise<FeatureCollection> {
  return getJson<FeatureCollection>('/map/cables')
}

export function fetchMarkers(): Promise<MarkerGroup[]> {
  return getJson<MarkerGroup[]>('/markers')
}

export function fetchCable(name: string): Promise<CableDetail> {
  return getJson<CableDetail>(`/cables/${encodeURIComponent(name)}`)
}

export function fetchIncident(id: string): Promise<IncidentSummary> {
  return getJson<IncidentSummary>(`/incidents/${encodeURIComponent(id)}`)
}

export function fetchIncidents(): Promise<IncidentListItem[]> {
  return getJson<IncidentListItem[]>('/incidents')
}
