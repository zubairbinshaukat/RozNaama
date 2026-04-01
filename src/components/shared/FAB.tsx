import { useState, useEffect, useRef } from 'react'
import { Plus, Tag, ShoppingBag, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FABProps {
  onAddCategory:      () => void
  onAddSale:          () => void
  onManageCategories: () => void
  /** When true, FAB is hidden (e.g. admin viewing another user). */
  disabled?:          boolean
}

export default function FAB({ onAddCategory, onAddSale, onManageCategories, disabled = false }: FABProps) {
  const [open, setOpen] = useState(false)
  const fabRef = useRef<HTMLDivElement>(null)

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
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
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
          className={cn(
            'fixed inset-0 z-40 cursor-default',
            'bg-background/75 backdrop-blur-[3px]',
            'animate-modal-backdrop',
          )}
          onClick={() => setOpen(false)}
        />
      )}
      <div ref={fabRef} className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {open && (
        <>
          <FABItem icon={<ShoppingBag size={18} />} label="Add Sale"           onClick={handle(onAddSale)}          delay="0ms"  />
          <FABItem icon={<Tag        size={18} />} label="Add Category"        onClick={handle(onAddCategory)}      delay="50ms" />
          <FABItem icon={<Layers     size={18} />} label="Manage Categories"   onClick={handle(onManageCategories)} delay="100ms"/>
        </>
      )}

      <button
        onClick={() => setOpen((p) => !p)}
        aria-label={open ? 'Close actions' : 'Add new'}
        aria-expanded={open}
        className={cn(
          'w-14 h-14 rounded-full bg-gradient-brand text-white shadow-glow-md',
          'flex items-center justify-center',
          'transition-all duration-200 active:scale-95 hover:opacity-90',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        )}
      >
        <Plus size={24} className={cn('transition-transform duration-200', open && 'rotate-45')} />
      </button>
      </div>
    </>
  )
}

function FABItem({ icon, label, onClick, delay }: {
  icon:    React.ReactNode
  label:   string
  onClick: () => void
  delay:   string
}) {
  return (
    <button
      onClick={onClick}
      style={{ animationDelay: delay }}
      className={cn(
        'flex items-center gap-2.5 pl-3 pr-4 py-2.5 rounded-full',
        'bg-card border border-border shadow-card-hover',
        'text-sm font-medium text-foreground',
        'hover:bg-muted active:scale-95 transition-all duration-150',
        'animate-fab-item',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <span className="text-primary">{icon}</span>
      {label}
    </button>
  )
}
