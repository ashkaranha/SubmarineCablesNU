import type { IncidentSummary } from '../types/api'
import { StatusBadge } from './StatusBadge'

function displayValue(value?: string | null) {
  return value?.trim() ? value : '—'
}

function linkLabel(url: string, fallback: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return host || fallback
  } catch {
    return fallback
  }
}

interface IncidentViewProps {
  incident: IncidentSummary
}

export function IncidentView({ incident }: IncidentViewProps) {
  const fields = [
    ['Date', incident.date],
    ['Cable', incident.canonical_cable_name],
    ['Cause', incident.cause],
    ['Specific location', incident.specific_location],
    ['Suspected actor', incident.suspected_actor],
    ['Nation state suspected', incident.nation_state_suspected],
    ['Outage impact', incident.outage_impact],
    ['Dollar cost', incident.dollar_cost],
    ['Duration', incident.duration_of_outage],
    ['Source', incident.source],
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{incident.original_cable_name}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{incident.canonical_cable_name}</p>
        </div>
        <StatusBadge label={incident.status || 'Unknown'} color={incident.badge_color} />
      </div>

      <dl className="grid gap-4 sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</dt>
            <dd className="mt-1 text-sm leading-relaxed">{displayValue(value)}</dd>
          </div>
        ))}
      </dl>

      {incident.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {incident.links.map((link, index) => (
            <a
              key={link}
              href={link}
              target="_blank"
              rel="noreferrer"
              className="border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg)]"
            >
              {linkLabel(link, `Source ${index + 1}`)}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
