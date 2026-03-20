import { useState, useMemo } from 'react'
import { ChevronDown, ChevronUp, ShoppingBag, Calendar, Pencil, Trash2, Eye } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { useDeleteSaleItem } from '@/hooks/useSales'
import { useToast } from '@/components/shared/Toast'
import EditSaleModal from '@/components/modals/EditSaleModal'
import SaleDetailModal from '@/components/modals/SaleDetailModal'
import CategorySalesModal from '@/components/modals/CategorySalesModal'
import ConfirmModal  from '@/components/modals/ConfirmModal'
import type { SaleSession, SaleItem } from '@/hooks/useSales'
import type { Category } from '@/hooks/useCategories'

/** Today's date in YYYY-MM-DD for default-open accordion */
function getTodayKey(): string {
  return new Date().toISOString().split('T')[0]
}

/** Convert hex to soft rgba background */
function hexToSoftBg(hex: string, alpha = 0.12): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

type DayGroup = {
  dateKey:     string
  dateLabel:   string
  totalAmount: number
  itemCount:   number
  items:       SaleItem[]
}

function buildDayGroups(sessions: SaleSession[]): DayGroup[] {
  const map = new Map<string, DayGroup>()

  for (const session of sessions) {
    const d   = new Date(session.sessionDate)
    const key = d.toISOString().split('T')[0]

    if (!map.has(key)) {
      map.set(key, {
        dateKey:     key,
        dateLabel:   formatDate(session.sessionDate),
        totalAmount: 0,
        itemCount:   0,
        items:       [],
      })
    }

    const group = map.get(key)!
    group.totalAmount += session.totalAmount
    group.itemCount   += session.itemCount
    group.items.push(...session.items)
  }

  for (const group of map.values()) {
    group.items.sort((a, b) => a.createdAt - b.createdAt)
  }

  return Array.from(map.values()).sort((a, b) => b.dateKey.localeCompare(a.dateKey))
}

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="flex flex-col items-center justify-center py-20 gap-4 text-center"
    >
      <div className="w-16 h-16 rounded-2xl bg-muted/60 flex items-center justify-center">
        <ShoppingBag className="text-muted-foreground/50" size={28} strokeWidth={1.5} />
      </div>
      <div>
        <p className="font-semibold text-foreground">No sales this month</p>
        <p className="text-sm text-muted-foreground mt-1">Tap the + button to record your first sale!</p>
      </div>
    </motion.div>
  )
}

