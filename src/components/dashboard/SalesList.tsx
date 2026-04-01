import { useState, useMemo } from 'react'
import { ChevronDown, ShoppingBag, Calendar, Pencil, Trash2, Eye, Receipt } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn, formatCurrency, formatDate, formatTime, toLocalDateKey } from '@/lib/utils'
import { useDeleteSaleItem } from '@/hooks/useSales'
import { useDeleteExpenseItem } from '@/hooks/useExpenses'
import { useToast } from '@/components/shared/Toast'
import { useIsViewingOtherSafe } from '@/context/ViewAsContext'
import EditSaleModal from '@/components/modals/EditSaleModal'
import EditExpenseModal from '@/components/modals/EditExpenseModal'
import SaleDetailModal from '@/components/modals/SaleDetailModal'
import CategorySalesModal from '@/components/modals/CategorySalesModal'
import ConfirmModal  from '@/components/modals/ConfirmModal'
import type { SaleSession, SaleItem } from '@/hooks/useSales'
import type { ExpenseEntry } from '@/hooks/useExpenses'
import type { Category } from '@/hooks/useCategories'

/* ─── helpers ─── */

function getTodayKey(): string {
  return toLocalDateKey(Date.now())
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '')
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  }
}

function hexToSoftBg(hex: string, alpha = 0.10): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

function hexToGradient(hex: string): string {
  const { r, g, b } = hexToRgb(hex)
  return `linear-gradient(135deg, rgba(${r},${g},${b},0.08) 0%, rgba(${r},${g},${b},0.02) 100%)`
}

/* ─── types ─── */

type DayGroup = {
  dateKey:     string
  dateLabel:   string
  salesTotalAmount:    number
  expenseTotalAmount:  number
  netTotalAmount:      number
  itemCount:   number
  items:       SaleItem[]
  expenses:    ExpenseEntry[]
}

function buildDayGroups(sessions: SaleSession[], expenses: ExpenseEntry[]): DayGroup[] {
  const map = new Map<string, DayGroup>()

  for (const session of sessions) {
    const key = toLocalDateKey(session.sessionDate)

    if (!map.has(key)) {
      map.set(key, {
        dateKey:     key,
        dateLabel:   formatDate(session.sessionDate),
        salesTotalAmount: 0,
        expenseTotalAmount: 0,
        netTotalAmount: 0,
        itemCount:   0,
        items:       [],
        expenses:    [],
      })
    }

    const group = map.get(key)!
    group.salesTotalAmount += session.totalAmount
    group.itemCount   += session.itemCount
    group.items.push(...session.items)
  }

  for (const expense of expenses) {
    const key = toLocalDateKey(expense.expenseDate)

    if (!map.has(key)) {
      map.set(key, {
        dateKey:     key,
        dateLabel:   formatDate(expense.expenseDate),
        salesTotalAmount: 0,
        expenseTotalAmount: 0,
        netTotalAmount: 0,
        itemCount:   0,
        items:       [],
        expenses:    [],
      })
    }

    const group = map.get(key)!
    group.expenseTotalAmount += expense.amount
    group.expenses.push(expense)
  }

  for (const group of map.values()) {
    group.items.sort((a, b) => a.createdAt - b.createdAt)
    group.expenses.sort((a, b) => a.createdAt - b.createdAt)
    group.netTotalAmount = group.salesTotalAmount - group.expenseTotalAmount
  }

  return Array.from(map.values()).sort((a, b) => b.dateKey.localeCompare(a.dateKey))
}

/* ─── empty state ─── */

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
      className="flex flex-col items-center justify-center py-24 gap-5 text-center"
    >
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
        className="w-20 h-20 rounded-3xl bg-linear-to-br from-primary/15 via-primary/5 to-transparent flex items-center justify-center backdrop-blur-sm border border-primary/10"
      >
        <ShoppingBag className="text-primary/40" size={32} strokeWidth={1.5} />
      </motion.div>
      <div className="space-y-2">
        <p className="font-semibold text-foreground text-lg tracking-tight">No sales or expenses yet</p>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-[240px]">
          Tap the <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold align-middle">+</span> button to record your first sale, or add an expense from the dashboard
        </p>
      </div>
    </motion.div>
  )
}

/* ─── sale item card (redesigned) ─── */

