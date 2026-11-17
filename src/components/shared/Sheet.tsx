import { useCallback, useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { motion, useMotionValue, useTransform } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMediaQueryMatch } from '@/hooks/useMediaQueryMatch'
import { useVisualViewportBottomInset } from '@/hooks/useVisualViewportInset'
import { useSheetDrag } from './useSheetDrag'

/* ─── module-level coordination between stacked sheets ─── */

/** Open sheets, bottom → top. Only the top one reacts to Escape / Tab. */
const openStack: string[] = []
let scrollLocks = 0
let savedBodyOverflow = ''

function lockBodyScroll(): void {
  if (scrollLocks++ === 0) {
    savedBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
}

function unlockBodyScroll(): void {
  scrollLocks = Math.max(0, scrollLocks - 1)
  if (scrollLocks === 0) document.body.style.overflow = savedBodyOverflow
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const SIZE_CLASS = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
} as const

export interface SheetProps {
  onClose: () => void
  /** False while saving: Esc, backdrop and swipe-down do nothing. */
  dismissible?: boolean
  /** id of the element that names the sheet (usually the SheetHeader title). */
  labelledBy: string
  describedBy?: string
  role?: 'dialog' | 'alertdialog'
  /** z-index; stacked sheets (pickers, confirms) use a higher layer. */
  layer?: number
  size?: keyof typeof SIZE_CLASS
  /** Element focused on open (defaults to the panel itself). */
  initialFocusRef?: RefObject<HTMLElement | null>
  className?: string
  children: ReactNode
}

/**
 * Bottom sheet on phones, centred dialog from `sm` up. Portals to <body> so
 * fixed positioning and swipe gestures never leak into the page behind it.
 * Traps focus, restores it on close, locks page scroll and lifts above the
 * on-screen keyboard.
 */
export default function Sheet({
  onClose,
  dismissible = true,
  labelledBy,
  describedBy,
  role = 'dialog',
  layer = 500,
  size = 'md',
  initialFocusRef,
  className,
  children,
}: SheetProps) {
  const id = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const dismissibleRef = useRef(dismissible)
  const isDesktop = useMediaQueryMatch('(min-width: 640px)')
  const keyboardInset = useVisualViewportBottomInset()

  useEffect(() => {
    onCloseRef.current = onClose
    dismissibleRef.current = dismissible
  }, [onClose, dismissible])

  // Register in the stack, lock scroll, move focus in (and back out on close).
  useEffect(() => {
    openStack.push(id)
    lockBodyScroll()
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const target = initialFocusRef?.current ?? panelRef.current
    target?.focus({ preventScroll: true })

    return () => {
      const idx = openStack.lastIndexOf(id)
      if (idx !== -1) openStack.splice(idx, 1)
      unlockBodyScroll()
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true })
    }
  }, [id, initialFocusRef])

  // Escape closes the top-most sheet; Tab cycles inside it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== id) return
      if (e.key === 'Escape') {
        // Inner widgets (e.g. an open picker) mark Escape as handled.
        if (e.defaultPrevented) return
        e.preventDefault()
        if (dismissibleRef.current) onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.getClientRects().length > 0 || el === document.activeElement,
      )
      if (items.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [id])

  const dragY = useMotionValue(0)
  const backdropOpacity = useTransform(dragY, [0, 480], [1, 0.25])
  const wrapperRef = useRef<HTMLDivElement>(null)
  const closeIfAllowed = useCallback(() => {
    if (dismissibleRef.current) onCloseRef.current()
  }, [])

  // Phones: grab anywhere on the sheet and pull down to close.
  useSheetDrag(wrapperRef, { enabled: !isDesktop && dismissible, y: dragY, onDismiss: closeIfAllowed })

  return createPortal(
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center sm:p-4"
      style={{ zIndex: layer, paddingBottom: keyboardInset }}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
        className="absolute inset-0"
        onClick={closeIfAllowed}
        aria-hidden
      >
        <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" style={{ opacity: backdropOpacity }} />
      </motion.div>

      {/* Drag layer (follows the finger) around the panel (enter animation) */}
      <motion.div ref={wrapperRef} style={{ y: dragY }} className={cn('relative w-full', SIZE_CLASS[size])}>
        <motion.div
          ref={panelRef}
          role={role}
          aria-modal="true"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          tabIndex={-1}
          initial={isDesktop ? { opacity: 0, scale: 0.96, y: 8 } : { y: '100%' }}
          animate={isDesktop ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
          transition={
            isDesktop
              ? { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
              : { type: 'spring', damping: 34, stiffness: 400, mass: 0.9 }
          }
          className={cn(
            'relative w-full flex flex-col outline-none',
            'bg-card text-card-foreground border border-border/60 shadow-sheet overflow-hidden',
            'rounded-t-[28px] sm:rounded-3xl',
            className,
          )}
          style={{
            maxHeight: `calc(100dvh - ${keyboardInset}px - env(safe-area-inset-top) - 1.5rem)`,
          }}
        >
          {/* Grab handle (phones) — visual cue; the whole sheet is draggable */}
          <div className="sm:hidden shrink-0 flex justify-center pt-2.5 pb-1.5" aria-hidden>
            <span className="h-1.5 w-11 rounded-full bg-muted-foreground/30" />
          </div>
          {children}
        </motion.div>
      </motion.div>
    </div>,
    document.body,
  )
}

/* ─── building blocks ─── */

export function SheetHeader({
  titleId,
  title,
  subtitle,
  icon,
  iconClassName,
  onClose,
  closeDisabled = false,
  children,
}: {
  titleId: string
  title: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  /** Tint for the icon tile (e.g. "bg-negative/10 text-negative"). */
  iconClassName?: string
  onClose?: () => void
  closeDisabled?: boolean
  /** Extra content under the title row (e.g. a date chip). */
  children?: ReactNode
}) {
  return (
    <div className="shrink-0 px-4 sm:px-5 pt-1 sm:pt-5 pb-3">
      <div className="flex items-center gap-3">
        {icon && (
          <div
            className={cn(
              'w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 bg-primary/10 text-primary',
              iconClassName,
            )}
          >
            {icon}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h2 id={titleId} className="text-lg font-bold text-foreground tracking-tight leading-tight">
            {title}
          </h2>
          {subtitle && <div className="text-sm text-muted-foreground mt-0.5">{subtitle}</div>}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="Close"
            className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center bg-muted/70 text-muted-foreground hover:text-foreground hover:bg-muted active:scale-[0.97] transition-all disabled:opacity-40"
          >
            <X size={18} strokeWidth={2.2} />
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

export function SheetBody({
  children,
  className,
  bodyRef,
}: {
  children: ReactNode
  className?: string
  bodyRef?: RefObject<HTMLDivElement | null>
}) {
  return (
    <div
      ref={bodyRef}
      className={cn('flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-5 pb-4', className)}
    >
      {children}
    </div>
  )
}

export function SheetFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('shrink-0 px-4 sm:px-5 pt-3 border-t border-border/60 bg-card', className)}
      style={{ paddingBottom: 'calc(0.875rem + env(safe-area-inset-bottom))' }}
    >
      {children}
    </div>
  )
}
