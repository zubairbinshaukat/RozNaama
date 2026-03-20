import { useState, useEffect, useCallback } from 'react'
import { THEMES, type Theme, type ThemePreference } from '@/lib/constants'

const STORAGE_KEY = 'roznaama-theme'

function isValidPreference(s: string | null): s is ThemePreference {
  if (s === 'random') return true
  return s !== null && (THEMES as readonly string[]).includes(s)
}

function getStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'light'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && isValidPreference(stored)) return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function pickRandomTheme(): Theme {
  return THEMES[Math.floor(Math.random() * THEMES.length)]!
}

function resolveToTheme(preference: ThemePreference): Theme {
  if (preference === 'random') return pickRandomTheme()
  return preference
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
    root.classList.add('dark')
    root.setAttribute('data-theme', theme)
  }
}

/** Single boot snapshot so random resolves once per page load and matches DOM + React */
const boot: { preference: ThemePreference; theme: Theme } =
  typeof window !== 'undefined'
    ? (() => {
        const preference = getStoredPreference()
        const theme = resolveToTheme(preference)
        applyTheme(theme)
        return { preference, theme }
      })()
    : { preference: 'light', theme: 'light' }

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(() => boot.preference)
  const [theme, setThemeState] = useState<Theme>(() => boot.theme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, preference)
  }, [preference])

  const setTheme = useCallback((next: ThemePreference) => {
    setPreference(next)
    setThemeState(next === 'random' ? pickRandomTheme() : next)
  }, [])

  const cycleTheme = useCallback(() => {
    setThemeState((current) => {
      const idx = THEMES.indexOf(current)
      const next = THEMES[(idx + 1) % THEMES.length]!
      setPreference(next)
      return next
    })
  }, [])

  return { theme, preference, setTheme, cycleTheme, themes: THEMES }
}