const cardVariants = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      delay: i * 0.04,
      duration: 0.35,
      ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
    },
  }),
} satisfies import('framer-motion').Variants

function SaleItemCard({
  item,
  categories,
  index,
  onViewDetail,
  onCategoryOpen,
  onEdit,
  onDelete,
  readOnly,
}: {
  item:             SaleItem
  categories:       Category[]
  index:            number
  onViewDetail:     (item: SaleItem) => void
  onCategoryOpen:   (category: Category) => void
  onEdit:           (item: SaleItem) => void
  onDelete:         (item: SaleItem) => void
  readOnly:         boolean
}) {
  const cat   = categories.find((c) => c._id === item.categoryId)
  const color = cat?.color ?? '#888888'
  const { r, g, b } = hexToRgb(color)

  return (
    <motion.div
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      layout
      className="h-full min-h-0 group"
    >
      <div
        className="relative rounded-2xl h-full flex flex-col overflow-hidden transition-all duration-300"
        style={{
          background: hexToGradient(color),
          boxShadow: `
            0 2px 4px rgba(0,0,0,0.04),
            0 8px 16px rgba(0,0,0,0.06),
            0 16px 40px rgba(${r},${g},${b},0.14),
            0 0 0 1px rgba(${r},${g},${b},0.10)
          `,
        }}
        // onMouseEnter={(e) => {
        //   e.currentTarget.style.boxShadow = `
        //     0 2px 4px rgba(0,0,0,0.04),
        //     0 8px 16px rgba(0,0,0,0.06),
        //     0 16px 40px rgba(${r},${g},${b},0.14),
        //     0 0 0 1px rgba(${r},${g},${b},0.10)
        //   `
        // }}
        // onMouseLeave={(e) => {
        //   e.currentTarget.style.boxShadow = `
        //     0 1px 2px rgba(0,0,0,0.04),
        //     0 4px 8px rgba(0,0,0,0.04),
        //     0 8px 24px rgba(${r},${g},${b},0.08),
        //     0 0 0 1px rgba(${r},${g},${b},0.06)
        //   `
        // }}
      >
        {/* Top accent line */}
        <div
          className="h-[3px] w-full shrink-0"
          style={{
            background: `linear-gradient(90deg, ${color}, rgba(${r},${g},${b},0.2))`,
          }}
        />

        {/* Card body */}
        <div className="flex flex-col flex-1 p-4 min-h-0">
          {/* Header: category pill + amount */}
          <div className="flex items-start justify-between gap-2 mb-3">
            {cat ? (
              <button
                type="button"
                onClick={() => onCategoryOpen(cat)}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-full max-w-[60%] truncate text-left transition-all duration-200 hover:scale-[1.03] active:scale-[0.97]"
                style={{
                  backgroundColor: hexToSoftBg(cat.color, 0.14),
                  color: cat.color,
                }}
              >
                {cat.name}
              </button>
            ) : (
              <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-muted/40 text-muted-foreground">
                Uncategorized
              </span>
            )}
            <div
              className="text-base font-bold tabular-nums tracking-tight shrink-0"
              style={{ color }}
            >
              {formatCurrency(item.amount)}
            </div>
          </div>

          {/* Product name */}
          <p className="text-[15px] truncate font-semibold text-foreground leading-snug line-clamp-2 wrap-break min-w-0 mb-1">
            {item.productName}
          </p>

          {/* Note */}
          {item.note && (
            <p className="text-xs text-muted-foreground/80 truncate line-clamp-2 leading-relaxed mt-1">
              {item.note}
            </p>
          )}

          {/* Spacer */}
          <div className="flex-1 min-h-3" />

          {/* Action buttons row */}
          <div className="flex items-center gap-1 pt-3 border-t border-border/40 mt-auto">
            <button
              type="button"
              onClick={() => onViewDetail(item)}
              aria-label="View sale details"
              className={cn(
                'flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium',
                'text-muted-foreground/70 transition-all duration-200',
                'hover:bg-foreground/4 hover:text-foreground',
                'active:scale-95 touch-manipulation',
                'flex-1',
              )}
            >
              <Eye size={14} strokeWidth={2} />
              <span className="hidden sm:inline">View</span>
            </button>
            {!readOnly && (
              <>
                <button
                  type="button"
                  onClick={() => onEdit(item)}
                  aria-label="Edit sale"
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium',
                    'text-muted-foreground/70 transition-all duration-200',
                    'hover:bg-foreground/4 hover:text-blue-400',
                    'active:scale-95 touch-manipulation',
                  )}
                >
                  <Pencil size={13} strokeWidth={2} />
                  <span className="hidden sm:inline">Edit</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(item)}
                  aria-label="Delete sale"
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium',
                    'text-muted-foreground/70 transition-all duration-200',
                    'hover:bg-destructive/6 hover:text-destructive',
                    'active:scale-95 touch-manipulation',
                  )}
                >
                  <Trash2 size={13} strokeWidth={2} />
                  <span className="hidden sm:inline">Delete</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

