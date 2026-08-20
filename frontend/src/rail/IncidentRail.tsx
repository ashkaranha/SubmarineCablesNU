import { useEffect, useState } from 'react'
import {
  fetchCable,
  fetchCables,
  fetchFilterMeta,
  fetchIncident,
  fetchIncidents,
  fetchMarkers,
  fetchSemanticSearch,
} from '../api/client'
import { FilterDropdown } from './FilterDropdown'
import { useUiStore } from '../store/uiStore'
import type {
  ActorTier,
  CableSummary,
  FilterMeta,
  IncidentListItem,
  IncidentMarker,
  IncidentQuery,
  StatusFilter,
} from '../types/api'

type ListMode = 'incidents' | 'cables'
type DropdownKey = 'region' | 'actorTier' | 'status' | 'suspectedCountry' | 'cableType'

const SEMANTIC_CANDIDATE_LIMIT = 50
const SEMANTIC_SEARCH_TIMEOUT_MS = 8000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Semantic search timed out')), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

// While browsing Cables, only Region and Cable type apply — Nation-state, Status, and
// Suspected country are incident-level facets that don't map onto a cable filter, and the
// search box searches cable documents instead of incident documents.
function effectiveIncidentQuery(query: IncidentQuery, listMode: ListMode): IncidentQuery {
  if (listMode === 'cables') {
    return {
      q: '',
      regions: query.regions,
      actorTiers: [],
      status: null,
      suspectedCountries: [],
      cableTypes: query.cableTypes,
    }
  }
  return query
}

const ACTOR_LABELS: Record<ActorTier, string> = {
  confirmed: 'Confirmed',
  suspected: 'Suspected',
  none: 'None',
}

const STATUS_LABELS: Record<StatusFilter, string> = {
  resolved: 'Resolved',
  unresolved: 'Unresolved',
}

function scorePercent(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * 100)
}

function ActorChip({ tier }: { tier: ActorTier }) {
  const styles: Record<ActorTier, string> = {
    confirmed: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200',
    suspected: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
    none: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  }
  return (
    <span
      className={`inline-flex px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${styles[tier]}`}
    >
      {ACTOR_LABELS[tier]}
    </span>
  )
}

function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="flex items-center gap-1 border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[11px] text-[var(--text)] hover:border-[var(--text)]"
    >
      {label}
      <span aria-hidden="true">×</span>
    </button>
  )
}

interface IncidentQueryResult {
  incidents: IncidentListItem[]
  markers: IncidentMarker[]
  scores: Map<string, number> | null
  semanticUnavailable: boolean
}

