import { useId, useState } from 'react'
import { CalendarClock, ChevronDown, X } from 'lucide-react'
import Sheet, { SheetBody, SheetHeader } from '@/components/shared/Sheet'
import Calendar from '@/components/shared/Calendar'
import { addDays, cn, formatDate, formatFullDate, startOfDay } from '@/lib/utils'
import { fieldLabel } from '@/lib/ui'

/** Due dates may be up to 2 years ahead (server: DUE_DATE_MAX_AHEAD_MS). */
const MAX_DAYS_AHEAD = 730

interface DueDateFieldProps {
  value:     number | null
  onChange:  (ms: number | null) => void
  disabled?: boolean
  label?:    string
}

/** Optional future date ("Ready by"): today … 2 years ahead, clearable. */
export default function DueDateField({ value, onChange, disabled = false, label = 'Ready by' }: DueDateFieldProps) {
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const today = startOfDay()

  return (
    <div className="flex flex-col gap-1.5">
      <span className={fieldLabel} aria-hidden>
        {label} <span className="font-normal text-muted-foreground">(optional)</span>
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={`${label}: ${value === null ? 'not set' : formatFullDate(value)}. Change date`}
          className={cn(
            'flex-1 min-h-12 px-4 rounded-2xl border border-input bg-background',
            'flex items-center gap-3 text-left text-base font-semibold text-foreground',
            'hover:bg-muted/40 active:scale-[0.97] transition-all duration-150 disabled:opacity-50',
          )}
        >
          <CalendarClock size={18} className="text-primary shrink-0" />
          <span className={cn('flex-1 min-w-0 truncate', value === null && 'text-muted-foreground font-medium')}>
            {value === null ? 'No date' : formatDate(value)}
          </span>
          <ChevronDown size={16} className="text-muted-foreground shrink-0" />
        </button>
        {value !== null && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            aria-label={`Clear ${label}`}
            className="w-12 min-h-12 rounded-2xl border border-input flex items-center justify-center text-muted-foreground hover:bg-muted active:scale-[0.97] transition-all"
          >
            <X size={18} />
          </button>
        )}
      </div>
      {open && (
        <Sheet onClose={() => setOpen(false)} labelledBy={titleId} layer={700} size="sm">
          <SheetHeader titleId={titleId} title={label} icon={<CalendarClock size={18} />} onClose={() => setOpen(false)} />
          <SheetBody className="pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <Calendar
              value={value ?? today}
              onSelect={(ms) => { onChange(startOfDay(new Date(ms))); setOpen(false) }}
              minDate={today}
              maxDate={addDays(today, MAX_DAYS_AHEAD)}
              todayMs={today}
            />
          </SheetBody>
        </Sheet>
      )}
    </div>
  )
}
