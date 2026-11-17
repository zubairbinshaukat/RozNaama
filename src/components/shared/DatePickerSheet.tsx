import { useId } from 'react'
import { CalendarDays } from 'lucide-react'
import Sheet, { SheetBody, SheetHeader } from './Sheet'
import Calendar from './Calendar'
import { addDays, cn, formatDate, isSameLocalDay, MIN_ENTRY_DATE_MS, startOfDay } from '@/lib/utils'
import { chip, chipActive, chipIdle } from '@/lib/ui'

interface DatePickerSheetProps {
  /** Selected day (local midnight ms). */
  value: number
  onSelect: (startOfDayMs: number) => void
  onClose: () => void
  title?: string
}

const QUICK_PICKS = [
  { label: 'Today', daysAgo: 0 },
  { label: 'Yesterday', daysAgo: 1 },
  { label: '2 days ago', daysAgo: 2 },
] as const

/**
 * Bottom-sheet calendar for sales / expenses. Future days are disabled —
 * entries can only be for today or earlier. Picking a day closes the sheet.
 */
export default function DatePickerSheet({ value, onSelect, onClose, title = 'Pick a date' }: DatePickerSheetProps) {
  const titleId = useId()
  const today = startOfDay()

  const pick = (ms: number) => {
    onSelect(Math.min(startOfDay(new Date(ms)), today))
    onClose()
  }

  return (
    <Sheet onClose={onClose} labelledBy={titleId} layer={700} size="sm">
      <SheetHeader
        titleId={titleId}
        title={title}
        subtitle={<>Selected: <span className="font-semibold text-foreground">{formatDate(value)}</span></>}
        icon={<CalendarDays size={18} />}
        onClose={onClose}
      />
      <SheetBody className="flex flex-col gap-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1" role="group" aria-label="Quick dates">
          {QUICK_PICKS.map((q) => {
            const ms = addDays(today, -q.daysAgo)
            const active = isSameLocalDay(ms, value)
            return (
              <button
                key={q.label}
                type="button"
                aria-pressed={active}
                onClick={() => pick(ms)}
                className={cn(chip, active ? chipActive : chipIdle)}
              >
                {q.label}
              </button>
            )
          })}
        </div>
        <Calendar value={value} onSelect={pick} maxDate={today} minDate={MIN_ENTRY_DATE_MS} todayMs={today} />
        <p className="text-[13px] text-muted-foreground text-center">
          Future dates are not allowed.
        </p>
      </SheetBody>
    </Sheet>
  )
}
