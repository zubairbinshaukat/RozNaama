import { useState, useEffect, useCallback } from 'react'
import { THEMES, type Theme } from '@/lib/constants'

const STORAGE_KEY = 'roznaama-theme'

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
  if (stored && (THEMES as readonly string[]).includes(stored)) return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement
  root.removeAttribute('data-theme')
  root.classList.remove('dark')

  if (theme === 'light') {
    // No class or attribute needed — :root defaults are light
  } else if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    // midnight, ocean, forest, rose, sunset → dark + data-theme
    root.classList.add('dark')
    root.setAttribute('data-theme', theme)
  }
}

// Apply immediately on module load to prevent flash
if (typeof window !== 'undefined') {
  applyTheme(getInitialTheme())
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
  }, [])

  const cycleTheme = useCallback(() => {
    setThemeState((current) => {
      const idx  = THEMES.indexOf(current)
      const next = THEMES[(idx + 1) % THEMES.length]
      return next
    })
  }, [])

  return { theme, setTheme, cycleTheme, themes: THEMES }
}
