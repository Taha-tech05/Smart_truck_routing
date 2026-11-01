import { Moon, Sun } from 'lucide-react'
import type { Theme } from '../hooks/useTheme'

interface Props {
  theme: Theme
  onToggle: () => void
  className?: string
}

export default function ThemeToggle({ theme, onToggle, className = '' }: Props) {
  const next = theme === 'light' ? 'dark' : 'light'
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={`inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-control border border-line bg-surface text-fg transition-colors hover:bg-surface-2 ${className}`}
    >
      {theme === 'light' ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
    </button>
  )
}
