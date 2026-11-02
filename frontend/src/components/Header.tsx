import { useUiStore } from '../store/uiStore'

export function Header() {
  const toggleTheme = useUiStore((state) => state.toggleTheme)
  const theme = useUiStore((state) => state.theme)
  const resultCount = useUiStore((state) => state.resultCount)
  const cableResultCount = useUiStore((state) => state.cableResultCount)
  const listMode = useUiStore((state) => state.listMode)
  const query = useUiStore((state) => state.query)
  const isCables = listMode === 'cables'
  const shownCount = isCables ? cableResultCount : resultCount
  const shownLabel = isCables ? 'cable' : 'shown'

  const filterBits: string[] = []
  if (query.regions.length) {
    filterBits.push(`${query.regions.length} region${query.regions.length === 1 ? '' : 's'}`)
  }
  if (!isCables && query.actorTiers.length) {
    filterBits.push(query.actorTiers.join('/'))
  }
  if (!isCables && query.investigationStatuses.length) {
    filterBits.push(query.investigationStatuses.join('/'))
  }
  if (!isCables && query.q.trim()) {
    filterBits.push(`“${query.q.trim()}”`)
  }

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between p-4 pl-[356px]">
      <div className="pointer-events-auto">
        <h1 className="text-sm font-semibold tracking-wide text-[var(--accent)]">CableIncidentsDB</h1>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          {shownCount} {isCables ? `${shownLabel}${shownCount === 1 ? '' : 's'} shown` : shownLabel}
          {filterBits.length > 0 ? ` · ${filterBits.join(' · ')}` : ''}
        </p>
      </div>
      <button
        type="button"
        onClick={toggleTheme}
        className="pointer-events-auto border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] shadow-sm outline-none focus-visible:border-[var(--accent)]"
        aria-label="Toggle color theme"
      >
        {theme === 'light' ? '☾' : '☀'}
      </button>
    </header>
  )
}
