import { Banknote, Hash, Star, TrendingUp, CalendarDays, CalendarRange, BarChart2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/utils'
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
}

function SummaryCard({ icon, label, value, subLabel, accent = 'bg-primary/10', className, delay = 0 }: SummaryCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'rounded-2xl border border-border bg-card p-5 flex flex-col gap-3',
        'hover:shadow-card-hover transition-all duration-200',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
          {label}
        </span>
        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', accent)}>
          {icon}
        </div>
      </div>
      <p className="text-[1.6rem] font-logo font-bold text-foreground tracking-tight leading-none">
        {value}
      </p>
      {subLabel && (
        <p className="text-[11px] text-muted-foreground">{subLabel}</p>
      )}
    </motion.div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

interface SummaryCardsProps {
  stats:     DashboardStats | undefined
  activeTab: 'daily' | 'weekly' | 'monthly'
}

export default function SummaryCards({ stats, activeTab }: SummaryCardsProps) {
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
        value:    formatCurrency(stats.todayTotal),
        subLabel: `${stats.todayCount} sale${stats.todayCount !== 1 ? 's' : ''}`,
        accent:   'bg-primary/10',
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
      {
        icon:     <TrendingUp className="text-violet-500" size={18} strokeWidth={1.5} />,
        label:    'This Week',
        value:    formatCurrency(stats.weekTotal),
        subLabel: `${stats.weekCount} sales`,
        accent:   'bg-violet-500/10',
      },
    ],
    weekly: [
      {
        icon:     <CalendarDays className="text-primary" size={18} strokeWidth={1.5} />,
        label:    'Week Total',
        value:    formatCurrency(stats.weekTotal),
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
        value:    formatCurrency(weekDailyAvg),
        subLabel: 'avg sales per day',
        accent:   'bg-amber-500/10',
      },
      {
        icon:     <Banknote className="text-violet-500" size={18} strokeWidth={1.5} />,
        label:    "Today's Sales",
        value:    formatCurrency(stats.todayTotal),
        subLabel: `${stats.todayCount} today`,
        accent:   'bg-violet-500/10',
      },
    ],
    monthly: [
      {
        icon:     <CalendarRange className="text-primary" size={18} strokeWidth={1.5} />,
        label:    'Month Total',
        value:    formatCurrency(stats.monthTotal),
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
        value:    formatCurrency(monthDailyAvg),
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
