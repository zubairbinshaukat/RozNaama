import { lazy, Suspense, useState, useMemo, useId } from 'react'
import { AlertCircle, ChevronDown, ChevronRight, CloudOff, ShoppingBag, Receipt, Notebook } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn, formatTime, toLocalDateKey } from '@/lib/utils'
import { getErrorMessage } from '@/lib/errors'
import { dateKeyToLocalMs } from '@/lib/dayGroups'
import { isPendingId } from '@/lib/offline/overlay'
import { pendingCategoryName } from '@/lib/pendingEntries'
import { useDeleteSaleItem } from '@/hooks/useSales'
import { useDeleteExpenseItem } from '@/hooks/useExpenses'
import { useOutbox } from '@/hooks/useOutbox'
import { OFFLINE_EDIT_MESSAGE, useCanEditOnline } from '@/hooks/useCanEditOnline'
import { useLiveQueriesEnabled } from '@/hooks/offlineData'
import { useToast } from '@/components/shared/Toast'
import { useIsViewingOtherSafe } from '@/context/ViewAsContext'
import EmptyState from '@/components/shared/EmptyState'
import Amount from '@/components/shared/Amount'
import SheetFallback from '@/components/shared/SheetFallback'
import { useFormatMoney } from '@/context/amountVisibility'
import ConfirmModal  from '@/components/modals/ConfirmModal'
import type { SaleItem } from '@/hooks/useSales'
import type { ExpenseEntry } from '@/hooks/useExpenses'
import type { Category } from '@/hooks/useCategories'
import type { DayGroup } from '@/lib/dayGroups'

// Sheets load on first tap (precached by the service worker, so they open offline too).
const EditSaleModal      = lazy(() => import('@/components/modals/EditSaleModal'))
const EditExpenseModal   = lazy(() => import('@/components/modals/EditExpenseModal'))
const SaleDetailModal    = lazy(() => import('@/components/modals/SaleDetailModal'))
const ExpenseDetailSheet = lazy(() => import('@/components/modals/ExpenseDetailSheet'))
const CategorySalesModal = lazy(() => import('@/components/modals/CategorySalesModal'))
const PendingEntrySheet  = lazy(() => import('@/components/modals/PendingEntrySheet'))

/* ─── helpers ─── */

function getTodayKey(): string {
  return toLocalDateKey(Date.now())
}

function hexToSoftBg(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function plural(n: number, one: string, many: string): string {
  // Non-breaking space: "1 expense" never splits across lines.
  return `${n}\u00a0${n === 1 ? one : many}`
}

/* ─── calendar-style date tile ─── */

function DateTile({ dateKey, isToday }: { dateKey: string; isToday: boolean }) {
  const ms = dateKeyToLocalMs(dateKey)
  const valid = Number.isFinite(ms)
  const d = valid ? new Date(ms) : null
  return (
    <div
      aria-hidden
      className={cn(
        'w-12 h-13 rounded-2xl flex flex-col items-center justify-center shrink-0 leading-none',
        isToday ? 'bg-gradient-brand text-brand-foreground shadow-glow-sm' : 'bg-muted text-foreground',
      )}
    >
      <span className={cn('text-[11px] font-bold uppercase tracking-wide', !isToday && 'text-muted-foreground')}>
        {d ? d.toLocaleDateString('en-PK', { weekday: 'short' }) : ''}
      </span>
      <span className="text-xl font-bold tabular mt-0.5">{d ? d.getDate() : '–'}</span>
    </div>
  )
}

/* ─── list rows (WhatsApp-style) ─── */

/** Sync state of a row built from this phone's outbox (null for server rows). */
type RowSync ='waiting' | 'needsFix' | null

const SYNC_TEXT: Record<Exclude<RowSync, null>, string> = {
  waiting:  'Waiting to sync',
  needsFix: 'Needs a fix',
}

function SyncBadge({ sync }: { sync: Exclude<RowSync, null> }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 shrink-0 text-[12px] font-semibold',
        sync === 'needsFix' ? 'text-warning' : 'text-muted-foreground',
      )}
      data-testid="sync-badge"
    >
      {sync === 'needsFix' ? <AlertCircle size={14} aria-hidden /> : <CloudOff size={14} aria-hidden />}
      {SYNC_TEXT[sync]}
    </span>
  )
}

