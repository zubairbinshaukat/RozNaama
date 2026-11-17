import { createContext, useContext } from 'react'
import type { AdminCardId } from '@/lib/admin'

export type CardPrefs = {
  isHidden: (id: AdminCardId) => boolean
  toggle:   (id: AdminCardId) => void
  showAll:  () => void
  hiddenCount: number
}

/** Admin card show/hide preferences (provided by pages/Admin.tsx). Default: everything shown. */
export const CardPrefsContext = createContext<CardPrefs>({
  isHidden: () => false,
  toggle: () => {},
  showAll: () => {},
  hiddenCount: 0,
})

export function useCardPrefs(): CardPrefs {
  return useContext(CardPrefsContext)
}
