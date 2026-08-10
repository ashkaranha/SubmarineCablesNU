import { useEffect, useState } from 'react'
import { fetchCable, fetchIncidentSources } from '../api/client'
import { useUiStore } from '../store/uiStore'
import type { CableDetail, IncidentSummary, LLMSource } from '../types/api'
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

type SourceSearchStatus = 'idle' | 'loading' | 'error' | 'done'

export function IncidentView({ incident }: IncidentViewProps) {
  const openCablePanel = useUiStore((state) => state.openCablePanel)
  const [relatedCable, setRelatedCable] = useState<CableDetail | null>(null)
  const [sourceSearchStatus, setSourceSearchStatus] = useState<SourceSearchStatus>('idle')
  const [llmSources, setLlmSources] = useState<LLMSource[]>([])

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

  useEffect(() => {
    setSourceSearchStatus('idle')
    setLlmSources([])
  }, [incident.id])

  function findMoreSources() {
    setSourceSearchStatus('loading')
    fetchIncidentSources(incident.id)
      .then((result) => {
        setLlmSources(result.llm_sources)
        setSourceSearchStatus('done')
      })
      .catch(() => {
        setSourceSearchStatus('error')
      })
  }

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
        <div>
          <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Sources in our data</p>
          <div className="mt-2 flex flex-wrap gap-2">
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
        </div>
      )}

      <div className="border-t border-[var(--border)] pt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
            Additional sources (found by AI)
          </p>
          <button
            type="button"
            onClick={findMoreSources}
            disabled={sourceSearchStatus === 'loading'}
            className="border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--bg)] disabled:cursor-default disabled:opacity-60"
          >
            {sourceSearchStatus === 'loading' ? 'Searching…' : 'Find more sources'}
          </button>
        </div>

        {sourceSearchStatus === 'error' && (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Couldn't search for additional sources right now.
          </p>
        )}

        {sourceSearchStatus === 'done' && llmSources.length === 0 && (
          <p className="mt-2 text-xs text-[var(--muted)]">No additional sources found.</p>
        )}

        {llmSources.length > 0 && (
          <div className="mt-2 space-y-2">
            <p className="text-[10px] text-[var(--muted)]">
              Found via AI web search — not part of the original dataset and not manually
              verified. Confirm before citing.
            </p>
            {llmSources.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="block border border-dashed border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg)]"
              >
                <span className="flex items-center gap-2">
                  <span className="shrink-0 border border-[var(--border)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--muted)]">
                    AI found
                  </span>
                  <span className="font-medium">
                    {source.title?.trim() || linkLabel(source.url, source.url)}
                  </span>
                </span>
                {source.snippet ? (
                  <span className="mt-1 block text-xs text-[var(--muted)]">{source.snippet}</span>
                ) : null}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
