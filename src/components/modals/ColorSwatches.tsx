import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CATEGORY_COLORS } from '@/lib/constants'

const COLOR_NAMES: Record<string, string> = {
  '#6366F1': 'Indigo',
  '#8B5CF6': 'Violet',
  '#EC4899': 'Pink',
  '#EF4444': 'Red',
  '#F97316': 'Orange',
  '#EAB308': 'Yellow',
  '#22C55E': 'Green',
  '#06B6D4': 'Cyan',
}

/** 44px colour radio group (arrow keys move between colours). */
export default function ColorSwatches({
  value,
  onChange,
  labelledBy,
  disabled = false,
}: {
  value: string
  onChange: (color: string) => void
  labelledBy: string
  disabled?: boolean
}) {
  const current = CATEGORY_COLORS.findIndex((c) => c.toLowerCase() === value.toLowerCase())

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (delta === 0) return
    e.preventDefault()
    const next = CATEGORY_COLORS[(Math.max(current, 0) + delta + CATEGORY_COLORS.length) % CATEGORY_COLORS.length]!
    onChange(next)
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-color="${next}"]`)?.focus()
  }

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} onKeyDown={onKeyDown} className="flex flex-wrap gap-2.5">
      {CATEGORY_COLORS.map((c, i) => {
        const active = i === current
        return (
          <button
            key={c}
            type="button"
            role="radio"
            data-color={c}
            aria-checked={active}
            aria-label={COLOR_NAMES[c] ?? c}
            tabIndex={active || (current === -1 && i === 0) ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(c)}
            className={cn(
              'w-11 h-11 rounded-full flex items-center justify-center transition-all duration-150 active:scale-[0.97]',
              active ? 'ring-[3px] ring-offset-2 ring-offset-card' : 'opacity-80 hover:opacity-100',
            )}
            style={{ backgroundColor: c, ['--tw-ring-color' as string]: c }}
          >
            {active && <Check size={18} className="text-white drop-shadow" strokeWidth={3} aria-hidden />}
          </button>
        )
      })}
    </div>
  )
}
