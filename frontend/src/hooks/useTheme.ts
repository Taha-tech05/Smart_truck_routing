import { useCallback, useState } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'theme'

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

function initialTheme(): Theme {
  return readStored() ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
}

/**
 * Theme state. The `data-theme` attribute on <html> is set synchronously (here and by the inline
 * script in index.html) so CSS variables are correct before any map style is (re)loaded.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => {
    const t = initialTheme()
    document.documentElement.dataset.theme = t
    return t
  })

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'light' ? 'dark' : 'light'
      document.documentElement.dataset.theme = next
      try {
        localStorage.setItem(KEY, next)
      } catch {
        /* storage unavailable: choice just is not persisted */
      }
      return next
    })
  }, [])

  return { theme, toggle }
}
