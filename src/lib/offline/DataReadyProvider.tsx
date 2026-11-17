import type { ReactNode } from 'react'
import { DataReadyContext, type DataReadyMode } from './context'

/**
 * Wrap children rendered before auth is ready (ProtectedRoute snapshot mode)
 * with `mode="snapshot"`: data hooks then skip live queries and show the
 * IndexedDB snapshot. The default (no provider) is 'ready'.
 */
export default function DataReadyProvider({ mode, children }: { mode: DataReadyMode; children: ReactNode }) {
  return <DataReadyContext.Provider value={mode}>{children}</DataReadyContext.Provider>
}
