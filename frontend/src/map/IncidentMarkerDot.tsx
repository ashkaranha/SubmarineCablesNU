import type { ActorTier, MarkerFill, StatusStroke } from '../types/api'
import { useUiStore } from '../store/uiStore'
import {
  MARKER_FILL_COLORS,
  resolveMarkerFill,
  resolveStatusStroke,
  strokeColorFor,
} from './markerStyles'

interface IncidentMarkerDotProps {
  marker_fill?: MarkerFill | null
  status_stroke?: StatusStroke | null
  actor_tier?: ActorTier
  status?: string | null
  size?: 'sm' | 'md'
}

const SIZE_CLASSES = {
  sm: 'h-3 w-3',
  md: 'h-4 w-4',
} as const

export function IncidentMarkerDot({
  marker_fill,
  status_stroke,
  actor_tier = 'none',
  status,
  size = 'sm',
}: IncidentMarkerDotProps) {
  const theme = useUiStore((state) => state.theme)
  const fill = resolveMarkerFill(marker_fill, actor_tier)
  const stroke =
    status_stroke !== undefined || status != null
      ? strokeColorFor(resolveStatusStroke(status_stroke, status), theme)
      : null

  return (
    <span
      className={`inline-block shrink-0 rounded-full ${SIZE_CLASSES[size]}`}
      style={{
        backgroundColor: MARKER_FILL_COLORS[fill],
        boxSizing: 'border-box',
        border: stroke ? `2.5px solid ${stroke}` : undefined,
      }}
      aria-hidden
    />
  )
}
