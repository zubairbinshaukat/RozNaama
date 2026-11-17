import { useEffect, useRef, type RefObject } from 'react'
import { animate, useReducedMotion, type MotionValue } from 'framer-motion'

/** Movement (px) before we decide whether a touch is a sheet drag, a scroll or a sideways swipe. */
const SLOP = 6
/** Release speed (px/ms) that counts as a flick-to-close. */
const FLICK_VELOCITY = 0.5
/** Fraction of the sheet's height that closes it on release. */
const DISMISS_FRACTION = 0.25
const MIN_DISMISS_PX = 60

/** Elements whose own touch behaviour must win (typing, selecting text in a field). */
const NO_DRAG = 'input, textarea, select, [contenteditable="true"], [data-sheet-no-drag]'

/** Upward drags resist (rubber band) instead of moving 1:1. */
function rubberBand(distance: number): number {
  return -Math.min(32, Math.sqrt(distance) * 3)
}

/** Nearest vertically scrollable ancestor of `node` inside `root` (or null). */
function scrollableAncestor(node: Element | null, root: HTMLElement): HTMLElement | null {
  let el: Element | null = node
  while (el && el !== root) {
    if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 1) {
      const overflowY = getComputedStyle(el).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') return el
    }
    el = el.parentElement
  }
  return null
}

type DragState = {
  startX: number
  startY: number
  mode: 'pending' | 'drag' | 'ignore'
  lastY: number
  lastT: number
  velocity: number
  height: number
}

/**
 * Native-feeling drag-to-dismiss for a bottom sheet: grab anywhere and pull
 * down. Only starts when the content under the finger is scrolled to the top
 * (otherwise the content scrolls first), ignores sideways swipes (calendar
 * months) and touches on form fields. Follows the finger 1:1, rubber-bands
 * upward, closes past 25% height or on a fast flick, else springs back.
 */
export function useSheetDrag(
  ref: RefObject<HTMLElement | null>,
  { enabled, y, onDismiss }: { enabled: boolean; y: MotionValue<number>; onDismiss: () => void },
): void {
  const reduceMotion = useReducedMotion() ?? false
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    let state: DragState | null = null
    let snapBackTimer: ReturnType<typeof setTimeout> | null = null

    const springBack = () => {
      if (reduceMotion) y.set(0)
      else animate(y, 0, { type: 'spring', stiffness: 520, damping: 42 })
    }

    const onStart = (e: TouchEvent) => {
      state = null
      if (e.touches.length !== 1) return
      const target = e.target instanceof Element ? e.target : null
      if (!target || target.closest(NO_DRAG)) return
      const scroller = scrollableAncestor(target, el)
      if (scroller && scroller.scrollTop > 0) return // let the content scroll back up first
      const t = e.touches[0]!
      state = {
        startX: t.clientX,
        startY: t.clientY,
        mode: 'pending',
        lastY: t.clientY,
        lastT: performance.now(),
        velocity: 0,
        height: el.getBoundingClientRect().height,
      }
    }

    const onMove = (e: TouchEvent) => {
      if (!state || state.mode === 'ignore') return
      const t = e.touches[0]
      if (!t) return
      const dx = t.clientX - state.startX
      const dy = t.clientY - state.startY
      if (state.mode === 'pending') {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return
        // Sideways (month swipe) or upward (scroll content) → not ours.
        if (Math.abs(dx) > Math.abs(dy) || dy < 0) {
          state.mode = 'ignore'
          return
        }
        state.mode = 'drag'
      }
      if (e.cancelable) e.preventDefault() // stop the page / content from scrolling
      const now = performance.now()
      const dt = now - state.lastT
      if (dt > 0) state.velocity = 0.8 * ((t.clientY - state.lastY) / dt) + 0.2 * state.velocity
      state.lastY = t.clientY
      state.lastT = now
      y.set(dy >= 0 ? dy : rubberBand(-dy))
    }

    const onEnd = () => {
      const s = state
      state = null
      if (!s || s.mode !== 'drag') return
      const offset = y.get()
      const threshold = Math.max(s.height * DISMISS_FRACTION, MIN_DISMISS_PX)
      const dismiss = offset > threshold || (s.velocity > FLICK_VELOCITY && offset > SLOP)
      if (!dismiss) {
        springBack()
        return
      }
      const finish = () => {
        onDismissRef.current()
        // If the owner kept the sheet open (e.g. saving), bring it back.
        snapBackTimer = setTimeout(springBack, 250)
      }
      if (reduceMotion) finish()
      else void animate(y, Math.max(s.height, offset) + 40, { duration: 0.16, ease: 'easeIn' }).then(finish)
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      if (snapBackTimer !== null) clearTimeout(snapBackTimer)
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [ref, enabled, y, reduceMotion])
}
