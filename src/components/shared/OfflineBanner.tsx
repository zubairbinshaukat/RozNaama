import { useEffect, useState } from 'react'
import { AlertCircle, CloudOff, Loader2, RotateCw } from 'lucide-react'
import { useNetworkStatus } from '@/lib/network'
import type { PauseState } from '@/lib/offline/outboxEngine'

/** Entries must wait this long online before "Syncing N…" shows (normal saves finish sooner). */
export const SYNCING_SHOW_DELAY_MS = 1500

interface OfflineBannerProps {
  /** Entries on this phone not yet on the server (waiting + needing a fix). */
  pendingCount?: number
  /** Entries the outbox will still send by itself (status pending). */
  syncingCount?: number
  /** Syncing stopped until something changes (signed out / blocked / app too old). */
  paused?: PauseState | null
  /** "Try again" for a paused queue. */
  onRetry?: () => void
}

function offlineBannerText(pendingCount: number): string {
  const base = "You're offline — new sales and expenses will be saved on this phone."
  return pendingCount > 0 ? `${base} (${pendingCount} waiting)` : base
}

function entries(n: number): string {
  return `${n} ${n === 1 ? 'entry' : 'entries'}`
}

/** Short, actionable text for a paused queue. */
function pausedText(paused: PauseState, pendingCount: number): { text: string; action: 'retry' | 'reload' } {
  switch (paused.reason) {
    case 'unauthorized':
      return { text: `Sign in again to sync ${entries(pendingCount)}.`, action: 'retry' }
    case 'forbidden':
      return { text: `${paused.message || 'This account cannot sync right now.'} (${pendingCount} waiting)`, action: 'retry' }
    case 'missingBackend':
      return { text: `Update needed to sync ${entries(pendingCount)}.`, action: 'reload' }
  }
}

/** True once `on` has stayed true for `delayMs` (false again at once). */
function useDelayedFlag(on: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false)
  if (!on && shown) setShown(false)
  useEffect(() => {
    if (!on) return
    const timer = setTimeout(() => setShown(true), delayMs)
    return () => clearTimeout(timer)
  }, [on, delayMs])
  return on && shown
}

const wrapClass =
  'fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[10000] flex justify-center px-4 animate-fade-in'

/**
 * Floating pill for sync state:
 * - offline (debounced 2s): new entries are kept on this phone (+ N waiting);
 * - online but syncing is paused: what to do, with one button;
 * - online, entries still sending after 1.5s: a subtle "Syncing N…".
 */
export default function OfflineBanner({ pendingCount = 0, syncingCount = 0, paused = null, onRetry }: OfflineBannerProps) {
  const { isOffline } = useNetworkStatus()
  const showSyncing = useDelayedFlag(!isOffline && !paused && syncingCount > 0, SYNCING_SHOW_DELAY_MS)

  if (isOffline) {
    return (
      <div role="status" aria-live="polite" className={`pointer-events-none ${wrapClass}`}>
        <div className="flex max-w-md items-center gap-2 rounded-2xl bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg">
          <CloudOff size={16} className="shrink-0" aria-hidden />
          <span>{offlineBannerText(pendingCount)}</span>
        </div>
      </div>
    )
  }

  if (paused && pendingCount > 0) {
    const { text, action } = pausedText(paused, pendingCount)
    return (
      <div role="status" aria-live="polite" className={`pointer-events-none ${wrapClass}`}>
        <div className="pointer-events-auto flex max-w-md items-center gap-2 rounded-2xl border border-warning/40 bg-popover pl-4 pr-1.5 py-1.5 text-sm font-medium text-foreground shadow-lg">
          <AlertCircle size={16} className="shrink-0 text-warning" aria-hidden />
          <span className="py-1">{text}</span>
          <button
            type="button"
            onClick={action === 'reload' ? () => window.location.reload() : onRetry}
            className="shrink-0 inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl text-primary font-bold hover:bg-primary/10 active:scale-[0.97] transition-all"
          >
            <RotateCw size={16} aria-hidden />
            {action === 'reload' ? 'Reload' : 'Try again'}
          </button>
        </div>
      </div>
    )
  }

  if (showSyncing) {
    return (
      <div role="status" aria-live="polite" className={`pointer-events-none ${wrapClass}`}>
        <div className="flex items-center gap-2 rounded-full border border-border/70 bg-popover/95 px-3.5 py-1.5 text-[13px] font-semibold text-muted-foreground shadow-card">
          <Loader2 size={14} className="shrink-0 animate-[spin_1s_linear_infinite]" aria-hidden />
          <span>Syncing {syncingCount}…</span>
        </div>
      </div>
    )
  }

  return null
}
