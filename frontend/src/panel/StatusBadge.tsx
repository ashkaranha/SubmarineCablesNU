import type { BadgeColor } from '../types/api'

const styles: Record<BadgeColor, string> = {
  green: 'bg-emerald-100 text-emerald-900',
  yellow: 'bg-amber-100 text-amber-900',
  red: 'bg-red-100 text-red-900',
}

const darkStyles: Record<BadgeColor, string> = {
  green: 'dark:bg-emerald-900/40 dark:text-emerald-200',
  yellow: 'dark:bg-amber-900/40 dark:text-amber-200',
  red: 'dark:bg-red-900/40 dark:text-red-200',
}

interface StatusBadgeProps {
  label: string
  color: BadgeColor
}

export function StatusBadge({ label, color }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 text-xs font-medium ${styles[color]} ${darkStyles[color]}`}
    >
      {label}
    </span>
  )
}
