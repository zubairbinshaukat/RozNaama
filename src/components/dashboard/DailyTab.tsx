import SalesList from './SalesList'
import { usePaginatedSessions } from '@/hooks/useSales'
import { useCategories } from '@/hooks/useCategories'
import { usePaginatedExpenses } from '@/hooks/useExpenses'
import { Loader2 } from 'lucide-react'

const PAGE_SIZE = 20

export default function DailyTab() {
  const sessionsResult = usePaginatedSessions(PAGE_SIZE)
  const expensesResult = usePaginatedExpenses(PAGE_SIZE)
  const sessions = sessionsResult.results
  const categories = useCategories()
  const expenses = expensesResult.results

  if (categories === undefined) {
    return (
      <div className="flex flex-col gap-3 pt-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton h-20 rounded-2xl" />
        ))}
      </div>
    )
  }

  return (
    <div className="pt-2 space-y-4">
      <SalesList sessions={sessions} expenses={expenses} categories={categories} />
      {(sessionsResult.status !== 'Exhausted' || expensesResult.status !== 'Exhausted') && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => {
              if (sessionsResult.status === 'CanLoadMore') sessionsResult.loadMore(PAGE_SIZE)
              if (expensesResult.status === 'CanLoadMore') expensesResult.loadMore(PAGE_SIZE)
            }}
            disabled={sessionsResult.status === 'LoadingMore' || expensesResult.status === 'LoadingMore'}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border/70 bg-card text-sm font-semibold text-foreground hover:bg-muted/30 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.97] transition-all"
          >
            {(sessionsResult.status === 'LoadingMore' || expensesResult.status === 'LoadingMore') && (
              <Loader2 size={16} className="animate-spin" />
            )}
            <span>Show More</span>
          </button>
        </div>
      )}
    </div>
  )
}
