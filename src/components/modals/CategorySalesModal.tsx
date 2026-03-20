import { useMemo } from 'react'
import { X, Layers, ShoppingBag } from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { groupSaleItemsByDay } from '@/lib/saleGroups'
import { useSalesByCategoryId } from '@/hooks/useSales'
import type { Category } from '@/hooks/useCategories'

function hexToRgb(hex: string) {
  const clean = hex.replace('#', '')
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  }
}

interface CategorySalesModalProps {
  category: Category
  onClose:  () => void
}

export default function CategorySalesModal({ category, onClose }: CategorySalesModalProps) {
  const raw  = useSalesByCategoryId(category._id)
  const days = useMemo(() => (raw ? groupSaleItemsByDay(raw) : []), [raw])
  const { r, g, b } = hexToRgb(category.color)

  const totalSales = raw ? raw.length : 0
  const totalAmount = raw ? raw.reduce((s, item) => s + item.amount, 0) : 0

  return (
    <div
      className="fixed inset-0 z-[520] flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="category-sales-title"
    >
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
          onClick={onClose}
          aria-hidden
        />

        {/* Panel */}
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.97 }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          className="relative w-full max-w-md bg-card border border-border/60 rounded-3xl max-h-[88dvh] flex flex-col overflow-hidden"
          style={{
            boxShadow: `
              0 2px 4px rgba(0,0,0,0.02),
              0 8px 20px rgba(0,0,0,0.06),
              0 24px 60px rgba(${r},${g},${b},0.10)
            `,
          }}
        >
          {/* Header band */}
          <div
            className="w-full pt-5 pb-6 px-5 relative shrink-0"
            style={{
              background: `linear-gradient(135deg, rgba(${r},${g},${b},0.12) 0%, rgba(${r},${g},${b},0.03) 100%)`,
            }}
          >
            {/* Close */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute top-3 right-3 p-2 rounded-xl text-muted-foreground/60 hover:text-foreground hover:bg-black/5 active:scale-95 transition-all"
            >
              <X size={18} strokeWidth={2} />
            </button>

            <div className="flex items-center gap-3">
              <div
                className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
                style={{
                  background: `linear-gradient(135deg, rgba(${r},${g},${b},0.20), rgba(${r},${g},${b},0.08))`,
                  boxShadow: `0 4px 12px rgba(${r},${g},${b},0.12)`,
                }}
              >
                <Layers size={20} style={{ color: category.color }} strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1">
                <h2
                  id="category-sales-title"
                  className="text-base font-bold text-foreground tracking-tight truncate"
                >
                  {category.name}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {raw === undefined
                    ? 'Loading…'
                    : totalSales > 0
                      ? `${totalSales} sale${totalSales !== 1 ? 's' : ''} · ${formatCurrency(totalAmount)} total`
                      : 'No sales yet'}
                </p>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1 px-4 py-4 min-h-0">
            {raw === undefined ? (
              <div className="flex flex-col gap-2.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-16 rounded-2xl bg-muted/40 animate-pulse"
                    style={{ animationDelay: `${i * 120}ms` }}
                  />
                ))}
              </div>
            ) : days.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                className="flex flex-col items-center justify-center py-14 gap-4 text-center"
              >
                <motion.div
                  animate={{ y: [0, -5, 0] }}
                  transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
                  className="w-16 h-16 rounded-3xl flex items-center justify-center border"
                  style={{
                    background: `linear-gradient(135deg, rgba(${r},${g},${b},0.10), rgba(${r},${g},${b},0.03))`,
                    borderColor: `rgba(${r},${g},${b},0.08)`,
                  }}
                >
                  <ShoppingBag size={26} style={{ color: `rgba(${r},${g},${b},0.35)` }} strokeWidth={1.5} />
                </motion.div>
                <div className="space-y-1.5">
                  <p className="font-semibold text-foreground">No sales yet</p>
                  <p className="text-sm text-muted-foreground leading-relaxed max-w-[220px]">
                    Record a sale with this category to see it here
                  </p>
                </div>
              </motion.div>
            ) : (
              <div className="flex flex-col gap-5">
                {days.map((day, dayIdx) => (
                  <motion.div
                    key={day.dateKey}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: dayIdx * 0.05,
                      duration: 0.3,
                      ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
                    }}
                  >
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
                      {day.dateLabel}
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {day.items.map((sale, saleIdx) => (
                        <motion.div
                          key={sale._id}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{
                            delay: dayIdx * 0.05 + saleIdx * 0.03,
                            duration: 0.25,
                            ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
                          }}
                          className="flex items-center gap-3 rounded-2xl px-3.5 py-3 transition-colors hover:bg-muted/25"
                          style={{
                            boxShadow: `0 1px 3px rgba(0,0,0,0.02), 0 0 0 1px rgba(${r},${g},${b},0.05)`,
                          }}
                        >
                          {/* Color bar */}
                          <div
                            className="w-1 rounded-full shrink-0 self-stretch min-h-8"
                            style={{
                              background: `linear-gradient(180deg, ${category.color}, rgba(${r},${g},${b},0.2))`,
                            }}
                          />

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">
                              {sale.productName}
                            </p>
                            {sale.note && (
                              <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
                                {sale.note}
                              </p>
                            )}
                          </div>

                          {/* Amount */}
                          <span
                            className="text-sm font-bold tabular-nums shrink-0"
                            style={{ color: category.color }}
                          >
                            {formatCurrency(sale.amount)}
                          </span>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 pb-5 pt-2 shrink-0">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="w-full h-11 rounded-xl text-sm font-semibold active:scale-[0.97] transition-transform"
            >
              Close
            </Button>
          </div>
        </motion.div>
      </div>
  )
}