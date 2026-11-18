import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CheckCircle2, Pointer } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOneTimeTip } from '@/hooks/useOneTimeTip'

/* ─── "something else is open" (sheets, dropdowns) ─── */

/**
 * Open sheets / dialogs (aria-modal) and open dropdowns (aria-expanded
 * without aria-controls: theme menu, pickers). Disclosure rows and tabs use
 * aria-controls, so they don't count.
 */
const OVERLAY_SELECTOR = '[aria-modal="true"]:not([data-coach-mark]), [aria-expanded="true"]:not([aria-controls])'

function subscribeOverlays(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-modal', 'aria-expanded'],
  })
  return () => observer.disconnect()
}
const subscribeNothing = () => () => {}
const overlayOpen = () => document.querySelector(OVERLAY_SELECTOR) !== null
const noOverlay = () => false

/* ─── geometry ─── */

/** Room between the spotlight and the card (the arrow sits in it). */
const GAP = 14
/** Minimum distance from the screen edges. */
const EDGE = 16
/** Spotlight padding around the target. */
const PAD = 6
/** Arrow never closer than this to the card's corners. */
const ARROW_INSET = 24

type Hole = { x: number; y: number; w: number; h: number; r: number }
type Layout = {
  hole: Hole
  vw: number
  vh: number
  top: number
  left: number
  arrowX: number
  placement: 'below' | 'above'
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max))
const n = (v: number) => Math.round(v * 10) / 10

function roundedRectPath({ x, y, w, h, r }: Hole): string {
  const rr = Math.min(r, w / 2, h / 2)
  return (
    `M${n(x + rr)} ${n(y)}H${n(x + w - rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x + w)} ${n(y + rr)}` +
    `V${n(y + h - rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x + w - rr)} ${n(y + h)}` +
    `H${n(x + rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x)} ${n(y + h - rr)}` +
    `V${n(y + rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x + rr)} ${n(y)}Z`
  )
}

function computeLayout(target: HTMLElement, card: HTMLElement, radius: number | undefined): Layout {
  const r = target.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.visualViewport?.height ?? window.innerHeight
  const usableW = document.documentElement.clientWidth || vw
  const hole: Hole = { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2, r: 0 }
  hole.r = radius ?? Math.min(hole.w, hole.h) / 2

  const cw = card.offsetWidth
  const ch = card.offsetHeight
  const below = hole.y + hole.h + GAP
  const above = hole.y - GAP - ch
  const placement = below + ch <= vh - EDGE || above < EDGE ? 'below' : 'above'
  // Prefer below-left: the card's right edge lines up with the spotlight's.
  const left = clamp(hole.x + hole.w - cw, EDGE, usableW - EDGE - cw)
  const arrowX = clamp(r.left + r.width / 2 - left, ARROW_INSET, cw - ARROW_INSET)
  return { hole, vw, vh, top: placement === 'below' ? below : above, left, arrowX, placement }
}

function resolveTarget(target: CoachMarkTarget): HTMLElement | null {
  return typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target.current
}

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/* ─── public API ─── */

export type CoachMarkTarget = RefObject<HTMLElement | null> | string
export type CoachMarkCloseReason = 'dismiss' | 'backdrop' | 'escape' | 'done' | 'interrupted'

export interface CoachMarkProps {
  /** Seen-flag key (see `useOneTimeTip`); null = never shown. */
  storageKey: string | null
  /** The page is ready for it (data rendered, right mode). */
  enabled?: boolean
  /** Something else is on screen (menu, sheet): wait; closes it if already open. */
  blocked?: boolean
  /** Element to spotlight: a ref or a CSS selector. */
  target: CoachMarkTarget
  title: ReactNode
  body: ReactNode
  /** Small picture above the title. */
  illustration?: ReactNode
  /** Primary button: moves focus to the target and highlights it. */
  primaryLabel?: string
  /** Shown in place of the primary button after it was pressed. */
  tryHint?: ReactNode
  dismissLabel?: string
  /** Shown when the real target is tapped while the tip is open; then it closes by itself. */
  success?: ReactNode
  successMs?: number
  /** Quiet time (page settled, nothing else open) before it appears. */
  delayMs?: number
  /** Spotlight corner radius (px); default = pill around the target. */
  spotlightRadius?: number
  onClose?: (reason: CoachMarkCloseReason) => void
}

type Phase = 'waiting' | 'open' | 'success' | 'closed'

/**
 * One-time spotlight tip: dims + blurs the page around a soft cut-out over
 * `target` (which stays tappable), pulses a ring on it and points a small card
 * at it. Shown at most once per `storageKey`, only while `enabled`, nothing
 * else is open and the page has been quiet for `delayMs`. Marked seen as soon
 * as it appears.
 */
