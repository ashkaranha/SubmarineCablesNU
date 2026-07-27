import type { ActorTier, MarkerFill, StatusStroke } from '../types/api'

export const MARKER_FILL_COLORS: Record<MarkerFill, string> = {
  red: '#c0392b',
  amber: '#d4a017',
  slate: '#6b7280',
}

export const MARKER_STROKE_RESOLVED = '#2d6a4f'
export const MARKER_STROKE_UNRESOLVED_LIGHT = '#111111'
export const MARKER_STROKE_UNRESOLVED_DARK = '#f5f5f5'

export function markerFillFor(actor_tier: ActorTier): MarkerFill {
  if (actor_tier === 'confirmed') {
    return 'red'
  }
  if (actor_tier === 'suspected') {
    return 'amber'
  }
  return 'slate'
}

export function statusStrokeFor(status?: string | null): StatusStroke {
  return (status || '').trim().toLowerCase().startsWith('resolved') ? 'resolved' : 'unresolved'
}

export function resolveMarkerFill(
  marker_fill: MarkerFill | undefined | null,
  actor_tier: ActorTier,
): MarkerFill {
  if (marker_fill === 'red' || marker_fill === 'amber' || marker_fill === 'slate') {
    return marker_fill
  }
  return markerFillFor(actor_tier)
}

export function resolveStatusStroke(
  status_stroke: StatusStroke | undefined | null,
  status?: string | null,
): StatusStroke {
  if (status_stroke === 'resolved' || status_stroke === 'unresolved') {
    return status_stroke
  }
  return statusStrokeFor(status)
}

export function strokeColorFor(
  status_stroke: StatusStroke,
  theme: 'light' | 'dark',
): string {
  if (status_stroke === 'resolved') {
    return MARKER_STROKE_RESOLVED
  }
  return theme === 'dark' ? MARKER_STROKE_UNRESOLVED_DARK : MARKER_STROKE_UNRESOLVED_LIGHT
}
