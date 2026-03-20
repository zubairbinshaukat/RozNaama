import { useMemo } from 'react'
import { X, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn, formatCurrency } from '@/lib/utils'
import { groupSaleItemsByDay } from '@/lib/saleGroups'
import { useSalesByCategoryId } from '@/hooks/useSales'
import type { Category } from '@/hooks/useCategories'

function hexToSoftBg(hex: string, alpha = 0.12): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

interface CategorySalesModalProps {
  category: Category
  onClose:  () => void
}

export default function CategorySalesModal({ category, onClose }: CategorySalesModalProps) {
  const raw = useSalesByCategoryId(category._id)
  const days = useMemo(() => (raw ? groupSaleItemsByDay(raw) : []), [raw])

  return (
    <div
      className="fixed inset-0 z-[520] flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="category-sales-title"
    >
      <div
        className="absolute inset-0 bg-black/50 animate-modal-backdrop"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl animate-modal-content max-h-[88dvh] flex flex-col">
        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-border shrink-0">
          <span
            className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center"
            style={{ backgroundColor: hexToSoftBg(category.color) }}
          >
            <Layers size={20} style={{ color: category.color }} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="category-sales-title" className="text-base font-semibold text-foreground truncate">
              {category.name}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">Sales in this category</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 min-h-0">
          {raw === undefined ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton h-16 rounded-xl" />
              ))}
            </div>
          ) : days.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 gap-3 text-center">
              <div className="w-14 h-14 rounded-2xl bg-muted/60 flex items-center justify-center">
                <Layers className="text-muted-foreground/50" size={26} strokeWidth={1.5} />
              </div>
              <p className="text-sm font-medium text-foreground">No sales yet</p>
              <p className="text-xs text-muted-foreground">Record a sale with this category to see it here.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {days.map((day) => (
                <div key={day.dateKey}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    {day.dateLabel}
                  </p>
                  <div className="flex flex-col gap-2">
                    {day.items.map((sale) => (
                      <div
                        key={sale._id}
                        className={cn(
                          'flex items-start gap-3 rounded-xl border border-border/60 bg-muted/5 px-3 py-2.5',
                        )}
                      >
                        <div
                          className="w-1 rounded-full shrink-0 self-stretch min-h-8 mt-0.5"
                          style={{ backgroundColor: category.color }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{sale.productName}</p>
                          {sale.note && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">{sale.note}</p>
                          )}
                        </div>
                        <span className="text-sm font-semibold text-foreground tabular-nums shrink-0">
                          {formatCurrency(sale.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 pb-5 pt-3 border-t border-border shrink-0">
          <Button type="button" variant="ghost" onClick={onClose} className="w-full active:scale-[0.97]">
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
