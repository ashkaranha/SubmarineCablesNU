import { IncidentMarkerDot } from '../map/IncidentMarkerDot'
import type { CableDetail, IncidentSummary } from '../types/api'

interface CableViewProps {
  cable: CableDetail
  onSelectIncident: (incident: IncidentSummary) => void
}

function isResolved(status?: string | null) {
  return (status || '').trim().toLowerCase().startsWith('resolved')
}

function riskSummary(incidents: IncidentSummary[]) {
  let confirmed = 0
  let suspected = 0
  let none = 0
  let unresolved = 0
  for (const incident of incidents) {
    if (incident.actor_tier === 'confirmed') {
      confirmed += 1
    } else if (incident.actor_tier === 'suspected') {
      suspected += 1
    } else {
      none += 1
    }
    if (!isResolved(incident.status)) {
      unresolved += 1
    }
  }
  const latestDate = incidents[0]?.date || '—'
  return { confirmed, suspected, none, unresolved, latestDate, total: incidents.length }
}

export function CableView({ cable, onSelectIncident }: CableViewProps) {
  const fields = [
    ['Owners', cable.owners],
    ['Region', cable.region],
    ['Status', cable.status],
    ['Length', cable.length_display],
  ]
  const risk = riskSummary(cable.incidents)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{cable.name}</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {cable.incident_count} incident{cable.incident_count === 1 ? '' : 's'}
        </p>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</dt>
            <dd className="mt-1 text-sm leading-relaxed">{value?.trim() ? value : '—'}</dd>
          </div>
        ))}
      </dl>

      <div className="border-y border-[var(--border)] py-4">
        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
          Risk summary
        </p>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-[var(--muted)]">Total</p>
            <p className="mt-0.5 font-medium">{risk.total}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted)]">Confirmed / Suspected / None</p>
            <p className="mt-0.5 font-medium">
              {risk.confirmed} / {risk.suspected} / {risk.none}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted)]">Unresolved</p>
            <p className="mt-0.5 font-medium">{risk.unresolved}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted)]">Most recent</p>
            <p className="mt-0.5 font-medium">{risk.latestDate}</p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
          Incidents on this cable
        </h3>
        <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
          {cable.incidents.length === 0 && (
            <p className="text-sm text-[var(--muted)]">No recorded incidents on this cable.</p>
          )}
          {cable.incidents.map((incident) => (
            <button
              key={incident.id}
              type="button"
              onClick={() => onSelectIncident(incident)}
              className="flex w-full items-center gap-3 border border-[var(--border)] bg-[var(--bg)] px-3 py-3 text-left hover:border-[var(--text)]"
            >
              <IncidentMarkerDot
                marker_fill={incident.marker_fill}
                status_stroke={incident.status_stroke}
                actor_tier={incident.actor_tier}
                status={incident.status}
                size="md"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{incident.original_cable_name}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{incident.date}</p>
              </div>
              <span className="shrink-0 text-xs text-[var(--muted)]">{incident.status || '—'}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
