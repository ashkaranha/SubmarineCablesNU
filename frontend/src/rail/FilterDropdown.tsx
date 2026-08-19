import { useEffect, useRef } from 'react'
import type { FilterCount } from '../types/api'

interface FilterDropdownProps {
  label: string
  options: FilterCount[]
  selectedValues: string[]
  onToggle: (value: string) => void
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  formatLabel?: (value: string) => string
}

export function FilterDropdown({
  label,
  options,
  selectedValues,
  onToggle,
  isOpen,
  onOpenChange,
  formatLabel,
}: FilterDropdownProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onOpenChange(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onOpenChange])

  const activeCount = selectedValues.length

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!isOpen)}
        className={`flex items-center gap-1.5 border px-2.5 py-1.5 text-xs ${
          activeCount > 0
            ? 'border-[var(--text)] bg-[var(--text)] text-[var(--surface)]'
            : 'border-[var(--border)] text-[var(--text)] hover:border-[var(--text)]'
        }`}
      >
        {label}
        {activeCount > 0 && <span className="opacity-80">({activeCount})</span>}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={`shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <path
            d="M1 3 L5 7 L9 3"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-64 w-56 overflow-y-auto border border-[var(--border)] bg-[var(--surface)] shadow-lg">
          {options.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[var(--muted)]">No options</p>
          ) : (
            options.map((item) => {
              const checked = selectedValues.includes(item.value)
              return (
                <label
                  key={item.value}
                  className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-[var(--bg)]"
                >
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={checked} onChange={() => onToggle(item.value)} />
                    {formatLabel ? formatLabel(item.value) : item.value}
                  </span>
                  <span className="shrink-0 text-[var(--muted)]">{item.count}</span>
                </label>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
