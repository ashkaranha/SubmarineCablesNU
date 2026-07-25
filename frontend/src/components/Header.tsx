import { useUiStore } from '../store/uiStore'

export function Header() {
  const toggleTheme = useUiStore((state) => state.toggleTheme)
  const theme = useUiStore((state) => state.theme)

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-4">
      <h1 className="pointer-events-auto text-sm font-semibold tracking-wide text-[var(--text)]">
        CableIncidentsDB
      </h1>
      <button
        type="button"
        onClick={toggleTheme}
        className="pointer-events-auto border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] shadow-sm"
        aria-label="Toggle color theme"
      >
        {theme === 'light' ? '☾' : '☀'}
      </button>
    </header>
  )
}
