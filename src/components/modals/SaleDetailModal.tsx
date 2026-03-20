import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { SaleItem } from '@/hooks/useSales'
import type { Category } from '@/hooks/useCategories'

interface SaleDetailModalProps {
  item:       SaleItem
  categories: Category[]
  onClose:    () => void
}

export default function SaleDetailModal({ item, categories, onClose }: SaleDetailModalProps) {
  const cat = item.categoryId ? categories.find((c) => c._id === item.categoryId) : undefined

  return (
    <div
      className="fixed inset-0 z-[520] flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sale-detail-title"
    >
      <div
        className="absolute inset-0 bg-black/50 animate-modal-backdrop"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl animate-modal-content max-h-[90dvh] flex flex-col">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border shrink-0">
          <h2 id="sale-detail-title" className="text-base font-semibold text-foreground">
            Sale details
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-5 flex flex-col gap-4 overflow-y-auto">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Product</p>
            <p className="text-sm font-semibold text-foreground mt-1">{item.productName}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount</p>
            <p className="text-lg font-bold text-foreground tabular-nums mt-1">{formatCurrency(item.amount)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Date</p>
            <p className="text-sm text-foreground mt-1">{formatDate(item.saleDate)}</p>
          </div>
          {cat && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Category</p>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: cat.color }}
                />
                <span className="text-sm font-medium text-foreground">{cat.name}</span>
              </div>
            </div>
          )}
          {item.note && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Note</p>
              <p className="text-sm text-foreground mt-1">{item.note}</p>
            </div>
          )}
        </div>
        <div className="px-5 pb-5 pt-2 border-t border-border shrink-0">
          <Button type="button" variant="ghost" onClick={onClose} className="w-full active:scale-[0.97]">
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