/* ─── grid layout ─── */

function SaleItemsGrid({
  items,
  categories,
  onViewDetail,
  onCategoryOpen,
  onEdit,
  onDelete,
  compact,
  readOnly,
}: {
  items:            SaleItem[]
  categories:       Category[]
  onViewDetail:     (item: SaleItem) => void
  onCategoryOpen:   (category: Category) => void
  onEdit:           (item: SaleItem) => void
  onDelete:         (item: SaleItem) => void
  compact:          boolean
  readOnly:         boolean
}) {
  const n = items.length
  if (n === 0) return null

  const gridClass =
    n === 1
      ? 'grid-cols-1 max-w-sm'
      : compact
        ? 'grid-cols-2 md:grid-cols-3'
        : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4'

  return (
    <div className={cn('grid gap-3', gridClass)}>
      {items.map((item, i) => (
        <SaleItemCard
          key={item._id}
          item={item}
          index={i}
          categories={categories}
          onViewDetail={onViewDetail}
          onCategoryOpen={onCategoryOpen}
          onEdit={onEdit}
          onDelete={onDelete}
          readOnly={readOnly}
        />
      ))}
    </div>
  )
}

/* ─── day card (accordion) ─── */

function DayCard({
  group,
  categories,
  isOpenByDefault,
  compact,
  readOnly,
}: {
  group:           DayGroup
  categories:      Category[]
  isOpenByDefault: boolean
  compact:         boolean
  readOnly:        boolean
}) {
  const [expanded,      setExpanded]      = useState(isOpenByDefault)
  const [editingItem,   setEditingItem]   = useState<SaleItem | null>(null)
  const [detailItem,    setDetailItem]    = useState<SaleItem | null>(null)
  const [categoryModal, setCategoryModal] = useState<Category | null>(null)
  const [deletingItem,  setDeletingItem]  = useState<SaleItem | null>(null)
  const [editingExpense, setEditingExpense] = useState<ExpenseEntry | null>(null)
  const [deletingExpense, setDeletingExpense] = useState<ExpenseEntry | null>(null)
  const [deleting,      setDeleting]      = useState(false)

  const deleteItem = useDeleteSaleItem()
  const deleteExpense = useDeleteExpenseItem()
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

  const handleDeleteExpense = async () => {
    if (!deletingExpense) return
    setDeleting(true)
    try {
      await deleteExpense({ expenseId: deletingExpense._id })
      showToast('Expense deleted', 'success')
      setDeletingExpense(null)
    } catch {
      showToast('Could not delete expense. Try again.', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const isToday = group.dateKey === getTodayKey()

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        className={cn(
          'rounded-2xl overflow-hidden transition-all duration-300',
          'bg-card border border-border/60',
          expanded ? 'shadow-md' : 'shadow-sm hover:shadow-md',
        )}
      >
        {/* Accordion header */}
        <button
          onClick={() => setExpanded((p) => !p)}
          className="w-full flex items-center gap-3.5 px-4 py-4 text-left transition-colors hover:bg-muted/20 active:bg-muted/40"
          aria-expanded={expanded}
        >
          <div
            className={cn(
              'w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 transition-colors duration-300',
              isToday
                ? 'bg-primary/12 text-primary'
                : 'bg-muted/60 text-muted-foreground',
            )}
          >
            <Calendar size={18} strokeWidth={1.8} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground tracking-tight">
                {group.dateLabel}
              </p>
              {isToday && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  Today
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {group.itemCount === 0
                ? 'No sales'
                : `${group.itemCount} sale${group.itemCount !== 1 ? 's' : ''}`}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {formatCurrency(group.salesTotalAmount)} - {formatCurrency(group.expenseTotalAmount)}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span
              className={cn(
                'text-[17px] font-bold tabular-nums tracking-tight',
                group.netTotalAmount < 0 ? 'text-destructive' : 'text-foreground',
              )}
            >
              {formatCurrency(group.netTotalAmount)}
            </span>
            <motion.div
              animate={{ rotate: expanded ? 180 : 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
            >
              <ChevronDown size={16} className="text-muted-foreground/60" />
            </motion.div>
          </div>
        </button>

        {/* Expandable content */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
              className="overflow-hidden"
            >
              <div className="px-3 pb-3 pt-1 flex flex-col gap-3">
                {group.expenses.length > 0 && (
                  <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Receipt size={16} className="text-destructive" strokeWidth={1.8} />
                        <p className="text-sm font-semibold text-foreground">Expenses</p>
                      </div>
                      <p className="text-sm font-bold text-destructive tabular-nums shrink-0">
                        {formatCurrency(group.expenseTotalAmount)}
                      </p>
                    </div>
                    <div className="mt-2 space-y-2">
                      {group.expenses.map((exp) => (
                        <div
                          key={exp._id}
                          className="rounded-xl bg-card/60 border border-border/50 px-3 py-2"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-destructive/90 truncate">
                                {exp.note?.trim() ? exp.note : 'Expense'}
                              </p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                {formatTime(exp.createdAt)}
                              </p>
                            </div>
                            <p className="text-sm font-bold text-destructive tabular-nums shrink-0">
                              {formatCurrency(exp.amount)}
                            </p>
                          </div>
                          {!readOnly && (
                            <div className="mt-2 pt-2 border-t border-border/50 flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setEditingExpense(exp)}
                                aria-label="Edit expense"
                                className={cn(
                                  'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium',
                                  'text-muted-foreground/70 transition-all duration-200',
                                  'hover:bg-foreground/4 hover:text-blue-400',
                                  'active:scale-95 touch-manipulation',
                                )}
                              >
                                <Pencil size={13} strokeWidth={2} />
                                <span className="hidden sm:inline">Edit</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingExpense(exp)}
                                aria-label="Delete expense"
                                className={cn(
                                  'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium',
                                  'text-muted-foreground/70 transition-all duration-200',
                                  'hover:bg-destructive/6 hover:text-destructive',
                                  'active:scale-95 touch-manipulation',
                                )}
                              >
                                <Trash2 size={13} strokeWidth={2} />
                                <span className="hidden sm:inline">Delete</span>
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <SaleItemsGrid
                  items={group.items}
                  categories={categories}
                  onViewDetail={setDetailItem}
                  onCategoryOpen={setCategoryModal}
                  onEdit={setEditingItem}
                  onDelete={setDeletingItem}
                  compact={compact}
                  readOnly={readOnly}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Modals */}
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
      {editingExpense && (
        <EditExpenseModal expense={editingExpense} onClose={() => setEditingExpense(null)} />
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
      {deletingExpense && (
        <ConfirmModal
          title="Delete Expense"
          message={`Delete "${deletingExpense.note?.trim() || 'Expense'}" (${formatCurrency(deletingExpense.amount)})?`}
          confirmLabel="Delete"
          destructive
          loading={deleting}
          onConfirm={handleDeleteExpense}
          onClose={() => setDeletingExpense(null)}
        />
      )}
    </>
  )
}

/* ─── main list ─── */

interface SalesListProps {
  sessions:   SaleSession[]
  expenses?:  ExpenseEntry[]
  categories: Category[]
  compact?:   boolean
}

export default function SalesList({ sessions, expenses = [], categories, compact = false }: SalesListProps) {
  const readOnly = useIsViewingOtherSafe()
  const todayKey = useMemo(() => getTodayKey(), [])

  if (sessions.length === 0 && expenses.length === 0) return <EmptyState />

  const days = buildDayGroups(sessions, expenses)

  return (
    <div className={cn('flex flex-col gap-3', !compact && 'animate-[fade-in_0.3s_ease-out]')}>
      {days.map((group) => (
        <DayCard
          key={group.dateKey}
          group={group}
          categories={categories}
          isOpenByDefault={group.dateKey === todayKey}
          compact={compact}
          readOnly={readOnly}
        />
      ))}
    </div>
  )
}