async function runIncidentQuery(query: IncidentQuery): Promise<IncidentQueryResult> {
  const trimmed = query.q.trim()

  if (!trimmed) {
    const incidents = await fetchIncidents(query)
    const markers = await fetchMarkers(query, incidents)
    return { incidents, markers, scores: null, semanticUnavailable: false }
  }

  const facetQuery = { ...query, q: '' }

  try {
    const [semantic, facetIncidents, facetMarkers] = await Promise.all([
      withTimeout(
        fetchSemanticSearch(trimmed, 'incidents', SEMANTIC_CANDIDATE_LIMIT),
        SEMANTIC_SEARCH_TIMEOUT_MS,
      ),
      fetchIncidents(facetQuery),
      fetchMarkers(facetQuery),
    ])

    const facetById = new Map(facetIncidents.map((incident) => [incident.id, incident]))
    const scores = new Map<string, number>()
    const incidents: IncidentListItem[] = []
    for (const result of semantic.incidents) {
      const id = String(result.id)
      const match = facetById.get(id)
      if (match) {
        incidents.push(match)
        scores.set(id, result.score)
      }
    }

    const keepIds = new Set(incidents.map((incident) => incident.id))
    const markers = facetMarkers.filter((marker) => keepIds.has(marker.id))

    return { incidents, markers, scores, semanticUnavailable: false }
  } catch (error) {
    console.error('Semantic search unavailable, falling back to keyword search', error)
    const incidents = await fetchIncidents(query)
    const markers = await fetchMarkers(query, incidents)
    return { incidents, markers, scores: null, semanticUnavailable: true }
  }
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
  const toggleSuspectedCountry = useUiStore((state) => state.toggleSuspectedCountry)
  const toggleCableType = useUiStore((state) => state.toggleCableType)
  const setFilteredResults = useUiStore((state) => state.setFilteredResults)
  const setQueryLoading = useUiStore((state) => state.setQueryLoading)
  const selectIncidentFromList = useUiStore((state) => state.selectIncidentFromList)
  const openCablePanel = useUiStore((state) => state.openCablePanel)
  const hideQuietCables = useUiStore((state) => state.hideQuietCables)
  const toggleHideQuietCables = useUiStore((state) => state.toggleHideQuietCables)
  const filteredMarkers = useUiStore((state) => state.filteredMarkers)
  const requestFitBounds = useUiStore((state) => state.requestFitBounds)

  const [meta, setMeta] = useState<FilterMeta | null>(null)
  const [searchDraft, setSearchDraft] = useState(query.q)
  const [listMode, setListMode] = useState<ListMode>('incidents')
  const [openDropdown, setOpenDropdown] = useState<DropdownKey | null>(null)
  const [allCables, setAllCables] = useState<CableSummary[]>([])
  const [cablesLoading, setCablesLoading] = useState(false)
  const [semanticScores, setSemanticScores] = useState<Map<string, number> | null>(null)
  const [semanticUnavailable, setSemanticUnavailable] = useState(false)
  const [cableScores, setCableScores] = useState<Map<string, number> | null>(null)
  const [cableSemanticUnavailable, setCableSemanticUnavailable] = useState(false)
  const [searchedCableNames, setSearchedCableNames] = useState<string[] | null>(null)

  useEffect(() => {
    void fetchFilterMeta().then(setMeta).catch(console.error)
  }, [])

  useEffect(() => {
    if (listMode !== 'cables' || allCables.length > 0) {
      return
    }
    setCablesLoading(true)
    void fetchCables()
      .then(setAllCables)
      .catch(console.error)
      .finally(() => setCablesLoading(false))
  }, [listMode, allCables.length])

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
    void runIncidentQuery(effectiveIncidentQuery(query, listMode))
      .then(({ incidents, markers, scores, semanticUnavailable: unavailable }) => {
        if (cancelled) {
          return
        }
        setSemanticScores(scores)
        setSemanticUnavailable(unavailable)
        setFilteredResults(incidents, markers)
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
  }, [query, listMode, setFilteredResults, setQueryLoading])

  // Cable-view text search runs against cable documents, not incident documents.
  useEffect(() => {
    if (listMode !== 'cables') {
      return
    }
    const trimmed = query.q.trim()
    if (!trimmed) {
      setSearchedCableNames(null)
      setCableScores(null)
      setCableSemanticUnavailable(false)
      return
    }

    let cancelled = false
    void withTimeout(fetchSemanticSearch(trimmed, 'cables', SEMANTIC_CANDIDATE_LIMIT), SEMANTIC_SEARCH_TIMEOUT_MS)
      .then((result) => {
        if (cancelled) {
          return
        }
        setCableScores(new Map(result.cables.map((cable) => [cable.name, cable.score])))
        setSearchedCableNames(result.cables.map((cable) => cable.name))
        setCableSemanticUnavailable(false)
      })
      .catch((error) => {
        console.error('Cable semantic search unavailable, falling back to keyword match', error)
        if (cancelled) {
          return
        }
        setCableScores(null)
        setSearchedCableNames(null)
        setCableSemanticUnavailable(true)
      })
    return () => {
      cancelled = true
    }
  }, [query.q, listMode])

  const handleSelect = async (incident: IncidentListItem) => {
    const detail = await fetchIncident(incident.id)
    selectIncidentFromList(incident, detail)
  }

  const handleSelectCable = async (name: string) => {
    const detail = await fetchCable(name)
    openCablePanel(name, detail)
  }

  const clearIncidentFilters = () => {
    setSearchDraft('')
    setQuery({
      q: '',
      regions: [],
      actorTiers: [],
      status: null,
      suspectedCountries: [],
      cableTypes: [],
    })
  }

  const clearCableFilters = () => {
    setSearchDraft('')
    setQuery({ q: '', regions: [], cableTypes: [] })
  }

  const isSearching = Boolean(searchDraft.trim())

  const hasActiveIncidentFilters =
    Boolean(query.q.trim()) ||
    query.regions.length > 0 ||
    query.actorTiers.length > 0 ||
    query.status != null ||
    query.suspectedCountries.length > 0 ||
    query.cableTypes.length > 0

  const hasActiveCableFacets = query.regions.length > 0 || query.cableTypes.length > 0

  const matchingCableNames = hasActiveCableFacets
    ? new Set(filteredIncidents.map((incident) => incident.canonical_cable_name))
    : null
  const facetFilteredCables = matchingCableNames
    ? allCables.filter((cable) => matchingCableNames.has(cable.name))
    : allCables

  let displayedCables: CableSummary[]
  if (isSearching && searchedCableNames) {
    const byName = new Map(facetFilteredCables.map((cable) => [cable.name, cable]))
    displayedCables = searchedCableNames
      .map((name) => byName.get(name))
      .filter((cable): cable is CableSummary => Boolean(cable))
  } else if (isSearching && cableSemanticUnavailable) {
    const needle = searchDraft.trim().toLowerCase()
    displayedCables = facetFilteredCables.filter(
      (cable) =>
        cable.name.toLowerCase().includes(needle) ||
        (cable.owners ?? '').toLowerCase().includes(needle),
    )
  } else {
    displayedCables = facetFilteredCables
  }

  const openDropdownHandler = (key: DropdownKey) => (open: boolean) =>
    setOpenDropdown(open ? key : null)

  return (
    <aside className="pointer-events-auto absolute bottom-0 left-0 top-0 z-20 flex w-[340px] flex-col border-r border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 pb-3 pt-14">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">{listMode === 'cables' ? 'Cables' : 'Incidents'}</h2>
          <span className="text-xs text-[var(--muted)]">
            {listMode === 'cables'
              ? cablesLoading
                ? 'Loading…'
                : `${displayedCables.length} cable${displayedCables.length === 1 ? '' : 's'}`
              : queryLoading
                ? 'Loading…'
                : `${resultCount} result${resultCount === 1 ? '' : 's'}`}
          </span>
        </div>

        <button
          type="button"
          onClick={() => requestFitBounds()}
          disabled={filteredMarkers.length === 0}
          className="mt-2 w-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] hover:border-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Fit to results
        </button>

        <div className="mt-3 flex border border-[var(--border)] text-xs">
          <button
            type="button"
            onClick={() => setListMode('incidents')}
            className={`flex-1 px-2 py-1.5 font-medium ${
              listMode === 'incidents'
                ? 'bg-[var(--text)] text-[var(--surface)]'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            Incidents
          </button>
          <button
            type="button"
            onClick={() => setListMode('cables')}
            className={`flex-1 px-2 py-1.5 font-medium ${
              listMode === 'cables'
                ? 'bg-[var(--text)] text-[var(--surface)]'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            Cables
          </button>
        </div>

        <input
          type="search"
          value={searchDraft}
          onChange={(event) => {
            const value = event.target.value
            setSearchDraft(value)
            if (!value.trim()) {
              setQuery({
                regions: [],
                actorTiers: [],
                status: null,
                suspectedCountries: [],
                cableTypes: [],
              })
            }
          }}
          placeholder={listMode === 'cables' ? 'Search or describe a cable…' : 'Search or describe an incident…'}
          className="mt-3 w-full border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--text)]"
        />
        {!isSearching ? (
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Matches by meaning, e.g. "anchor dragged near a strait" — not just exact words.
          </p>
        ) : listMode === 'cables' ? (
          cableSemanticUnavailable && (
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              Showing keyword matches only (semantic search is unavailable right now).
            </p>
          )
        ) : semanticUnavailable ? (
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Showing keyword matches only (semantic search is unavailable right now).
          </p>
        ) : null}

        {isSearching && listMode === 'cables' && (
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-[var(--text)]">
            <input
              type="checkbox"
              checked={hideQuietCables}
              onChange={() => toggleHideQuietCables()}
              className="mt-0.5"
            />
            <span>
              Hide cables with no incidents
              <span className="mt-0.5 block text-[var(--muted)]">Follows current filters</span>
            </span>
          </label>
        )}

        {isSearching && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <FilterDropdown
                label="Region"
                options={meta?.regions ?? []}
                selectedValues={query.regions}
                onToggle={toggleRegion}
                isOpen={openDropdown === 'region'}
                onOpenChange={openDropdownHandler('region')}
              />
              {listMode === 'incidents' && (
                <FilterDropdown
                  label="Nation-state"
                  options={meta?.actor_tiers ?? []}
                  selectedValues={query.actorTiers}
                  onToggle={(value) => toggleActorTier(value as ActorTier)}
                  isOpen={openDropdown === 'actorTier'}
                  onOpenChange={openDropdownHandler('actorTier')}
                  formatLabel={(value) => ACTOR_LABELS[value as ActorTier] ?? value}
                />
              )}
              {listMode === 'incidents' && (
                <FilterDropdown
                  label="Status"
                  options={meta?.statuses ?? []}
                  selectedValues={query.status ? [query.status] : []}
                  onToggle={(value) => setStatusFilter(value as StatusFilter)}
                  isOpen={openDropdown === 'status'}
                  onOpenChange={openDropdownHandler('status')}
                  formatLabel={(value) => STATUS_LABELS[value as StatusFilter] ?? value}
                />
              )}
              {listMode === 'incidents' && (
                <FilterDropdown
                  label="Suspected country"
                  options={meta?.suspected_countries ?? []}
                  selectedValues={query.suspectedCountries}
                  onToggle={toggleSuspectedCountry}
                  isOpen={openDropdown === 'suspectedCountry'}
                  onOpenChange={openDropdownHandler('suspectedCountry')}
                />
              )}
              <FilterDropdown
                label="Cable type"
                options={meta?.cable_types ?? []}
                selectedValues={query.cableTypes}
                onToggle={toggleCableType}
                isOpen={openDropdown === 'cableType'}
                onOpenChange={openDropdownHandler('cableType')}
              />
            </div>

            {listMode === 'incidents' && hasActiveIncidentFilters && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {query.regions.map((value) => (
                  <FilterPill key={`region-${value}`} label={value} onRemove={() => toggleRegion(value)} />
                ))}
                {query.actorTiers.map((value) => (
                  <FilterPill
                    key={`tier-${value}`}
                    label={ACTOR_LABELS[value]}
                    onRemove={() => toggleActorTier(value)}
                  />
                ))}
                {query.status && (
                  <FilterPill
                    label={STATUS_LABELS[query.status]}
                    onRemove={() => setStatusFilter(query.status)}
                  />
                )}
                {query.suspectedCountries.map((value) => (
                  <FilterPill
                    key={`country-${value}`}
                    label={value}
                    onRemove={() => toggleSuspectedCountry(value)}
                  />
                ))}
                {query.cableTypes.map((value) => (
                  <FilterPill key={`type-${value}`} label={value} onRemove={() => toggleCableType(value)} />
                ))}
                <button
                  type="button"
                  onClick={clearIncidentFilters}
                  className="text-xs text-[var(--muted)] underline-offset-2 hover:text-[var(--text)] hover:underline"
                >
                  Clear all
                </button>
              </div>
            )}

            {listMode === 'cables' && hasActiveCableFacets && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {query.regions.map((value) => (
                  <FilterPill key={`region-${value}`} label={value} onRemove={() => toggleRegion(value)} />
                ))}
                {query.cableTypes.map((value) => (
                  <FilterPill key={`type-${value}`} label={value} onRemove={() => toggleCableType(value)} />
                ))}
                <button
                  type="button"
                  onClick={clearCableFilters}
                  className="text-xs text-[var(--muted)] underline-offset-2 hover:text-[var(--text)] hover:underline"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {listMode === 'cables' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {displayedCables.length === 0 && !cablesLoading ? (
            <p className="px-4 py-8 text-sm text-[var(--muted)]">No cables match these filters.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {displayedCables.map((cable) => {
                const score = cableScores?.get(cable.name)
                return (
                  <li key={cable.name}>
                    <button
                      type="button"
                      onClick={() => void handleSelectCable(cable.name)}
                      className="w-full px-4 py-3 text-left transition-colors hover:bg-[var(--bg)]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium leading-snug">{cable.name}</p>
                        <span className="shrink-0 text-xs text-[var(--muted)]">
                          {cable.incident_count} incident{cable.incident_count === 1 ? '' : 's'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {cable.region || 'Unknown region'}
                        {cable.status && (
                          <>
                            <span className="mx-1">·</span>
                            {cable.status}
                          </>
                        )}
                        {score != null && (
                          <>
                            <span className="mx-1">·</span>
                            {scorePercent(score)}% match
                          </>
                        )}
                      </p>
                      {cable.owners && (
                        <p className="mt-1 line-clamp-1 text-xs text-[var(--muted)]">{cable.owners}</p>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filteredIncidents.length === 0 && !queryLoading ? (
            <p className="px-4 py-8 text-sm text-[var(--muted)]">
              No incidents match these filters.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {filteredIncidents.map((incident) => {
                const selected = selectedIncidentId === incident.id
                const score = semanticScores?.get(incident.id)
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
                        <p className="text-sm font-medium leading-snug">
                          {incident.original_cable_name}
                        </p>
                        <ActorChip tier={incident.actor_tier} />
                      </div>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {incident.date}
                        <span className="mx-1">·</span>
                        {incident.region}
                        {score != null && (
                          <>
                            <span className="mx-1">·</span>
                            {scorePercent(score)}% match
                          </>
                        )}
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
      )}
    </aside>
  )
}
