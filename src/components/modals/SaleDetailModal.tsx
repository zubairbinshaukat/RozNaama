import { X, Package, DollarSign, CalendarDays, Tag, StickyNote } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { SaleItem } from '@/hooks/useSales'
import type { Category } from '@/hooks/useCategories'

interface SaleDetailModalProps {
  item:       SaleItem
  categories: Category[]
  onClose:    () => void
}

function hexToRgb(hex: string) {
  const clean = hex.replace('#', '')
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  }
}

export default function SaleDetailModal({ item, categories, onClose }: SaleDetailModalProps) {
  const cat = item.categoryId ? categories.find((c) => c._id === item.categoryId) : undefined
  const accent = cat?.color ?? '#6366f1'
  const { r, g, b } = hexToRgb(accent)

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[520] flex items-end sm:items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sale-detail-title"
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

        {/* Modal panel */}
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.97 }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          className="relative w-full max-w-md bg-card border border-border/60 rounded-3xl max-h-[90dvh] flex flex-col overflow-hidden"
          style={{
            boxShadow: `
              0 2px 4px rgba(0,0,0,0.02),
              0 8px 20px rgba(0,0,0,0.06),
              0 24px 60px rgba(${r},${g},${b},0.10)
            `,
          }}
        >
          {/* Accent gradient header band */}
          <div
            className="h-28 w-full relative shrink-0"
            style={{
              background: `linear-gradient(135deg, rgba(${r},${g},${b},0.14) 0%, rgba(${r},${g},${b},0.04) 100%)`,
            }}
          >
            {/* Decorative circle */}
            <div
              className="absolute -bottom-6 left-5 w-14 h-14 rounded-2xl flex items-center justify-center border-4 border-card"
              style={{
                background: `linear-gradient(135deg, rgba(${r},${g},${b},0.18), rgba(${r},${g},${b},0.08))`,
                boxShadow: `0 4px 12px rgba(${r},${g},${b},0.12)`,
              }}
            >
              <Package size={22} style={{ color: accent }} strokeWidth={1.8} />
            </div>

            {/* Close button */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute top-3 right-3 p-2 rounded-xl text-muted-foreground/60 hover:text-foreground hover:bg-black/5 active:scale-95 transition-all"
            >
              <X size={18} strokeWidth={2} />
            </button>
          </div>

          {/* Content */}
          <div className="px-5 pt-10 pb-5 flex flex-col gap-5 overflow-y-auto">
            {/* Product name as hero */}
            <div>
              <h2
                id="sale-detail-title"
                className="text-lg font-bold text-foreground tracking-tight leading-snug"
              >
                {item.productName}
              </h2>
              {cat && (
                <div className="flex items-center gap-1.5 mt-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span
                    className="text-xs font-semibold"
                    style={{ color: cat.color }}
                  >
                    {cat.name}
                  </span>
                </div>
              )}
            </div>

            {/* Detail rows */}
            <div className="flex flex-col gap-1">
              <DetailRow
                icon={<DollarSign size={16} />}
                label="Amount"
                accentRgb={`${r},${g},${b}`}
              >
                <span className="text-base font-bold text-foreground tabular-nums">
                  {formatCurrency(item.amount)}
                </span>
              </DetailRow>

              <DetailRow
                icon={<CalendarDays size={16} />}
                label="Date"
                accentRgb={`${r},${g},${b}`}
              >
                <span className="text-sm font-medium text-foreground">
                  {formatDate(item.saleDate)}
                </span>
              </DetailRow>

              {cat && (
                <DetailRow
                  icon={<Tag size={16} />}
                  label="Category"
                  accentRgb={`${r},${g},${b}`}
                >
                  <span className="text-sm font-medium text-foreground">{cat.name}</span>
                </DetailRow>
              )}

              {item.note && (
                <DetailRow
                  icon={<StickyNote size={16} />}
                  label="Note"
                  accentRgb={`${r},${g},${b}`}
                >
                  <span className="text-sm text-foreground leading-relaxed">{item.note}</span>
                </DetailRow>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 pb-5 pt-1 shrink-0">
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
    </AnimatePresence>
  )
}

/* ─── detail row component ─── */

function DetailRow({
  icon,
  label,
  accentRgb,
  children,
}: {
  icon:       React.ReactNode
  label:      string
  accentRgb:  string
  children:   React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 py-3 px-3.5 rounded-2xl transition-colors hover:bg-muted/30">
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
        style={{
          background: `rgba(${accentRgb}, 0.08)`,
          color: `rgb(${accentRgb})`,
        }}
      >
        {icon}
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
        {children}
      </div>
    </div>
  )
}