function SaleRow({
  item,
  categoryName,
  color,
  sync,
  onOpen,
}: {
  item: SaleItem
  categoryName: string | undefined
  color: string | undefined
  sync: RowSync
  onOpen: () => void
}) {
  const money = useFormatMoney()
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${item.productName}, ${money(item.amount)}${categoryName ? `, ${categoryName}` : ''}${sync ? `, ${SYNC_TEXT[sync].toLowerCase()}` : ''}. Open details`}
        className="w-full flex items-center gap-3 min-h-15 px-3 py-2.5 rounded-2xl text-left hover:bg-muted/60 active:scale-[0.97] transition-all duration-150"
      >
        <span
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
          style={color ? { backgroundColor: hexToSoftBg(color, 0.16), color } : undefined}
          aria-hidden
        >
          <ShoppingBag size={18} className={color ? undefined : 'text-muted-foreground'} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-base font-semibold text-foreground truncate">{item.productName}</span>
          <span className="flex items-center gap-1.5 min-w-0 text-[13px] text-muted-foreground">
            {sync && <SyncBadge sync={sync} />}
            <span className="truncate">
              {sync ? '· ' : ''}
              {categoryName ?? 'No category'}
              {item.note ? ` · ${item.note}` : ''}
            </span>
          </span>
        </span>
        <Amount value={item.amount} className="text-base font-bold text-foreground shrink-0" />
        <ChevronRight size={16} className="text-muted-foreground/60 shrink-0" aria-hidden />
      </button>
    </li>
  )
}

function ExpenseRow({ expense, sync, onOpen }: { expense: ExpenseEntry; sync: RowSync; onOpen: () => void }) {
  const title = expense.note?.trim() || 'Expense'
  const money = useFormatMoney()
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Expense: ${title}, ${money(expense.amount)}${sync ? `, ${SYNC_TEXT[sync].toLowerCase()}` : ''}. Open details`}
        className="w-full flex items-center gap-3 min-h-15 px-3 py-2.5 rounded-2xl text-left hover:bg-muted/60 active:scale-[0.97] transition-all duration-150"
      >
        <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-negative/12 text-negative" aria-hidden>
          <Receipt size={18} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-base font-semibold text-foreground truncate">{title}</span>
          <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            {sync && <SyncBadge sync={sync} />}
            <span>{sync ? '· ' : ''}{formatTime(expense.createdAt)}</span>
          </span>
        </span>
        <Amount value={expense.amount} className="text-base font-bold text-negative shrink-0" />
        <ChevronRight size={16} className="text-muted-foreground/60 shrink-0" aria-hidden />
      </button>
    </li>
  )
}

function SectionLabel({ children, total, tone }: { children: string; total: number; tone: 'negative' | 'neutral' }) {
  return (
    <div className="flex items-center justify-between px-3 pt-2 pb-1">
      <span className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">{children}</span>
      <Amount
        value={total}
        className={cn('text-[13px] font-bold', tone === 'negative' ? 'text-negative' : 'text-foreground')}
      />
    </div>
  )
}

/* ─── day card (accordion) ─── */

