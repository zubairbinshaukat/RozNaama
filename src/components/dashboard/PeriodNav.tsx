import { useState } from 'react'
import PeriodSwitcher from '@/components/shared/PeriodSwitcher'
import DatePickerSheet from '@/components/shared/DatePickerSheet'
import { MonthPickerSheet, WeekPickerSheet, YearPickerSheet } from '@/components/shared/PeriodPickers'
import {
  canGoNext,
  canGoPrev,
  dayLabel,
  isCurrentPeriod,
  monthNameText,
  periodStart,
  shiftPeriod,
  shortDayText,
  weekLabel,
  weekRangeText,
  type PeriodKind,
} from '@/lib/period'
import { startOfDay } from '@/lib/utils'

interface StepNavProps {
  /** Start of the selected period (local midnight). */
  value: number
  onChange: (periodStartMs: number) => void
  now?: number
}

const RESET_LABEL: Record<PeriodKind, string> = {
  day:   'Back to today',
  week:  'Back to this week',
  month: 'Back to this month',
}

function useStep(kind: PeriodKind, { value, onChange, now = startOfDay() }: StepNavProps) {
  const current = isCurrentPeriod(kind, value, now)
  return {
    onPrev: () => onChange(shiftPeriod(kind, value, -1)),
    onNext: () => { if (canGoNext(kind, value, now)) onChange(shiftPeriod(kind, value, 1)) },
    prevDisabled: !canGoPrev(kind, value),
    nextDisabled: !canGoNext(kind, value, now),
    resetLabel: current ? undefined : RESET_LABEL[kind],
    onReset: current ? undefined : () => onChange(periodStart(kind, now)),
  }
}

export function DayNav(props: StepNavProps) {
  const [open, setOpen] = useState(false)
  const now = props.now ?? startOfDay()
  const step = useStep('day', props)
  const label = dayLabel(props.value, now)
  const relative = label === 'Today' || label === 'Yesterday'
  return (
    <>
      <PeriodSwitcher
        label={label}
        sublabel={relative ? shortDayText(props.value) : undefined}
        unit="day"
        onOpenPicker={() => setOpen(true)}
        {...step}
      />
      {open && (
        <DatePickerSheet
          title="Go to a day"
          value={props.value}
          onSelect={(ms) => props.onChange(periodStart('day', ms))}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

export function WeekNav(props: StepNavProps) {
  const [open, setOpen] = useState(false)
  const now = props.now ?? startOfDay()
  const step = useStep('week', props)
  const label = weekLabel(props.value, now)
  const range = weekRangeText(props.value, now)
  return (
    <>
      <PeriodSwitcher
        label={label}
        sublabel={label === range ? undefined : range}
        unit="week"
        onOpenPicker={() => setOpen(true)}
        {...step}
      />
      {open && (
        <WeekPickerSheet value={props.value} onSelect={props.onChange} onClose={() => setOpen(false)} now={now} />
      )}
    </>
  )
}

export function MonthNav(props: StepNavProps) {
  const [open, setOpen] = useState(false)
  const now = props.now ?? startOfDay()
  const step = useStep('month', props)
  return (
    <>
      <PeriodSwitcher
        label={monthNameText(props.value)}
        unit="month"
        onOpenPicker={() => setOpen(true)}
        {...step}
      />
      {open && (
        <MonthPickerSheet value={props.value} onSelect={props.onChange} onClose={() => setOpen(false)} now={now} />
      )}
    </>
  )
}

interface YearNavProps {
  value: number
  onChange: (year: number) => void
  /** Selectable years (from `getAvailableYears`); undefined while loading. */
  years: readonly number[] | undefined
  now?: number
}

/** Steps through the years that have data (gaps are skipped). */
export function YearNav({ value, onChange, years, now = startOfDay() }: YearNavProps) {
  const [open, setOpen] = useState(false)
  const currentYear = new Date(now).getFullYear()
  const list = [...new Set([currentYear, value, ...(years ?? [])])].sort((a, b) => b - a)
  const idx = list.indexOf(value)
  const older = list[idx + 1]
  const newer = idx > 0 ? list[idx - 1] : undefined
  const isCurrent = value === currentYear
  return (
    <>
      <PeriodSwitcher
        label={String(value)}
        unit="year"
        onPrev={() => { if (older !== undefined) onChange(older) }}
        onNext={() => { if (newer !== undefined) onChange(newer) }}
        prevDisabled={older === undefined}
        nextDisabled={newer === undefined}
        onOpenPicker={() => setOpen(true)}
        resetLabel={isCurrent ? undefined : 'Back to this year'}
        onReset={isCurrent ? undefined : () => onChange(currentYear)}
      />
      {open && (
        <YearPickerSheet value={value} years={list} onSelect={onChange} onClose={() => setOpen(false)} now={now} />
      )}
    </>
  )
}
