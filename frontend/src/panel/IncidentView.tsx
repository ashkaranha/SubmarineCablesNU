import { useEffect, useState } from 'react'
import { fetchCable } from '../api/client'
import { useUiStore } from '../store/uiStore'
import type { CableDetail, IncidentSummary } from '../types/api'
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
  const openCablePanel = useUiStore((state) => state.openCablePanel)
  const [relatedCable, setRelatedCable] = useState<CableDetail | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchCable(incident.canonical_cable_name)
      .then((cable) => {
        if (!cancelled) {
          setRelatedCable(cable)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRelatedCable(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [incident.canonical_cable_name])

  const fields = [
    ['Date', incident.date],
    ['Region', incident.region],
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
          <p className="mt-1 text-sm text-[var(--muted)]">{incident.date}</p>
          {incident.coordinate_source === 'cable_route' ? (
            <p className="mt-2 text-xs text-[var(--muted)]">
              Location approximated from cable route
            </p>
          ) : null}
        </div>
        <StatusBadge label={incident.status || 'Unknown'} color={incident.badge_color} />
      </div>

      <button
        type="button"
        onClick={() => {
          if (relatedCable) {
            openCablePanel(relatedCable.name, relatedCable)
          }
        }}
        disabled={!relatedCable}
        className="flex w-full items-start justify-between gap-3 border border-[var(--border)] bg-[var(--bg)] px-3 py-3 text-left hover:border-[var(--text)] disabled:cursor-default disabled:opacity-70"
      >
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
            Related cable
          </p>
          <p className="mt-1 text-sm font-medium">{incident.canonical_cable_name}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {relatedCable?.owners?.trim() || 'Owners unavailable'}
            {relatedCable?.length_display ? ` · ${relatedCable.length_display}` : ''}
          </p>
        </div>
        <span className="text-xs text-[var(--muted)]">{relatedCable ? 'View' : '—'}</span>
      </button>

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
