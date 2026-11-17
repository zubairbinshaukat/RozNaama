import { useState, useEffect, useRef, useId } from 'react'
import { Plus, Tag, ShoppingBag, Layers, Receipt } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FABProps {
  onAddCategory:      () => void
  onAddSale:          () => void
  onAddExpense:       () => void
  onManageCategories: () => void
  /** When true, FAB is hidden (e.g. admin viewing another user). */
  disabled?:          boolean
}

/**
 * Floating "+" (raised in the centre of the phone tab bar; bottom-right from sm up). Opens a fan menu with
 * the record actions; the most common ones sit closest to the thumb.
 */
export default function FAB({ onAddCategory, onAddSale, onAddExpense, onManageCategories, disabled = false }: FABProps) {
  const [open, setOpen] = useState(false)
  const fabRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const firstItemRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (fabRef.current && !fabRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    firstItemRef.current?.focus({ preventScroll: true })
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        toggleRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const handle = (fn: () => void) => () => { setOpen(false); fn() }

  if (disabled) return null

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          tabIndex={-1}
          className="fixed inset-0 z-40 cursor-default bg-background/80 backdrop-blur-[3px] animate-modal-backdrop"
          onClick={() => setOpen(false)}
        />
      )}
      <div
        ref={fabRef}
        className={cn(
          // Phones: centre of the bottom bar, raised above it. sm+: floating bottom-right.
          'fixed z-50 flex flex-col items-center gap-3',
          'left-1/2 -translate-x-1/2 bottom-[calc(1.25rem+env(safe-area-inset-bottom))]',
          'sm:left-auto sm:translate-x-0 sm:items-end sm:right-6 sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))]',
        )}
      >
        {open && (
          <div id={menuId} role="group" aria-label="Add new" className="flex flex-col items-stretch sm:items-end gap-2.5 w-[min(16rem,calc(100vw-2rem))] sm:w-auto">
            {/* Same order users already know; Add Expense joins right under Add Sale */}
            <FABItem icon={<ShoppingBag size={18} />} label="Add Sale"          onClick={handle(onAddSale)}          delay="0ms"   tone="brand" itemRef={firstItemRef} />
            <FABItem icon={<Receipt size={18} />}     label="Add Expense"       onClick={handle(onAddExpense)}       delay="40ms"  tone="negative" />
            <FABItem icon={<Tag size={18} />}         label="Add Category"      onClick={handle(onAddCategory)}      delay="80ms" />
            <FABItem icon={<Layers size={18} />}      label="Manage Categories" onClick={handle(onManageCategories)} delay="120ms" />
          </div>
        )}

        <button
          ref={toggleRef}
          type="button"
          onClick={() => setOpen((p) => !p)}
          aria-label={open ? 'Close actions' : 'Add new'}
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          className={cn(
            'w-15 h-15 rounded-full bg-gradient-brand text-brand-foreground shadow-glow-md',
            'ring-4 ring-card sm:ring-0',
            'flex items-center justify-center',
            'transition-all duration-200 active:scale-[0.97] hover:brightness-105',
          )}
        >
          <Plus size={24} strokeWidth={2.4} className={cn('transition-transform duration-200', open && 'rotate-45')} />
        </button>
      </div>
    </>
  )
}

function FABItem({ icon, label, onClick, delay, tone = 'neutral', itemRef }: {
  icon:    React.ReactNode
  label:   string
  onClick: () => void
  delay:   string
  tone?:   'brand' | 'negative' | 'neutral'
  itemRef?: React.Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={itemRef}
      type="button"
      onClick={onClick}
      style={{ animationDelay: delay }}
      className={cn(
        'flex items-center gap-3 pl-2 pr-5 min-h-13 rounded-full',
        'bg-card border border-border shadow-card-hover',
        'text-base font-semibold text-foreground',
        'hover:bg-muted active:scale-[0.97] transition-all duration-150',
        'animate-fab-item',
      )}
    >
      <span
        className={cn(
          'w-9 h-9 rounded-full flex items-center justify-center',
          tone === 'brand' && 'bg-gradient-brand text-brand-foreground',
          tone === 'negative' && 'bg-negative/12 text-negative',
          tone === 'neutral' && 'bg-primary/10 text-primary',
        )}
        aria-hidden
      >
        {icon}
      </span>
      {label}
    </button>
  )
}