function DayCard({
  group,
  categories,
  isOpenByDefault,
  readOnly,
}: {
  group:           DayGroup
  categories:      Category[]
  isOpenByDefault: boolean
  readOnly:        boolean
}) {
  const [expanded,       setExpanded]       = useState(isOpenByDefault)
  const [editingItem,    setEditingItem]    = useState<SaleItem | null>(null)
  const [detailItem,     setDetailItem]     = useState<SaleItem | null>(null)
  const [detailExpense,  setDetailExpense]  = useState<ExpenseEntry | null>(null)
  const [categoryModal,  setCategoryModal]  = useState<Category | null>(null)
  const [deletingItem,   setDeletingItem]   = useState<SaleItem | null>(null)
  const [editingExpense, setEditingExpense] = useState<ExpenseEntry | null>(null)
  const [deletingExpense, setDeletingExpense] = useState<ExpenseEntry | null>(null)
  const [deleting,       setDeleting]       = useState(false)
  /** Row id of a "Waiting to sync" row whose sheet is open. */
  const [pendingRowId,   setPendingRowId]   = useState<string | null>(null)
  const panelId = useId()

  const money = useFormatMoney()
  const deleteItem = useDeleteSaleItem()
  const deleteExpense = useDeleteExpenseItem()
  const { showToast } = useToast()
  const { getEntry } = useOutbox()
  const canEdit = useCanEditOnline()
  const live = useLiveQueriesEnabled()

  const categoryById = useMemo(() => new Map(categories.map((c) => [c._id as string, c])), [categories])

  const syncOf = (rowId: string): RowSync => {
    if (!isPendingId(rowId)) return null
    return getEntry(rowId)?.status === 'needsAttention' ? 'needsFix' : 'waiting'
  }

  /** Edits and deletes need the server: offline, explain and keep the sheet open. */
  const whenOnline = (action: () => void) => () => {
    if (!canEdit) {
      showToast(OFFLINE_EDIT_MESSAGE, 'error')
      return
    }
    action()
  }

  const handleDelete = async () => {
    if (!deletingItem) return
    if (!canEdit) {
      showToast(OFFLINE_EDIT_MESSAGE, 'error')
      return
    }
    setDeleting(true)
    try {
      await deleteItem({ saleId: deletingItem._id })
      showToast('Sale deleted', 'success')
      setDeletingItem(null)
    } catch (err) {
      showToast(getErrorMessage(err, 'Could not delete sale. Try again.'), 'error')
    } finally {
      setDeleting(false)
    }
  }

  const handleDeleteExpense = async () => {
    if (!deletingExpense) return
    if (!canEdit) {
      showToast(OFFLINE_EDIT_MESSAGE, 'error')
      return
    }
    setDeleting(true)
    try {
      await deleteExpense({ expenseId: deletingExpense._id })
      showToast('Expense deleted', 'success')
      setDeletingExpense(null)
    } catch (err) {
      showToast(getErrorMessage(err, 'Could not delete expense. Try again.'), 'error')
    } finally {
      setDeleting(false)
    }
  }

  const isToday = group.dateKey === getTodayKey()

  return (
    <>
      <div
        className={cn(
          'rounded-3xl bg-card border overflow-hidden transition-shadow duration-200',
          isToday ? 'border-primary/30' : 'border-border/70',
          expanded ? 'shadow-card-hover' : 'shadow-card',
        )}
      >
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="w-full text-left px-3.5 py-3 hover:bg-muted/30 active:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <DateTile dateKey={group.dateKey} isToday={isToday} />
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold text-foreground tracking-tight truncate">{group.dateLabel}</p>
              <p className="text-[13px] text-muted-foreground mt-0.5 leading-snug">
                {group.saleCount === 0 ? 'No\u00a0sales' : plural(group.saleCount, 'sale', 'sales')}
                {group.expenseCount > 0 && ` · ${plural(group.expenseCount, 'expense', 'expenses')}`}
              </p>
            </div>
            <Amount
              value={group.net}
              signed
              colored
              className="text-lg font-bold tracking-tight shrink-0"
            />
            <ChevronDown
              size={18}
              aria-hidden
              className={cn('text-muted-foreground/70 shrink-0 transition-transform duration-200', expanded && 'rotate-180')}
            />
          </div>
        </button>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              id={panelId}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="px-1.5 pb-2 border-t border-border/60">
                {group.items.length > 0 && (
                  <>
                    <SectionLabel total={group.salesTotal} tone="neutral">Sales</SectionLabel>
                    <ul className="flex flex-col">
                      {group.items.map((item) => {
                        const sync = syncOf(item._id)
                        const cat = item.categoryId ? categoryById.get(item.categoryId) : undefined
                        return (
                          <SaleRow
                            key={item._id}
                            item={item}
                            categoryName={sync
                              ? pendingCategoryName(getEntry(item._id), item.categoryId, categories)
                              : cat?.name}
                            color={cat?.color}
                            sync={sync}
                            onOpen={() => (sync ? setPendingRowId(item._id) : setDetailItem(item))}
                          />
                        )
                      })}
                    </ul>
                  </>
                )}
                {group.expenses.length > 0 && (
                  <>
                    <SectionLabel total={group.expenseTotal} tone="negative">Expenses</SectionLabel>
                    <ul className="flex flex-col">
                      {group.expenses.map((exp) => {
                        const sync = syncOf(exp._id)
                        return (
                          <ExpenseRow
                            key={exp._id}
                            expense={exp}
                            sync={sync}
                            onOpen={() => (sync ? setPendingRowId(exp._id) : setDetailExpense(exp))}
                          />
                        )
                      })}
                    </ul>
                  </>
                )}
                {group.items.length === 0 && group.expenses.length === 0 && (
                  <p className="px-3 py-4 text-sm text-muted-foreground">Nothing recorded on this day.</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Sheets */}
      <Suspense fallback={<SheetFallback />}>
        {detailItem && (
          <SaleDetailModal
            item={detailItem}
            categories={categories}
            onClose={() => setDetailItem(null)}
            // The category's sales list needs live data.
            onOpenCategory={live ? (cat) => { setDetailItem(null); setCategoryModal(cat) } : undefined}
            onEdit={readOnly ? undefined : whenOnline(() => { setEditingItem(detailItem); setDetailItem(null) })}
            onDelete={readOnly ? undefined : whenOnline(() => { setDeletingItem(detailItem); setDetailItem(null) })}
            editOffline={!canEdit}
          />
        )}
        {detailExpense && (
          <ExpenseDetailSheet
            expense={detailExpense}
            onClose={() => setDetailExpense(null)}
            onEdit={readOnly ? undefined : whenOnline(() => { setEditingExpense(detailExpense); setDetailExpense(null) })}
            onDelete={readOnly ? undefined : whenOnline(() => { setDeletingExpense(detailExpense); setDetailExpense(null) })}
            editOffline={!canEdit}
          />
        )}
        {pendingRowId && !readOnly && (
          <PendingEntrySheet rowId={pendingRowId} categories={categories} onClose={() => setPendingRowId(null)} />
        )}
        {categoryModal && (
          <CategorySalesModal category={categoryModal} onClose={() => setCategoryModal(null)} />
        )}
        {editingItem && !readOnly && (
          <EditSaleModal item={editingItem} categories={categories} onClose={() => setEditingItem(null)} />
        )}
        {editingExpense && !readOnly && (
          <EditExpenseModal expense={editingExpense} onClose={() => setEditingExpense(null)} />
        )}
      </Suspense>
      {deletingItem && !readOnly && (
        <ConfirmModal
          title="Delete Sale"
          message={`Delete "${deletingItem.productName}" (${money(deletingItem.amount)})?`}
          confirmLabel="Delete"
          destructive
          loading={deleting}
          onConfirm={handleDelete}
          onClose={() => setDeletingItem(null)}
        />
      )}
      {deletingExpense && !readOnly && (
        <ConfirmModal
          title="Delete Expense"
          message={`Delete "${deletingExpense.note?.trim() || 'Expense'}" (${money(deletingExpense.amount)})?`}
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
  /** Day groups, newest first (see `toDayGroups`). Empty → empty state. */
  days:       DayGroup[]
  categories: Category[]
  /** Open every day card (the Daily view shows one day, expanded). Default: only today. */
  expandAll?: boolean
}

export default function SalesList({ days, categories, expandAll = false }: SalesListProps) {
  const readOnly = useIsViewingOtherSafe()
  const todayKey = useMemo(() => getTodayKey(), [])

  if (days.length === 0) {
    return (
      <EmptyState
        icon={<Notebook size={48} strokeWidth={1.5} />}
        title="No sales or expenses yet"
        message="Tap the + button at the bottom to record your first sale or expense."
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {days.map((group) => (
        <DayCard
          key={group.dateKey}
          group={group}
          categories={categories}
          isOpenByDefault={expandAll || group.dateKey === todayKey}
          readOnly={readOnly}
        />
      ))}
    </div>
  )
}