export default function CoachMark({
  storageKey,
  enabled = true,
  blocked = false,
  target,
  title,
  body,
  illustration,
  primaryLabel,
  tryHint,
  dismissLabel = 'Got it',
  success,
  successMs = 1600,
  delayMs = 600,
  spotlightRadius,
  onClose,
}: CoachMarkProps) {
  const { shouldShow, markSeen } = useOneTimeTip(storageKey)
  const [phase, setPhase] = useState<Phase>('waiting')
  const [closeReason, setCloseReason] = useState<CoachMarkCloseReason | null>(null)
  const watching = phase !== 'closed' && (phase !== 'waiting' || shouldShow)
  const domBusy = useSyncExternalStore(
    watching ? subscribeOverlays : subscribeNothing,
    watching ? overlayOpen : noOverlay,
    noOverlay,
  )
  const busy = blocked || domBusy
  const showing = phase === 'open' || phase === 'success'

  // A sheet / menu opened over it: step aside for good (it was already seen).
  if (showing && busy) {
    setPhase('closed')
    setCloseReason('interrupted')
  }

  const close = useCallback((reason: CoachMarkCloseReason) => {
    setPhase('closed')
    setCloseReason(reason)
    if (reason !== 'interrupted') resolveTarget(target)?.focus({ preventScroll: true })
  }, [target])

  // waiting → open, after `delayMs` of quiet.
  useEffect(() => {
    if (phase !== 'waiting' || !shouldShow || !enabled || busy) return
    const timer = window.setTimeout(() => {
      const el = resolveTarget(target)
      if (!el?.isConnected) return
      const r = el.getBoundingClientRect()
      if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView?.({ block: 'center' })
      markSeen()
      setPhase('open')
    }, delayMs)
    return () => window.clearTimeout(timer)
  }, [phase, shouldShow, enabled, busy, delayMs, target, markSeen])

  // Success message, then close by itself.
  useEffect(() => {
    if (phase !== 'success') return
    const timer = window.setTimeout(() => close('done'), successMs)
    return () => window.clearTimeout(timer)
  }, [phase, successMs, close])

  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => {
    if (closeReason) onCloseRef.current?.(closeReason)
  }, [closeReason])

  const onTargetTap = useCallback(() => {
    if (success) setPhase((p) => (p === 'open' ? 'success' : p))
    else close('done')
  }, [success, close])

  return createPortal(
    <AnimatePresence>
      {showing && (
        <CoachMarkOverlay
          key="coach-mark"
          target={target}
          title={title}
          body={body}
          illustration={illustration}
          primaryLabel={primaryLabel}
          tryHint={tryHint}
          dismissLabel={dismissLabel}
          success={phase === 'success' ? success : null}
          spotlightRadius={spotlightRadius}
          onClose={close}
          onTargetTap={onTargetTap}
        />
      )}
    </AnimatePresence>,
    document.body,
  )
}

/* ─── the overlay (mounted only while shown) ─── */

interface OverlayProps {
  target: CoachMarkTarget
  title: ReactNode
  body: ReactNode
  illustration?: ReactNode
  primaryLabel?: string
  tryHint?: ReactNode
  dismissLabel: string
  success: ReactNode
  spotlightRadius?: number
  onClose: (reason: CoachMarkCloseReason) => void
  onTargetTap: () => void
}

