/* eslint-disable react-refresh/only-export-components -- provider shares hooks with dashboard */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useUser } from '@clerk/clerk-react'
import { useQuery } from 'convex/react'
import { useAdminAccess } from '@/hooks/useAdminAccess'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useToast } from '@/components/shared/Toast'
import LoadingScreen from '@/components/shared/LoadingScreen'

const VIEW_AS_UNAVAILABLE_MESSAGE = 'That user is no longer available'

type ViewAsContextValue = {
  /** Convex user id to scope read queries, or null when viewing own data */
  viewAsUserId: Id<'users'> | null
  viewAsName:   string | null
  /** Server-confirmed admin (users.getMyAccess); false while loading. */
  isAdmin: boolean
  isViewingOther: boolean
  setViewAs:    (id: Id<'users'>, name: string) => void
  clearViewAs:  () => void
  /** Pass into Convex query args (omit when not impersonating) */
  viewAsUserIdForQuery: Id<'users'> | undefined
  /** True while a view-as target restored from sessionStorage is being validated. */
  isResolvingViewAs: boolean
  /** Drop back to own data after the target became invalid (deleted / forbidden) + toast. */
  handleViewAsInvalid: () => void
}

const ViewAsContext = createContext<ViewAsContextValue | null>(null)

function readStoredViewAsId(storageKey: string): string | null {
  try {
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const id = (parsed as { viewAsUserId?: unknown }).viewAsUserId
      if (typeof id === 'string' && id.length > 0) return id
    }
  } catch {
    /* ignore corrupt storage */
  }
  return null
}

export function ViewAsProvider({ children }: { children: ReactNode }) {
  const { user, isLoaded } = useUser()
  const { showToast } = useToast()
  const [viewAsUserId, setViewAsUserId] = useState<Id<'users'> | null>(null)
  const [viewAsName, setViewAsName] = useState<string | null>(null)
  /** Restored id awaiting server validation (never used for data queries). */
  const [pendingId, setPendingId] = useState<string | null>(null)
  /** Storage key whose saved view-as has already been read. */
  const [restoredKey, setRestoredKey] = useState<string | null>(null)
  /** Guards against handling the same validation result / invalidation twice. */
  const handledPendingRef = useRef<string | null>(null)
  const invalidatedIdRef = useRef<Id<'users'> | null>(null)

  const storageKey = user?.id ? `roznaama-admin-view-as-${user.id}` : null

  const { isAdmin, loading: accessLoading } = useAdminAccess()

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

  // Restore a saved view-as target into the *pending* state (validated below).
  useEffect(() => {
    if (!isLoaded) return

    const run = () => {
      // Wait for the server's answer: never drop a saved target on a guess.
      if (user && accessLoading) return
      if (!user || !isAdmin) {
        setViewAsUserId(null)
        setViewAsName(null)
        setPendingId(null)
        setRestoredKey(storageKey)
        if (storageKey) {
          try {
            sessionStorage.removeItem(storageKey)
          } catch {
            /* ignore */
          }
        }
        return
      }

      if (!storageKey || restoredKey === storageKey) return

      // New Clerk user (or first load): never carry a previous user's target over.
      setViewAsUserId(null)
      setViewAsName(null)
      setPendingId(readStoredViewAsId(storageKey))
      setRestoredKey(storageKey)
    }

    queueMicrotask(run)
  }, [isLoaded, user, isAdmin, accessLoading, storageKey, restoredKey])

  const validation = useQuery(
    api.users.validateViewAsTarget,
    isAdmin && pendingId ? { userId: pendingId } : 'skip',
  )

  useEffect(() => {
    if (!pendingId || validation === undefined) return
    if (handledPendingRef.current === pendingId) return
    handledPendingRef.current = pendingId

    const pending = pendingId
    queueMicrotask(() => {
      if (validation === null) {
        persist(null, null)
        setViewAsUserId(null)
        setViewAsName(null)
        showToast(VIEW_AS_UNAVAILABLE_MESSAGE, 'error')
      } else {
        // Commit with the fresh server-side name (it may have changed).
        setViewAsUserId(validation._id)
        setViewAsName(validation.name)
        persist(validation._id, validation.name)
      }
      setPendingId((current) => (current === pending ? null : current))
      handledPendingRef.current = null
    })
  }, [pendingId, validation, persist, showToast])

  const setViewAs = useCallback(
    (id: Id<'users'>, name: string) => {
      setPendingId(null)
      setViewAsUserId(id)
      setViewAsName(name)
      persist(id, name)
      invalidatedIdRef.current = null
    },
    [persist],
  )

  const clearViewAs = useCallback(() => {
    setPendingId(null)
    setViewAsUserId(null)
    setViewAsName(null)
    persist(null, null)
  }, [persist])

  const handleViewAsInvalid = useCallback(() => {
    // Several boundaries may report the same invalid target in one commit — toast once.
    if (viewAsUserId !== null && invalidatedIdRef.current === viewAsUserId) return
    invalidatedIdRef.current = viewAsUserId
    clearViewAs()
    showToast(VIEW_AS_UNAVAILABLE_MESSAGE, 'error')
  }, [viewAsUserId, clearViewAs, showToast])

  const isViewingOther = viewAsUserId !== null

  const viewAsUserIdForQuery = viewAsUserId ?? undefined

  // A saved target exists but admin access is not confirmed yet: hold the
  // data views back too (no flash of the admin's own numbers).
  const awaitingAccess =
    accessLoading && storageKey !== null && restoredKey !== storageKey && readStoredViewAsId(storageKey) !== null
  const isResolvingViewAs =
    isLoaded && storageKey !== null &&
    (awaitingAccess || (isAdmin && (restoredKey !== storageKey || pendingId !== null)))

  const value = useMemo(
    (): ViewAsContextValue => ({
      viewAsUserId,
      viewAsName,
      isAdmin,
      isViewingOther,
      setViewAs,
      clearViewAs,
      viewAsUserIdForQuery,
      isResolvingViewAs,
      handleViewAsInvalid,
    }),
    [
      viewAsUserId,
      viewAsName,
      isAdmin,
      isViewingOther,
      setViewAs,
      clearViewAs,
      viewAsUserIdForQuery,
      isResolvingViewAs,
      handleViewAsInvalid,
    ],
  )

  return (
    <ViewAsContext.Provider value={value}>
      {/* Don't mount data consumers until a restored target is validated, so an
          admin never sees a flash of their own data (or a stale target's). */}
      {isResolvingViewAs ? <LoadingScreen message="Restoring your view…" /> : children}
    </ViewAsContext.Provider>
  )
}

