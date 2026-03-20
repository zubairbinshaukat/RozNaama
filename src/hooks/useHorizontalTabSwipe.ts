import { useEffect, useRef, type RefObject } from 'react'

const MIN_DX = 56
const MAX_VERTICAL_DOMINANCE = 88

/**
 * Horizontal swipe on `ref` (attach to scrollable tab panel wrapper).
 * Swipe left → next; swipe right → previous. Ignores obvious vertical scrolls.
 */
export function useHorizontalTabSwipe(
  ref: RefObject<HTMLElement | null>,
  {
    onSwipeNext,
    onSwipePrev,
    enabled,
  }: {
    onSwipeNext: () => void
    onSwipePrev: () => void
    enabled:       boolean
  },
): void {
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const nextRef = useRef(onSwipeNext)
  const prevRef = useRef(onSwipePrev)

  useEffect(() => {
    nextRef.current = onSwipeNext
    prevRef.current = onSwipePrev
  }, [onSwipeNext, onSwipePrev])

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      startRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }

    const onEnd = (e: TouchEvent) => {
      const start = startRef.current
      startRef.current = null
      if (!start || e.changedTouches.length !== 1) return
      const x = e.changedTouches[0].clientX
      const y = e.changedTouches[0].clientY
      const dx = x - start.x
      const dy = y - start.y
      const adx = Math.abs(dx)
      const ady = Math.abs(dy)
      if (adx < MIN_DX) return
      if (ady > MAX_VERTICAL_DOMINANCE && ady > adx) return
      if (adx <= ady) return
      if (dx < 0) nextRef.current()
      else prevRef.current()
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchend', onEnd)
    }
  }, [ref, enabled])
}