function CoachMarkOverlay({
  target,
  title,
  body,
  illustration,
  primaryLabel,
  tryHint,
  dismissLabel,
  success,
  spotlightRadius,
  onClose,
  onTargetTap,
}: OverlayProps) {
  const titleId = useId()
  const bodyId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  const [trying, setTrying] = useState(false)
  const reduceMotion = useReducedMotion() === true
  const done = success != null && success !== false

  // Follow the target: resize, scroll, rotation, keyboard, its own size.
  useLayoutEffect(() => {
    const el = resolveTarget(target)
    const card = cardRef.current
    if (!el || !card) return
    let frame = 0
    const update = () => setLayout(computeLayout(el, card, spotlightRadius))
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('orientationchange', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    ro?.observe(el)
    ro?.observe(card)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('orientationchange', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
      ro?.disconnect()
    }
  }, [target, spotlightRadius])

  // Focus the card on open.
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true })
  }, [])

  // A tap on the real target (through the cut-out) completes the tip.
  const onTargetTapRef = useRef(onTargetTap)
  useEffect(() => { onTargetTapRef.current = onTargetTap }, [onTargetTap])
  useEffect(() => {
    const el = resolveTarget(target)
    if (!el) return
    const onClick = () => onTargetTapRef.current()
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  }, [target])

  // Escape closes; Tab cycles through the card's buttons and the target.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose('escape')
        return
      }
      if (e.key !== 'Tab') return
      const card = cardRef.current
      if (!card) return
      const items = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE))
      const el = resolveTarget(target)
      if (el) items.push(el)
      if (items.length === 0) return
      const i = items.indexOf(document.activeElement as HTMLElement)
      e.preventDefault()
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === -1 || i === items.length - 1 ? 0 : i + 1)
      items[next]!.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, target])

  const tryIt = () => {
    setTrying(true)
    resolveTarget(target)?.focus({ preventScroll: true })
  }

  const hole = layout?.hole
  const scrimClip = layout && hole
    ? `path(evenodd, "M0 0H${n(layout.vw)}V${n(Math.max(layout.vh, window.innerHeight))}H0Z ${roundedRectPath(hole)}")`
    : undefined
  const slide = reduceMotion ? 0 : layout?.placement === 'above' ? 6 : -6

  return (
    <motion.div
      className="fixed inset-0 z-[600]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0.12 : 0.22, ease: 'easeOut' }}
      style={{ pointerEvents: 'none' }}
    >
      {/* Dim + blur everywhere except the cut-out (clip-path also lets taps through it). */}
      <div
        data-testid="coach-mark-backdrop"
        aria-hidden
        onClick={() => onClose('backdrop')}
        className="absolute inset-0 bg-black/45 dark:bg-black/60 backdrop-blur-[3px]"
        style={{ clipPath: scrimClip, pointerEvents: 'auto', touchAction: 'none' }}
      />

      {/* Ring + soft pulse around the target (taps pass through). */}
      {hole && (
        <div
          aria-hidden
          className="absolute pointer-events-none"
          style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h, borderRadius: hole.r }}
        >
          {!reduceMotion && (
            <span
              className={cn(
                'absolute inset-0 border-2 border-primary animate-coach-halo',
                trying && 'animate-coach-halo-fast',
              )}
              style={{ borderRadius: hole.r }}
            />
          )}
          <span
            className={cn(
              'absolute inset-0 transition-shadow duration-200',
              trying ? 'coach-ring-strong' : 'coach-ring',
            )}
            style={{ borderRadius: hole.r }}
          />
        </div>
      )}

      {/* Card */}
      <motion.div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-coach-mark=""
        tabIndex={-1}
        initial={{ opacity: 0, y: slide, scale: reduceMotion ? 1 : 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: slide / 2, scale: reduceMotion ? 1 : 0.98 }}
        transition={reduceMotion ? { duration: 0.12 } : { type: 'spring', damping: 26, stiffness: 340 }}
        className={cn(
          'absolute w-[min(20rem,calc(100vw-2rem))] outline-none',
          'rounded-3xl bg-popover text-popover-foreground border border-border/70 shadow-sheet',
        )}
        style={{
          pointerEvents: 'auto',
          left: layout?.left ?? EDGE,
          top: layout?.top ?? 0,
          visibility: layout ? 'visible' : 'hidden',
          transformOrigin: layout ? `${layout.arrowX}px ${layout.placement === 'below' ? '0%' : '100%'}` : undefined,
        }}
      >
        {/* Arrow */}
        {layout && (
          <span
            aria-hidden
            className={cn(
              'absolute w-3.5 h-3.5 rotate-45 bg-popover border-border/70',
              layout.placement === 'below' ? '-top-[7.5px] border-l border-t' : '-bottom-[7.5px] border-r border-b',
            )}
            style={{ left: layout.arrowX - 7 }}
          />
        )}

        <div className="relative p-4 pt-4.5 flex flex-col gap-3">
          {done ? (
            <motion.div
              role="status"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="flex items-center gap-3 py-1"
            >
              <span className="w-11 h-11 rounded-2xl bg-success/15 text-success flex items-center justify-center shrink-0" aria-hidden>
                <CheckCircle2 size={24} />
              </span>
              <p className="text-[15px] font-semibold text-foreground leading-snug">{success}</p>
              {/* Keep the dialog named while the success line shows. */}
              <span id={titleId} className="sr-only">{title}</span>
              <span id={bodyId} className="sr-only">{body}</span>
            </motion.div>
          ) : (
            <>
              {illustration}
              <div className="flex flex-col gap-1">
                <h2 id={titleId} className="text-[17px] font-bold text-foreground tracking-tight leading-snug">
                  {title}
                </h2>
                <p id={bodyId} className="text-[15px] text-muted-foreground leading-relaxed">
                  {body}
                </p>
              </div>
              <div className="flex items-center justify-end gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => onClose('dismiss')}
                  className="min-h-11 px-4 rounded-2xl text-[15px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted active:scale-[0.97] transition-all"
                >
                  {dismissLabel}
                </button>
                {primaryLabel && !trying && (
                  <button
                    type="button"
                    onClick={tryIt}
                    className="min-h-11 px-5 rounded-2xl text-[15px] font-bold bg-gradient-brand text-brand-foreground shadow-glow-sm hover:brightness-105 active:scale-[0.97] transition-all"
                  >
                    {primaryLabel}
                  </button>
                )}
                {trying && tryHint && (
                  <p role="status" className="min-h-11 flex items-center gap-1.5 px-2 text-[15px] font-semibold text-primary">
                    <Pointer size={18} aria-hidden className={cn(!reduceMotion && 'animate-coach-nudge')} />
                    {tryHint}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
