import { IncidentMarkerDot } from './IncidentMarkerDot'

export function MapLegend() {
  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-20 w-[13.5rem] border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-[11px] text-[var(--text)]">
      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
        State involvement
      </p>
      <ul className="mt-2 space-y-1.5">
        <li className="flex items-center gap-2">
          <IncidentMarkerDot marker_fill="red" />
          Confirmed
        </li>
        <li className="flex items-center gap-2">
          <IncidentMarkerDot marker_fill="amber" />
          Suspected
        </li>
        <li className="flex items-center gap-2">
          <IncidentMarkerDot marker_fill="slate" />
          None
        </li>
      </ul>

      <p className="mt-3 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
        Status
      </p>
      <ul className="mt-2 space-y-1.5">
        <li className="flex items-center gap-2">
          <IncidentMarkerDot marker_fill="slate" status_stroke="resolved" />
          Resolved
        </li>
        <li className="flex items-center gap-2">
          <IncidentMarkerDot marker_fill="slate" status_stroke="unresolved" />
          Unresolved
        </li>
      </ul>

      <p className="mt-3 text-[10px] leading-snug text-[var(--muted)]">
        Overlapping incidents are fanned out
      </p>
    </div>
  )
}
