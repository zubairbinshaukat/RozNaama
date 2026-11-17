import { useId } from 'react'
import { Package, CalendarDays, Tag, StickyNote, Clock, Pencil, Trash2, ChevronRight } from 'lucide-react'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import { cn, formatDate, formatTime } from '@/lib/utils'
import Amount from '@/components/shared/Amount'
import { btnDangerGhost, btnOutline, btnSecondary } from '@/lib/ui'
import type { SaleItem } from '@/hooks/useSales'
import type { Category } from '@/hooks/useCategories'
import OfflineEditNote from '@/components/shared/OfflineEditNote'

interface SaleDetailModalProps {
  item:       SaleItem
  categories: Category[]
  onClose:    () => void
  /** Omitted (read-only view) → no Edit button. */
  onEdit?:    () => void
  /** Omitted (read-only view) → no Delete button. */
  onDelete?:  () => void
  /** Opens the category's sales list. */
  onOpenCategory?: (category: Category) => void
  /** Edits need internet: show a short note above Edit / Delete. */
  editOffline?: boolean
}

/** Tap a sale row → this sheet: full details plus Edit / Delete (2 taps + confirm). */
export default function SaleDetailModal({
  item,
  categories,
  onClose,
  onEdit,
  onDelete,
  onOpenCategory,
  editOffline = false,
}: SaleDetailModalProps) {
  const titleId = useId()
  const cat = item.categoryId ? categories.find((c) => c._id === item.categoryId) : undefined
  const canEdit = onEdit !== undefined || onDelete !== undefined

  return (
    <Sheet onClose={onClose} labelledBy={titleId} layer={520}>
      <SheetHeader
        titleId={titleId}
        title={<span className="wrap-break-word">{item.productName}</span>}
        subtitle="Sale"
        icon={<Package size={18} />}
        iconClassName={cat ? undefined : 'bg-muted text-muted-foreground'}
        onClose={onClose}
      />
      <SheetBody className="flex flex-col gap-4">
        <div className="rounded-3xl bg-muted/50 px-5 py-4">
          <p className="text-sm font-semibold text-muted-foreground">Amount</p>
          <p className="text-[2rem] font-bold text-foreground tabular tracking-tight leading-tight">
            <Amount value={item.amount} />
          </p>
        </div>

        <dl className="flex flex-col divide-y divide-border/60 rounded-3xl border border-border/70">
          <DetailRow icon={<CalendarDays size={18} />} label="Date">
            {formatDate(item.saleDate)}
          </DetailRow>
          <DetailRow icon={<Clock size={18} />} label="Recorded at">
            {formatTime(item.createdAt)}
          </DetailRow>
          <DetailRow icon={<Tag size={18} />} label="Category">
            {cat ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} aria-hidden />
                {cat.name}
              </span>
            ) : (
              <span className="text-muted-foreground">No category</span>
            )}
          </DetailRow>
          {item.note && (
            <DetailRow icon={<StickyNote size={18} />} label="Note">
              <span className="wrap-break-word">{item.note}</span>
            </DetailRow>
          )}
        </dl>

        {cat && onOpenCategory && (
          <button
            type="button"
            onClick={() => onOpenCategory(cat)}
            className="flex items-center gap-3 min-h-12 px-4 rounded-2xl text-left text-base font-semibold text-primary hover:bg-primary/5 active:scale-[0.97] transition-all"
          >
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} aria-hidden />
            <span className="flex-1 min-w-0 truncate">See all {cat.name} sales</span>
            <ChevronRight size={18} />
          </button>
        )}
      </SheetBody>
      <SheetFooter>
        {canEdit && editOffline && <OfflineEditNote className="mb-3" />}
        {canEdit ? (
          <div className="flex gap-3">
            {onDelete && (
              <button type="button" onClick={onDelete} className={cn(btnDangerGhost, 'flex-1')}>
                <Trash2 size={18} /> Delete
              </button>
            )}
            {onEdit && (
              <button type="button" onClick={onEdit} className={cn(btnOutline, 'flex-1')}>
                <Pencil size={18} /> Edit
              </button>
            )}
          </div>
        ) : (
          <button type="button" onClick={onClose} className={cn(btnSecondary, 'w-full')}>
            Close
          </button>
        )}
      </SheetFooter>
    </Sheet>
  )
}

export function DetailRow({
  icon,
  label,
  children,
}: {
  icon:     React.ReactNode
  label:    string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0" aria-hidden>
        {icon}
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <dt className="text-[13px] font-semibold text-muted-foreground">{label}</dt>
        <dd className="text-base font-medium text-foreground">{children}</dd>
      </div>
    </div>
  )
}
