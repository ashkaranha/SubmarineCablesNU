import { useState, type FormEvent } from 'react'
import { fetchCable, fetchIncident, fetchSemanticSearch } from '../api/client'
import { useUiStore } from '../store/uiStore'
import type { CableSearchResult, IncidentSearchResult } from '../types/api'

type SearchStatus = 'idle' | 'loading' | 'error' | 'done'

function scorePercent(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * 100)
}

export function SemanticSearchPanel() {
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [incidents, setIncidents] = useState<IncidentSearchResult[]>([])
  const [cables, setCables] = useState<CableSearchResult[]>([])

  const runSearch = (event: FormEvent) => {
    event.preventDefault()
    const query = draft.trim()
    if (!query) {
      return
    }
    setStatus('loading')
    setErrorMessage(null)
    fetchSemanticSearch(query, 'all', 8)
      .then((result) => {
        setIncidents(result.incidents)
        setCables(result.cables)
        setStatus('done')
      })
      .catch((error: unknown) => {
        setIncidents([])
        setCables([])
        setStatus('error')
        setErrorMessage(error instanceof Error ? error.message : 'Search failed')
      })
  }

  const handleSelectIncident = async (result: IncidentSearchResult) => {
    const detail = await fetchIncident(String(result.id))
    if (detail.latitude != null && detail.longitude != null) {
      useUiStore.getState().requestFlyTo(detail.latitude, detail.longitude)
    }
    useUiStore.getState().openIncidentPanel(detail)
  }

  const handleSelectCable = async (result: CableSearchResult) => {
    const detail = await fetchCable(result.name)
    useUiStore.getState().openCablePanel(result.name, detail)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[var(--border)] px-4 pb-3 pt-3">
        <p className="text-xs text-[var(--muted)]">
          Search by meaning instead of exact keywords, e.g. "anchor dragged near a strait".
        </p>
        <form onSubmit={runSearch} className="mt-2 flex gap-2">
          <input
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Describe what you're looking for…"
            className="w-full border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--text)]"
          />
          <button
            type="submit"
            disabled={status === 'loading' || !draft.trim()}
            className="shrink-0 border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--text)] hover:border-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status === 'loading' ? 'Searching…' : 'Search'}
          </button>
        </form>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {status === 'idle' && (
          <p className="px-4 py-8 text-sm text-[var(--muted)]">
            Type a query above and press Search.
          </p>
        )}

        {status === 'error' && (
          <div className="px-4 py-6 text-sm text-[var(--muted)]">
            <p className="text-[var(--text)]">Semantic search isn't available right now.</p>
            <p className="mt-2 text-xs">{errorMessage}</p>
            <p className="mt-2 text-xs">
              This usually means the vector database hasn't been set up yet — see the README's
              "Optional: semantic search" section.
            </p>
          </div>
        )}

        {status === 'done' && incidents.length === 0 && cables.length === 0 && (
          <p className="px-4 py-8 text-sm text-[var(--muted)]">No matches found.</p>
        )}

        {incidents.length > 0 && (
          <div>
            <p className="px-4 pt-3 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
              Incidents
            </p>
            <ul className="divide-y divide-[var(--border)]">
              {incidents.map((incident) => (
                <li key={incident.id}>
                  <button
                    type="button"
                    onClick={() => void handleSelectIncident(incident)}
                    className="w-full px-4 py-3 text-left transition-colors hover:bg-[var(--bg)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-snug">
                        {incident.original_cable_name || incident.canonical_cable_name}
                      </p>
                      <span className="shrink-0 text-[10px] text-[var(--muted)]">
                        {scorePercent(incident.score)}% match
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {incident.date}
                      {incident.cause ? (
                        <>
                          <span className="mx-1">·</span>
                          {incident.cause}
                        </>
                      ) : null}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {cables.length > 0 && (
          <div>
            <p className="px-4 pt-3 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
              Cables
            </p>
            <ul className="divide-y divide-[var(--border)]">
              {cables.map((cable) => (
                <li key={cable.name}>
                  <button
                    type="button"
                    onClick={() => void handleSelectCable(cable)}
                    className="w-full px-4 py-3 text-left transition-colors hover:bg-[var(--bg)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-snug">{cable.name}</p>
                      <span className="shrink-0 text-[10px] text-[var(--muted)]">
                        {scorePercent(cable.score)}% match
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-1 text-xs text-[var(--muted)]">
                      {cable.owners || cable.region || '—'}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
