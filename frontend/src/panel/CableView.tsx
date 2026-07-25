import type { CableDetail, IncidentSummary } from '../types/api'

interface CableViewProps {
  cable: CableDetail
  onSelectIncident: (incident: IncidentSummary) => void
}

export function CableView({ cable, onSelectIncident }: CableViewProps) {
  const fields = [
    ['Owners', cable.owners],
    ['Region', cable.region],
    ['Status', cable.status],
    ['Length', cable.length_display],
  ]

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

      <div>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
          Incidents on this cable
        </h3>
        <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
          {cable.incidents.map((incident) => (
            <button
              key={incident.id}
              type="button"
              onClick={() => onSelectIncident(incident)}
              className="flex w-full items-start justify-between gap-3 border border-[var(--border)] bg-[var(--bg)] px-3 py-3 text-left hover:border-[var(--text)]"
            >
              <div>
                <p className="text-sm font-medium">{incident.original_cable_name}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{incident.date}</p>
              </div>
              <span className="text-xs text-[var(--muted)]">{incident.status || '—'}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
