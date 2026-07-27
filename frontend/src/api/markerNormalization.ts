import type { ActorTier, IncidentListItem, IncidentMarker, MarkerFill } from '../types/api'
import { markerFillFor, resolveStatusStroke } from '../map/markerStyles'

interface LegacyMarkerGroup {
  id: string
  latitude: number
  longitude: number
  marker_color?: string
  incident_ids?: string[]
  incident_count?: number
}

function isPerIncidentMarker(value: unknown): value is IncidentMarker {
  if (!value || typeof value !== 'object') {
    return false
  }
  const marker = value as IncidentMarker
  return (
    typeof marker.id === 'string' &&
    !marker.id.startsWith('group-') &&
    typeof marker.marker_fill === 'string' &&
    typeof marker.status_stroke === 'string'
  )
}

function legacyColorToFill(color?: string, actor_tier?: ActorTier): MarkerFill {
  if (actor_tier) {
    return markerFillFor(actor_tier)
  }
  if (color === 'red') {
    return 'red'
  }
  if (color === 'yellow') {
    return 'amber'
  }
  return 'slate'
}

export function normalizeMarkers(
  rawMarkers: unknown[],
  incidents: IncidentListItem[] = [],
): IncidentMarker[] {
  if (rawMarkers.length === 0) {
    return []
  }
  if (isPerIncidentMarker(rawMarkers[0])) {
    return rawMarkers as IncidentMarker[]
  }

  const incidentsById = new Map(incidents.map((incident) => [incident.id, incident]))
  const normalized: IncidentMarker[] = []

  for (const entry of rawMarkers as LegacyMarkerGroup[]) {
    const ids = entry.incident_ids ?? []
    for (const id of ids) {
      const incident = incidentsById.get(id)
      const marker_fill = incident?.marker_fill ?? legacyColorToFill(entry.marker_color, incident?.actor_tier)
      const status_stroke = resolveStatusStroke(incident?.status_stroke, incident?.status)
      normalized.push({
        id,
        latitude: entry.latitude,
        longitude: entry.longitude,
        actor_tier: incident?.actor_tier ?? 'none',
        resolved: status_stroke === 'resolved',
        marker_fill,
        status_stroke,
        canonical_cable_name: incident?.canonical_cable_name ?? '',
        original_cable_name: incident?.original_cable_name ?? '',
        date: incident?.date ?? '',
      })
    }
  }

  return normalized
}

export function resolveIncidentIdFromFeature(properties: Record<string, unknown> | null | undefined): string | null {
  if (!properties) {
    return null
  }

  const id = String(properties.id ?? '')
  if (id && !id.startsWith('group-')) {
    return id
  }

  const pipeIds = String(properties.incident_ids ?? '')
    .split('|')
    .map((value) => value.trim())
    .filter(Boolean)
  if (pipeIds.length > 0) {
    return pipeIds[0]
  }

  const arrayIds = properties.incident_ids
  if (Array.isArray(arrayIds) && arrayIds.length > 0) {
    return String(arrayIds[0])
  }

  return null
}
