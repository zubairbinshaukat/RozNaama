import { Banknote, Hash, Star, CalendarDays, CalendarRange, BarChart2, Receipt } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn, formatAmount } from '@/lib/utils'
import type { DashboardStats } from '@/hooks/useSales'

// ── Skeleton ──────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="skeleton h-3 w-24 rounded-full" />
        <div className="skeleton h-9 w-9 rounded-xl" />
      </div>
      <div className="skeleton h-7 w-24 rounded-full" />
      <div className="skeleton h-2.5 w-16 rounded-full" />
    </div>
  )
}

// ── Single card ────────────────────────────────────────────────────────────

interface SummaryCardProps {
  icon:       React.ReactNode
  label:      string
  value:      string
  subLabel?:  string
  accent?:    string
  className?: string
  delay?:     number
  onClick?:   () => void
}

function SummaryCard({ icon, label, value, subLabel, accent = 'bg-primary/10', className, delay = 0, onClick }: SummaryCardProps) {
  const Comp = onClick ? motion.button : motion.div
  return (
    <Comp
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'rounded-2xl border border-border bg-card p-5 flex flex-col gap-3',
        'hover:shadow-card-hover transition-all duration-200',
        onClick
          ? 'cursor-pointer text-left active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2'
          : undefined,
        className,
      )}
      {...(onClick
        ? { type: 'button', onClick, 'aria-label': `Add expense: ${label}` }
        : {})}
    >
      <div className="flex items-start justify-between gap-3 min-w-0">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest min-w-0 wrap-break-word">
          {label}
        </span>
        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', accent)}>
          {icon}
        </div>
      </div>
      <p className="text-[1.6rem] font-logo font-bold text-foreground tracking-tight leading-tight min-w-0 wrap-break-word">
        {value}
      </p>
      {subLabel && (
        <p className="text-[11px] text-muted-foreground">{subLabel}</p>
      )}
    </Comp>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

interface SummaryCardsProps {
  stats:     DashboardStats | undefined
  activeTab: 'daily' | 'weekly' | 'monthly'
  onAddExpense?: () => void
}

export default function SummaryCards({ stats, activeTab, onAddExpense }: SummaryCardsProps) {
  if (!stats) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
      </div>
    )
  }

  const weekDayCount = 7
  const monthDayCount = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
  const weekDailyAvg = stats.weekCount > 0 ? stats.weekTotal / weekDayCount : 0
  const monthDailyAvg = stats.monthCount > 0 ? stats.monthTotal / monthDayCount : 0

  const cards = {
    daily: [
      {
        icon:     <Banknote className="text-primary" size={18} strokeWidth={1.5} />,
        label:    "Today's Total",
        value:    formatAmount(stats.todaySalesTotal),
        subLabel: `${stats.todayCount} sale${stats.todayCount !== 1 ? 's' : ''}`,
        accent:   'bg-primary/10',
      },
      {
        icon:     <Receipt className="text-destructive" size={18} strokeWidth={1.5} />,
        label:    'After Expense',
        value:    formatAmount(stats.todayNetTotal),
        subLabel: stats.todayExpenseCount === 0
          ? `${formatAmount(stats.todaySalesTotal)} - 0 (tap to add)`
          : `${formatAmount(stats.todaySalesTotal)} - ${formatAmount(stats.todayExpenseTotal)}`,
        accent:   'bg-destructive/10',
        onClick:  onAddExpense,
      },
      {
        icon:     <Hash className="text-emerald-500" size={18} strokeWidth={1.5} />,
        label:    'Sales Today',
        value:    String(stats.todayCount),
        subLabel: stats.todayCount === 0 ? 'No sales yet' : 'entries recorded',
        accent:   'bg-emerald-500/10',
      },
      {
        icon:     <Star className="text-amber-500" size={18} strokeWidth={1.5} />,
        label:    'Top Category',
        value:    stats.topCategoryName ?? '—',
        subLabel: 'highest today',
        accent:   'bg-amber-500/10',
      },
    ],
    weekly: [
      {
        icon:     <CalendarDays className="text-primary" size={18} strokeWidth={1.5} />,
        label:    'Week Net Total',
        value:    formatAmount(stats.weekTotal),
        subLabel: `${stats.weekCount} sales this week`,
        accent:   'bg-primary/10',
      },
      {
        icon:     <Hash className="text-emerald-500" size={18} strokeWidth={1.5} />,
        label:    'Sales This Week',
        value:    String(stats.weekCount),
        subLabel: 'entries recorded',
        accent:   'bg-emerald-500/10',
      },
      {
        icon:     <BarChart2 className="text-amber-500" size={18} strokeWidth={1.5} />,
        label:    'Daily Avg',
        value:    formatAmount(weekDailyAvg),
        subLabel: 'avg sales per day',
        accent:   'bg-amber-500/10',
      },
      {
        icon:     <Banknote className="text-violet-500" size={18} strokeWidth={1.5} />,
        label:    'Today Net Total',
        value:    formatAmount(stats.todayNetTotal),
        subLabel: `${stats.todayCount} today`,
        accent:   'bg-violet-500/10',
      },
    ],
    monthly: [
      {
        icon:     <CalendarRange className="text-primary" size={18} strokeWidth={1.5} />,
        label:    'Month Net Total',
        value:    formatAmount(stats.monthTotal),
        subLabel: `${stats.monthCount} sales this month`,
        accent:   'bg-primary/10',
      },
      {
        icon:     <Hash className="text-emerald-500" size={18} strokeWidth={1.5} />,
        label:    'Sales This Month',
        value:    String(stats.monthCount),
        subLabel: 'entries recorded',
        accent:   'bg-emerald-500/10',
      },
      {
        icon:     <BarChart2 className="text-amber-500" size={18} strokeWidth={1.5} />,
        label:    'Daily Avg',
        value:    formatAmount(monthDailyAvg),
        subLabel: 'avg sales per day',
        accent:   'bg-amber-500/10',
      },
      {
        icon:     <Star className="text-violet-500" size={18} strokeWidth={1.5} />,
        label:    'Top Category',
        value:    stats.topCategoryName ?? '—',
        subLabel: 'most popular today',
        accent:   'bg-violet-500/10',
      },
    ],
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={activeTab}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {cards[activeTab].map((card, i) => (
          <SummaryCard key={card.label} {...card} delay={i * 0.05} />
        ))}
      </motion.div>
    </AnimatePresence>
  )
}
