import { useMemo } from 'react'
import { CalendarDays } from 'lucide-react'
import SalesList from './SalesList'
import DayFeedSkeleton from './DayFeedSkeleton'
import EmptyState from '@/components/shared/EmptyState'
import { useCategories } from '@/hooks/useCategories'
import { useDayFeed } from '@/hooks/useDayFeed'
import { toDayGroups } from '@/lib/dayGroups'
import { dayLabel, dayRange, isCurrentPeriod } from '@/lib/period'

interface DailyTabProps {
  /** Selected day (local midnight ms). */
  day: number
}

/** One day's sales and expenses, expanded. */
export default function DailyTab({ day }: DailyTabProps) {
  const { start, end } = dayRange(day)
  const feed = useDayFeed({ startDate: start, endDate: end }, 1)
  const categories = useCategories()
  const days = useMemo(() => toDayGroups(feed.results), [feed.results])
  const isToday = isCurrentPeriod('day', day)

  if (categories === undefined || feed.status === 'LoadingFirstPage') {
    return (
      <div className="pt-2">
        <DayFeedSkeleton count={1} />
      </div>
    )
  }

  if (days.length === 0) {
    const label = dayLabel(day)
    return (
      <div className="pt-2">
        <EmptyState
          icon={<CalendarDays size={48} strokeWidth={1.5} />}
          title={isToday ? 'No sales today yet' : label === 'Yesterday' ? 'No sales yesterday' : `No sales on ${label}`}
          message={isToday
            ? 'Tap the + button to record your first sale or expense of the day.'
            : 'Nothing was recorded on this day.'}
          showActions={isToday}
        />
      </div>
    )
  }

  return (
    <div className="pt-2">
      <SalesList days={days} categories={categories} expandAll />
    </div>
  )
}
