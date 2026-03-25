import SalesList from './SalesList'
import { useMonthSessions } from '@/hooks/useSales'
import { useCategories } from '@/hooks/useCategories'
import { useMonthExpenses } from '@/hooks/useExpenses'

export default function DailyTab() {
  const sessions   = useMonthSessions()
  const categories = useCategories()
  const expenses   = useMonthExpenses()

  if (sessions === undefined || categories === undefined || expenses === undefined) {
    return (
      <div className="flex flex-col gap-3 pt-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton h-20 rounded-2xl" />
        ))}
      </div>
    )
  }

  return (
    <div className="pt-2">
      <SalesList sessions={sessions} expenses={expenses} categories={categories} />
    </div>
  )
}
