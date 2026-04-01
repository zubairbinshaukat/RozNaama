/* eslint-disable react-refresh/only-export-components -- provider shares hooks with dashboard */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useUser } from '@clerk/clerk-react'
import type { Id } from '../../convex/_generated/dataModel'

type ViewAsContextValue = {
  /** Convex user id to scope read queries, or null when viewing own data */
  viewAsUserId: Id<'users'> | null
  viewAsName:   string | null
  isClerkAdmin: boolean
  isViewingOther: boolean
  setViewAs:    (id: Id<'users'>, name: string) => void
  clearViewAs:  () => void
  /** Pass into Convex query args (omit when not impersonating) */
  viewAsUserIdForQuery: Id<'users'> | undefined
}

const ViewAsContext = createContext<ViewAsContextValue | null>(null)

function parseAdminRole(publicMetadata: unknown): boolean {
  if (!publicMetadata || typeof publicMetadata !== 'object' || Array.isArray(publicMetadata)) {
    return false
  }
  const role = (publicMetadata as { role?: unknown }).role
  return role === 'Admin'
}

export function ViewAsProvider({ children }: { children: ReactNode }) {
  const { user, isLoaded } = useUser()
  const [viewAsUserId, setViewAsUserId] = useState<Id<'users'> | null>(null)
  const [viewAsName, setViewAsName] = useState<string | null>(null)

  const storageKey = user?.id ? `roznaama-admin-view-as-${user.id}` : null

  const isClerkAdmin = useMemo(
    () => (user ? parseAdminRole(user.publicMetadata) : false),
    [user],
  )

  useEffect(() => {
    if (!isLoaded) return

    const run = () => {
      if (!user || !isClerkAdmin) {
        setViewAsUserId(null)
        setViewAsName(null)
        if (storageKey) {
          try {
            sessionStorage.removeItem(storageKey)
          } catch {
            /* ignore */
          }
        }
        return
      }

      if (!storageKey) return

      try {
        const raw = sessionStorage.getItem(storageKey)
        if (!raw) return
        const parsed = JSON.parse(raw) as { viewAsUserId?: string; viewAsName?: string }
        if (typeof parsed.viewAsUserId === 'string' && typeof parsed.viewAsName === 'string') {
          setViewAsUserId(parsed.viewAsUserId as Id<'users'>)
          setViewAsName(parsed.viewAsName)
        }
      } catch {
        /* ignore corrupt storage */
      }
    }

    queueMicrotask(run)
  }, [isLoaded, user, isClerkAdmin, storageKey])

  const persist = useCallback(
    (id: Id<'users'> | null, name: string | null) => {
      if (!storageKey) return
      try {
        if (id && name) {
          sessionStorage.setItem(storageKey, JSON.stringify({ viewAsUserId: id, viewAsName: name }))
        } else {
          sessionStorage.removeItem(storageKey)
        }
      } catch {
        /* ignore quota / private mode */
      }
    },
    [storageKey],
  )

  const setViewAs = useCallback(
    (id: Id<'users'>, name: string) => {
      setViewAsUserId(id)
      setViewAsName(name)
      persist(id, name)
    },
    [persist],
  )

  const clearViewAs = useCallback(() => {
    setViewAsUserId(null)
    setViewAsName(null)
    persist(null, null)
  }, [persist])

  const isViewingOther = viewAsUserId !== null

  const viewAsUserIdForQuery = viewAsUserId ?? undefined

  const value = useMemo(
    (): ViewAsContextValue => ({
      viewAsUserId,
      viewAsName,
      isClerkAdmin,
      isViewingOther,
      setViewAs,
      clearViewAs,
      viewAsUserIdForQuery,
    }),
    [
      viewAsUserId,
      viewAsName,
      isClerkAdmin,
      isViewingOther,
      setViewAs,
      clearViewAs,
      viewAsUserIdForQuery,
    ],
  )

  return <ViewAsContext.Provider value={value}>{children}</ViewAsContext.Provider>
}

export function useViewAs(): ViewAsContextValue {
  const ctx = useContext(ViewAsContext)
  if (!ctx) {
    throw new Error('useViewAs must be used within ViewAsProvider')
  }
  return ctx
}

/** For hooks: returns undefined when not viewing as another user (own data). */
export function useViewAsUserIdForQuery(): Id<'users'> | undefined {
  const ctx = useContext(ViewAsContext)
  return ctx?.viewAsUserIdForQuery
}

/** True when admin is viewing another user’s data (safe outside provider → false). */
export function useIsViewingOtherSafe(): boolean {
  const ctx = useContext(ViewAsContext)
  return ctx?.isViewingOther ?? false
}