function SaleItemCard({
  item,
  categories,
  onViewDetail,
  onCategoryOpen,
  onEdit,
  onDelete,
}: {
  item:             SaleItem
  categories:       Category[]
  onViewDetail:     (item: SaleItem) => void
  onCategoryOpen:   (category: Category) => void
  onEdit:           (item: SaleItem) => void
  onDelete:         (item: SaleItem) => void
}) {
  const cat = categories.find((c) => c._id === item.categoryId)
  const color = cat?.color

  return (
    <div className="h-full min-h-0">
      <div
        className={cn(
          'rounded-2xl border-2 bg-card p-4 flex flex-col min-h-[160px] h-full',
          'shadow-card-hover transition-all duration-200 hover:-translate-y-0.5',
          !color && 'border-border',
        )}
        style={color ? { borderColor: color } : undefined}
      >
        <div className="flex flex-col gap-2 flex-1 min-h-0 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2 wrap-break-word min-w-0">
              {item.productName}
            </p>
            <span className="text-sm font-logo font-bold text-foreground tabular-nums tracking-tight shrink-0">
              {formatCurrency(item.amount)}
            </span>
          </div>
          {item.note && (
            <p className="text-xs text-muted-foreground line-clamp-2">{item.note}</p>
          )}
          {cat ? (
            <button
              type="button"
              onClick={() => onCategoryOpen(cat)}
              className="text-[10px] font-medium px-2 py-0.5 rounded-md max-w-full truncate text-left w-fit active:scale-[0.98] transition-transform"
              style={{ backgroundColor: hexToSoftBg(cat.color), color: cat.color }}
            >
              {cat.name}
            </button>
          ) : (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-md w-fit border border-border/70 bg-muted/25 text-muted-foreground">
              Uncategorized
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-1 pt-3 mt-auto">
          <button
            type="button"
            onClick={() => onViewDetail(item)}
            aria-label="View sale details"
            className="min-h-10 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/80 active:scale-95 transition-all touch-manipulation"
          >
            <Eye size={16} />
          </button>
          <button
            type="button"
            onClick={() => onEdit(item)}
            aria-label="Edit sale"
            className="min-h-10 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/80 active:scale-95 transition-all touch-manipulation"
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(item)}
            aria-label="Delete sale"
            className="min-h-10 flex items-center justify-center rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 active:scale-95 transition-all touch-manipulation"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

/** Mobile: 2 columns; md+: 3; xl (main dashboard): 4. Single item stays full width. */
function SaleItemsGrid({
  items,
  categories,
  onViewDetail,
  onCategoryOpen,
  onEdit,
  onDelete,
  compact,
}: {
  items:            SaleItem[]
  categories:       Category[]
  onViewDetail:     (item: SaleItem) => void
  onCategoryOpen:   (category: Category) => void
  onEdit:           (item: SaleItem) => void
  onDelete:         (item: SaleItem) => void
  compact:          boolean
}) {
  const n = items.length
  if (n === 0) return null

  const gridClass =
    n === 1
      ? 'grid-cols-1'
      : compact
        ? 'grid-cols-2 md:grid-cols-3'
        : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4'

  return (
    <div className={cn('grid gap-3', gridClass)}>
      {items.map((item) => (
        <SaleItemCard
          key={item._id}
          item={item}
          categories={categories}
          onViewDetail={onViewDetail}
          onCategoryOpen={onCategoryOpen}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}

function DayCard({
  group,
  categories,
  isOpenByDefault,
  compact,
}: {
  group:           DayGroup
  categories:      Category[]
  isOpenByDefault: boolean
  compact:         boolean
}) {
  const [expanded,     setExpanded]     = useState(isOpenByDefault)
  const [editingItem,   setEditingItem]   = useState<SaleItem | null>(null)
  const [detailItem,    setDetailItem]    = useState<SaleItem | null>(null)
  const [categoryModal, setCategoryModal] = useState<Category | null>(null)
  const [deletingItem, setDeletingItem] = useState<SaleItem | null>(null)
  const [deleting,     setDeleting]     = useState(false)

  const deleteItem = useDeleteSaleItem()
  const { showToast } = useToast()

  const handleDelete = async () => {
    if (!deletingItem) return
    setDeleting(true)
    try {
      await deleteItem({ saleId: deletingItem._id })
      showToast('Sale deleted', 'success')
      setDeletingItem(null)
    } catch {
      showToast('Could not delete sale. Try again.', 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm transition-shadow hover:shadow-md">
        <button
          onClick={() => setExpanded((p) => !p)}
          className="w-full flex items-center gap-3 px-4 py-4 text-left hover:bg-muted/30 active:bg-muted/50 transition-colors"
          aria-expanded={expanded}
        >
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Calendar size={17} className="text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">{group.dateLabel}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {group.itemCount} item{group.itemCount !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-base font-bold text-foreground tabular-nums">
              {formatCurrency(group.totalAmount)}
            </span>
            {expanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
          </div>
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="bg-muted/20 p-3">
                <SaleItemsGrid
                  items={group.items}
                  categories={categories}
                  onViewDetail={setDetailItem}
                  onCategoryOpen={setCategoryModal}
                  onEdit={setEditingItem}
                  onDelete={setDeletingItem}
                  compact={compact}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {detailItem && (
        <SaleDetailModal
          item={detailItem}
          categories={categories}
          onClose={() => setDetailItem(null)}
        />
      )}
      {categoryModal && (
        <CategorySalesModal category={categoryModal} onClose={() => setCategoryModal(null)} />
      )}
      {editingItem && (
        <EditSaleModal item={editingItem} categories={categories} onClose={() => setEditingItem(null)} />
      )}
      {deletingItem && (
        <ConfirmModal
          title="Delete Sale"
          message={`Delete "${deletingItem.productName}" (${formatCurrency(deletingItem.amount)})?`}
          confirmLabel="Delete"
          destructive
          loading={deleting}
          onConfirm={handleDelete}
          onClose={() => setDeletingItem(null)}
        />
      )}
    </>
  )
}

interface SalesListProps {
  sessions:   SaleSession[]
  categories: Category[]
  compact?:   boolean
}

export default function SalesList({ sessions, categories, compact = false }: SalesListProps) {
  const todayKey = useMemo(() => getTodayKey(), [])

  if (sessions.length === 0) return <EmptyState />

  const days = buildDayGroups(sessions)

  return (
    <div className={cn('flex flex-col gap-3', !compact && 'animate-[fade-in_0.3s_ease-out]')}>
      {days.map((group) => (
        <DayCard
          key={group.dateKey}
          group={group}
          categories={categories}
          isOpenByDefault={group.dateKey === todayKey}
          compact={compact}
        />
      ))}
    </div>
  )
}
