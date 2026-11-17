import { useState, useEffect } from 'react'

/** `matchMedia` is missing in some environments (jsdom, very old WebViews). */
function getMatcher(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(query)
}

export function useMediaQueryMatch(query: string): boolean {
  const [matches, setMatches] = useState(() => getMatcher(query)?.matches ?? false)

  useEffect(() => {
    const mq = getMatcher(query)
    if (!mq) return
    const handler = () => setMatches(mq.matches)
    handler()
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [query])

  return matches
}
