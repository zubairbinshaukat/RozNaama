import { ChevronDown, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'

export interface PeriodSwitcherProps {
  /** Big centre text, e.g. "Today", "This week", "November 2026", "2025". */
  label: string
  /** Optional small line under the label, e.g. the dates of "This week". */
  sublabel?: string
  /** What the picker chooses, for screen readers: "day", "week", "month", "year". */
  unit: string
  onPrev: () => void
  onNext: () => void
  prevDisabled?: boolean
  nextDisabled?: boolean
  onOpenPicker: () => void
  /** e.g. "Back to today"; shown only together with `onReset` (i.e. not on the current period). */
  resetLabel?: string
  onReset?: () => void
}

const arrowBtn =
  'w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center text-foreground hover:bg-muted active:scale-[0.97] transition-all disabled:opacity-30 disabled:pointer-events-none'

/**
 * ‹ label › period stepper. Arrows step one period (next is disabled on the
 * current one — no future), the label opens a picker sheet.
 */
export default function PeriodSwitcher({
  label,
  sublabel,
  unit,
  onPrev,
  onNext,
  prevDisabled = false,
  nextDisabled = false,
  onOpenPicker,
  resetLabel,
  onReset,
}: PeriodSwitcherProps) {
  const full = sublabel ? `${label}, ${sublabel}` : label
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        role="group"
        aria-label={`Choose ${unit}`}
        className="w-full flex items-center gap-1 rounded-3xl border border-border/70 bg-card shadow-card p-1"
      >
        <button
          type="button"
          onClick={onPrev}
          disabled={prevDisabled}
          aria-label={`Previous ${unit}`}
          className={arrowBtn}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          onClick={onOpenPicker}
          aria-haspopup="dialog"
          aria-label={`${full}. Pick another ${unit}`}
          className="flex-1 min-w-0 min-h-11 px-2 rounded-2xl flex flex-col items-center justify-center hover:bg-muted active:scale-[0.97] transition-all"
        >
          <span className="flex items-center gap-1 max-w-full text-base font-bold text-foreground tracking-tight">
            <span className="truncate">{label}</span>
            <ChevronDown size={16} className="shrink-0 text-muted-foreground" aria-hidden />
          </span>
          {sublabel && <span className="text-xs font-medium text-muted-foreground truncate max-w-full">{sublabel}</span>}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled}
          aria-label={`Next ${unit}`}
          className={arrowBtn}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <span className="sr-only" aria-live="polite">{full}</span>
      {resetLabel && onReset && (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 min-h-11 px-3.5 rounded-full text-sm font-semibold text-primary hover:bg-primary/10 active:scale-[0.97] transition-all"
        >
          <RotateCcw size={16} aria-hidden /> {resetLabel}
        </button>
      )}
    </div>
  )
}
