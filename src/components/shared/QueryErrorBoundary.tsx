import { Component, useCallback, type ErrorInfo, type ReactNode } from 'react'
import { useConvex, type ConvexReactClient } from 'convex/react'
import { AlertCircle, RotateCw, X } from 'lucide-react'
import { getErrorMessage, isViewAsInvalidError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { subscribeToTransitions } from './convexTransitions'

const DEFAULT_FALLBACK_MESSAGE = 'Something went wrong loading this section'

/** Max wait for the Convex client to drop a cached query error before remounting. */
const RETRY_FLUSH_TIMEOUT_MS = 2000
/** Wait used when the client's transition hook is unavailable. */
const RETRY_BLIND_DELAY_MS = 1000

type QueryErrorBoundaryProps = {
  children: ReactNode
  /** True while an admin is viewing another user's data. */
  isViewingOther?: boolean
  /**
   * Called when a query throws FORBIDDEN / USER_NOT_FOUND while viewing another
   * user — the view-as target is gone, so the caller should drop back to own data.
   */
  onViewAsInvalid?: () => void
  /** Fallback text when the error carries no server message. */
  fallbackMessage?: string
  /** Boundary resets when any of these change (e.g. the viewed user id). */
  resetKeys?: readonly unknown[]
  /** Adds a Close button to the fallback card (e.g. for a modal that failed). */
  onDismiss?: () => void
  className?: string
}

type TransitionWatchMode = 'none' | 'watching' | 'blind'

type InnerProps = QueryErrorBoundaryProps & {
  hasClient: boolean
  subscribeTransitions: (onTransition: () => void) => (() => void) | null
}

type QueryErrorBoundaryState = {
  error: unknown
  hasError: boolean
  /** Error was a view-as invalidation; waiting for the caller to clear view-as. */
  viewAsInvalid: boolean
  /** Retry pressed; children stay unmounted until the cached error is dropped. */
  retrying: boolean
}

const INITIAL_STATE: QueryErrorBoundaryState = {
  error: null,
  hasError: false,
  viewAsInvalid: false,
  retrying: false,
}

function keysChanged(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  if (a === b) return false
  if (!a || !b || a.length !== b.length) return true
  return a.some((v, i) => !Object.is(v, b[i]))
}

class QueryErrorBoundaryInner extends Component<InnerProps, QueryErrorBoundaryState> {
  state: QueryErrorBoundaryState = INITIAL_STATE

  private stopWatching: (() => void) | null = null
  private watchMode: TransitionWatchMode = 'none'
  /** A client transition happened since the error (cached results were rebuilt). */
  private cacheFlushed = false
  /**
   * Transitions only count once the failed children's effect cleanups have
   * unsubscribed (they run after componentDidCatch). Armed one macrotask later
   * so a transition in that gap can't mark a still-live cache as flushed (review N2).
   */
  private armed = false
  private armTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  static getDerivedStateFromError(error: unknown): Partial<QueryErrorBoundaryState> {
    return { error, hasError: true, retrying: false }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.watchTransitions()
    const { isViewingOther, onViewAsInvalid } = this.props
    if (isViewingOther && onViewAsInvalid && isViewAsInvalidError(error)) {
      this.setState({ viewAsInvalid: true })
      onViewAsInvalid()
      return
    }
    console.error('QueryErrorBoundary caught', error, info.componentStack)
  }

  componentDidUpdate(prevProps: InnerProps): void {
    if (!this.state.hasError) return
    const viewAsCleared = this.state.viewAsInvalid && prevProps.isViewingOther && !this.props.isViewingOther
    if (viewAsCleared || keysChanged(prevProps.resetKeys, this.props.resetKeys)) {
      // Different query args → different cache entries; remount right away.
      this.reset()
    }
  }

  componentWillUnmount(): void {
    this.cleanup()
  }

  /** Start noting client transitions (the failed children just unsubscribed). */
  private watchTransitions(): void {
    this.cleanup()
    this.cacheFlushed = false
    if (!this.props.hasClient) {
      this.watchMode = 'none'
      return
    }
    this.armed = false
    this.armTimer = setTimeout(() => {
      this.armed = true
      this.armTimer = null
    }, 0)
    this.stopWatching = this.props.subscribeTransitions(() => {
      if (!this.armed) return
      this.cacheFlushed = true
      if (this.state.retrying) this.scheduleRemount(0)
    })
    this.watchMode = this.stopWatching ? 'watching' : 'blind'
  }

  private cleanup(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.retryTimer = null
    if (this.armTimer !== null) clearTimeout(this.armTimer)
    this.armTimer = null
    this.stopWatching?.()
    this.stopWatching = null
  }

  private scheduleRemount(delayMs: number): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(this.reset, delayMs)
  }

  reset = (): void => {
    this.cleanup()
    this.setState(INITIAL_STATE)
  }

  /**
   * Retry = real refetch: keep children unmounted until the client has dropped
   * the cached error (next transition, or a timeout), then remount them so
   * `useQuery` subscribes afresh.
   */
  retry = (): void => {
    if (this.state.retrying) return
    this.setState({ retrying: true })
    const delay =
      this.watchMode === 'none' || (this.watchMode === 'watching' && this.cacheFlushed)
        ? 0
        : this.watchMode === 'blind'
          ? RETRY_BLIND_DELAY_MS
          : RETRY_FLUSH_TIMEOUT_MS
    this.scheduleRemount(delay)
  }

  render(): ReactNode {
    const { hasError, error, viewAsInvalid, retrying } = this.state
    if (!hasError) return this.props.children

    if (
      retrying ||
      viewAsInvalid ||
      (this.props.isViewingOther && this.props.onViewAsInvalid && isViewAsInvalidError(error))
    ) {
      // Briefly blank while refetching / while the caller switches back to own data.
      return <div className={cn('min-h-24 rounded-2xl bg-muted/20 skeleton', this.props.className)} aria-busy="true" />
    }

    const { onDismiss } = this.props
    return (
      <div
        role="alert"
        className={cn(
          'flex flex-col items-center justify-center gap-3 text-center rounded-3xl border border-border/70 bg-card px-5 py-8',
          this.props.className,
        )}
      >
        <div className="w-14 h-14 rounded-2xl bg-negative/10 flex items-center justify-center" aria-hidden>
          <AlertCircle className="text-negative" size={24} />
        </div>
        <div className="flex flex-col gap-1 max-w-sm">
          <p className="text-base font-semibold text-foreground">
            {getErrorMessage(error, this.props.fallbackMessage ?? DEFAULT_FALLBACK_MESSAGE)}
          </p>
          <p className="text-sm text-muted-foreground">
            Your data is safe. Check your internet, then tap Retry.
          </p>
        </div>
        <div className="flex items-center gap-2.5 pt-1">
          <button
            type="button"
            onClick={this.retry}
            className="inline-flex items-center gap-2 min-h-11 px-5 rounded-2xl text-base font-semibold bg-gradient-brand text-brand-foreground active:scale-[0.97] transition-all"
          >
            <RotateCw size={18} />
            Retry
          </button>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex items-center gap-2 min-h-11 px-5 rounded-2xl text-base font-semibold bg-muted text-foreground hover:bg-muted/70 active:scale-[0.97] transition-all"
            >
              <X size={18} />
              Close
            </button>
          )}
        </div>
      </div>
    )
  }
}

/**
 * Catches render-time errors thrown by Convex `useQuery` inside a section and
 * shows a friendly retry card instead of blanking the whole page. Retry
 * refetches (see `convexTransitions.ts` for why a plain re-render would not).
 */
export default function QueryErrorBoundary(props: QueryErrorBoundaryProps) {
  // Undefined outside a ConvexProvider (e.g. unit tests) despite the type.
  const client = useConvex() as ConvexReactClient | undefined
  const subscribeTransitions = useCallback(
    (onTransition: () => void) => subscribeToTransitions(client, onTransition),
    [client],
  )
  return (
    <QueryErrorBoundaryInner
      {...props}
      hasClient={client !== undefined}
      subscribeTransitions={subscribeTransitions}
    />
  )
}
