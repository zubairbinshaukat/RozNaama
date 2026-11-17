import { useMemo, useId } from 'react'
import { Layers, ShoppingBag } from 'lucide-react'
import { cn } from '@/lib/utils'
import Amount from '@/components/shared/Amount'
import { useFormatMoney } from '@/context/amountVisibility'
import { btnSecondary } from '@/lib/ui'
import { groupSaleItemsByDay } from '@/lib/saleGroups'
import { useCategorySalesPaginated, useCategorySummary } from '@/hooks/useCategorySales'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import EmptyState from '@/components/shared/EmptyState'
import LoadMoreButton from '@/components/dashboard/LoadMoreButton'
import type { Category } from '@/hooks/useCategories'

const PAGE_SIZE = 20

interface CategorySalesModalProps {
  category: Category
  onClose:  () => void
}

export default function CategorySalesModal({ category, onClose }: CategorySalesModalProps) {
  const { results, status, loadMore } = useCategorySalesPaginated(category._id, PAGE_SIZE)
  const summary = useCategorySummary(category._id)
  // Grouping runs over every loaded page, so a day split across pages merges here.
  const days = useMemo(() => groupSaleItemsByDay(results), [results])
  const titleId = useId()
  const money = useFormatMoney()
  const isFirstPageLoading = status === 'LoadingFirstPage'

  return (
    <Sheet onClose={onClose} labelledBy={titleId} layer={540}>
      <SheetHeader
        titleId={titleId}
        title={<span className="flex items-center gap-2 min-w-0"><span className="truncate">{category.name}</span></span>}
        subtitle={summary === undefined ? (
          <div
            data-testid="category-summary-skeleton"
            aria-hidden
            className="skeleton h-3.5 w-36 mt-1 rounded-md"
          />
        ) : (
          <p>
            {summary.count > 0
              ? `${summary.count} sale${summary.count !== 1 ? 's' : ''} · ${money(summary.totalAmount)} total`
              : 'No sales yet'}
          </p>
        )}
        icon={<Layers size={18} style={{ color: category.color }} />}
        iconClassName="bg-muted"
        onClose={onClose}
      />

      <SheetBody>
        {isFirstPageLoading ? (
          <div className="flex flex-col gap-2" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-15 rounded-2xl" />
            ))}
          </div>
        ) : days.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag size={48} strokeWidth={1.5} />}
            title="No sales yet"
            message={`Record a sale and pick “${category.name}” as its category to see it here.`}
            showActions={false}
          />
        ) : (
          <div className="flex flex-col gap-5">
            {days.map((day) => (
              <section key={day.dateKey}>
                <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5 px-1">
                  {day.dateLabel}
                </h3>
                <ul className="flex flex-col divide-y divide-border/60 rounded-2xl border border-border/70">
                  {day.items.map((sale) => (
                    <li key={sale._id} className="flex items-center gap-3 px-3.5 min-h-14 py-2.5">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: category.color }} aria-hidden />
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-semibold text-foreground truncate">{sale.productName}</p>
                        {sale.note && (
                          <p className="text-[13px] text-muted-foreground truncate">{sale.note}</p>
                        )}
                      </div>
                      <Amount value={sale.amount} className="text-base font-bold text-foreground shrink-0" />

                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <LoadMoreButton status={status} onLoadMore={() => loadMore(PAGE_SIZE)} />
          </div>
        )}
      </SheetBody>

      <SheetFooter>
        <button type="button" onClick={onClose} className={cn(btnSecondary, 'w-full')}>
          Close
        </button>
      </SheetFooter>
    </Sheet>
  )
}
