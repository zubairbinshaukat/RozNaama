import { useState } from 'react'
import { CalendarDays, ChevronDown } from 'lucide-react'
import DatePickerSheet from './DatePickerSheet'
import { cn, formatDate, formatFullDate } from '@/lib/utils'
import { fieldLabel } from '@/lib/ui'

interface DateFieldProps {
  label: string
  /** Selected day (local midnight ms). */
  value: number
  onChange: (startOfDayMs: number) => void
  disabled?: boolean
  hint?: string
  className?: string
}

/** Labelled button showing "Today" / "Yesterday" / "Mon, 12 Mar"; opens the calendar sheet. */
export default function DateField({ label, value, onChange, disabled = false, hint, className }: DateFieldProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <span className={fieldLabel} aria-hidden>{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${formatFullDate(value)}. Change date`}
        className={cn(
          'w-full min-h-12 px-4 rounded-2xl border border-input bg-background',
          'flex items-center gap-3 text-left text-base font-semibold text-foreground',
          'hover:bg-muted/40 active:scale-[0.97] transition-all duration-150',
          'disabled:opacity-50 disabled:pointer-events-none',
        )}
      >
        <CalendarDays size={18} className="text-primary shrink-0" />
        <span className="flex-1 min-w-0 truncate" data-testid="date-field-value">{formatDate(value)}</span>
        <span className="text-sm font-semibold text-primary shrink-0">Change</span>
        <ChevronDown size={16} className="text-muted-foreground shrink-0" />
      </button>
      {hint && <p className="text-[13px] text-muted-foreground">{hint}</p>}
      {open && (
        <DatePickerSheet
          value={value}
          onSelect={onChange}
          onClose={() => setOpen(false)}
          title={label}
        />
      )}
    </div>
  )
}
