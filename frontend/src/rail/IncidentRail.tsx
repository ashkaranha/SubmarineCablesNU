import { useEffect, useState, type ReactNode } from 'react'
import { fetchFilterMeta, fetchIncident, fetchIncidents, fetchMarkers } from '../api/client'
import { useUiStore } from '../store/uiStore'
import type { ActorTier, FilterMeta, IncidentListItem, StatusFilter } from '../types/api'

const ACTOR_LABELS: Record<ActorTier, string> = {
  confirmed: 'Confirmed',
  suspected: 'Suspected',
  none: 'None',
}

const STATUS_LABELS: Record<StatusFilter, string> = {
  resolved: 'Resolved',
  unresolved: 'Unresolved',
}

function ActorChip({ tier }: { tier: ActorTier }) {
  const styles: Record<ActorTier, string> = {
    confirmed: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200',
    suspected: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
    none: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  }
  return (
    <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${styles[tier]}`}>
      {ACTOR_LABELS[tier]}
    </span>
  )
}

export function IncidentRail() {
  const query = useUiStore((state) => state.query)
  const filteredIncidents = useUiStore((state) => state.filteredIncidents)
  const resultCount = useUiStore((state) => state.resultCount)
  const queryLoading = useUiStore((state) => state.queryLoading)
  const selectedIncidentId = useUiStore((state) => state.selectedIncidentId)
  const setQuery = useUiStore((state) => state.setQuery)
  const toggleRegion = useUiStore((state) => state.toggleRegion)
  const toggleActorTier = useUiStore((state) => state.toggleActorTier)
  const setStatusFilter = useUiStore((state) => state.setStatusFilter)
  const setFilteredResults = useUiStore((state) => state.setFilteredResults)
  const setQueryLoading = useUiStore((state) => state.setQueryLoading)
  const selectIncidentFromList = useUiStore((state) => state.selectIncidentFromList)

  const [meta, setMeta] = useState<FilterMeta | null>(null)
  const [searchDraft, setSearchDraft] = useState(query.q)

  useEffect(() => {
    void fetchFilterMeta().then(setMeta).catch(console.error)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchDraft !== query.q) {
        setQuery({ q: searchDraft })
      }
    }, 200)
    return () => window.clearTimeout(timer)
  }, [searchDraft, query.q, setQuery])

  useEffect(() => {
    let cancelled = false
    setQueryLoading(true)
    void Promise.all([fetchIncidents(query), fetchMarkers(query)])
      .then(([incidents, markers]) => {
        if (!cancelled) {
          setFilteredResults(incidents, markers)
        }
      })
      .catch((error) => {
        console.error(error)
        if (!cancelled) {
          setQueryLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [query, setFilteredResults, setQueryLoading])

  const handleSelect = async (incident: IncidentListItem) => {
    const detail = await fetchIncident(incident.id)
    selectIncidentFromList(incident, detail)
  }

  const clearFilters = () => {
    setSearchDraft('')
    setQuery({ q: '', regions: [], actorTiers: [], status: null })
  }

  const hasActiveFilters =
    Boolean(query.q.trim()) ||
    query.regions.length > 0 ||
    query.actorTiers.length > 0 ||
    query.status != null

  return (
    <aside className="pointer-events-auto absolute bottom-0 left-0 top-0 z-20 flex w-[340px] flex-col border-r border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 pb-3 pt-14">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Incidents</h2>
          <span className="text-xs text-[var(--muted)]">
            {queryLoading ? 'Loading…' : `${resultCount} result${resultCount === 1 ? '' : 's'}`}
          </span>
        </div>

        <input
          type="search"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          placeholder="Search cable, actor, cause…"
          className="mt-3 w-full border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--text)]"
        />

        <div className="mt-3 space-y-3">
          <FilterSection label="Region">
            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {(meta?.regions ?? []).map((item) => {
                const active = query.regions.includes(item.value)
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => toggleRegion(item.value)}
                    className={`border px-2 py-1 text-xs ${
                      active
                        ? 'border-[var(--text)] bg-[var(--text)] text-[var(--surface)]'
                        : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--text)] hover:text-[var(--text)]'
                    }`}
                  >
                    {item.value}
                    <span className="ml-1 opacity-70">{item.count}</span>
                  </button>
                )
              })}
            </div>
          </FilterSection>

          <FilterSection label="Nation-state">
            <div className="flex flex-wrap gap-1.5">
              {(['confirmed', 'suspected', 'none'] as ActorTier[]).map((tier) => {
                const active = query.actorTiers.includes(tier)
                const count = meta?.actor_tiers.find((item) => item.value === tier)?.count ?? 0
                return (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => toggleActorTier(tier)}
                    className={`border px-2 py-1 text-xs ${
                      active
                        ? 'border-[var(--text)] bg-[var(--text)] text-[var(--surface)]'
                        : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--text)] hover:text-[var(--text)]'
                    }`}
                  >
                    {ACTOR_LABELS[tier]}
                    <span className="ml-1 opacity-70">{count}</span>
                  </button>
                )
              })}
            </div>
          </FilterSection>

          <FilterSection label="Status">
            <div className="flex flex-wrap gap-1.5">
              {(['resolved', 'unresolved'] as StatusFilter[]).map((status) => {
                const active = query.status === status
                const count = meta?.statuses.find((item) => item.value === status)?.count ?? 0
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setStatusFilter(status)}
                    className={`border px-2 py-1 text-xs ${
                      active
                        ? 'border-[var(--text)] bg-[var(--text)] text-[var(--surface)]'
                        : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--text)] hover:text-[var(--text)]'
                    }`}
                  >
                    {STATUS_LABELS[status]}
                    <span className="ml-1 opacity-70">{count}</span>
                  </button>
                )
              })}
            </div>
          </FilterSection>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-[var(--muted)] underline-offset-2 hover:text-[var(--text)] hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filteredIncidents.length === 0 && !queryLoading ? (
          <p className="px-4 py-8 text-sm text-[var(--muted)]">No incidents match these filters.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {filteredIncidents.map((incident) => {
              const selected = selectedIncidentId === incident.id
              return (
                <li key={incident.id}>
                  <button
                    type="button"
                    onClick={() => void handleSelect(incident)}
                    className={`w-full px-4 py-3 text-left transition-colors ${
                      selected ? 'bg-[var(--bg)]' : 'hover:bg-[var(--bg)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-snug">{incident.original_cable_name}</p>
                      <ActorChip tier={incident.actor_tier} />
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {incident.date}
                      <span className="mx-1">·</span>
                      {incident.region}
                    </p>
                    {incident.nation_state_suspected && (
                      <p className="mt-1 line-clamp-1 text-xs text-[var(--muted)]">
                        {incident.nation_state_suspected}
                      </p>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}

function FilterSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">{label}</p>
      {children}
    </div>
  )
}