export function useViewAs(): ViewAsContextValue {
  const ctx = useContext(ViewAsContext)
  if (!ctx) {
    throw new Error('useViewAs must be used within ViewAsProvider')
  }
  return ctx
}

const noop = () => {}

/**
 * Scope every data hook / component below to `userId` (read-only), without
 * touching the app-wide view-as state: the admin dashboard renders the normal
 * PeriodSummary / charts / day lists for a selected user this way. Writes stay
 * disabled (isViewingOther), snapshots are neither read nor written and the
 * outbox overlay is off. `setViewAs` / `clearViewAs` still reach the real
 * provider, so "View as this user" enters the normal impersonation mode.
 */
export function ViewAsOverride({
  userId,
  name,
  onInvalid,
  children,
}: {
  userId: Id<'users'>
  name: string | null
  /** The user became unavailable (deleted / FORBIDDEN) while shown. */
  onInvalid: () => void
  children: ReactNode
}) {
  const parent = useContext(ViewAsContext)
  const value = useMemo(
    (): ViewAsContextValue => ({
      viewAsUserId:         userId,
      viewAsName:           name,
      isAdmin:              parent?.isAdmin ?? false,
      isViewingOther:       true,
      setViewAs:            parent?.setViewAs ?? noop,
      clearViewAs:          parent?.clearViewAs ?? noop,
      viewAsUserIdForQuery: userId,
      isResolvingViewAs:    false,
      handleViewAsInvalid:  onInvalid,
    }),
    [userId, name, parent?.isAdmin, parent?.setViewAs, parent?.clearViewAs, onInvalid],
  )
  return <ViewAsContext.Provider value={value}>{children}</ViewAsContext.Provider>
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
