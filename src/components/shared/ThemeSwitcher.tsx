import { useState, useRef, useEffect } from 'react'
import { Palette, Check, Shuffle } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { THEME_LABELS, THEME_ACCENT_COLORS, THEME_IS_DARK, type ThemePreference } from '@/lib/constants'
import { cn } from '@/lib/utils'

interface ThemeSwitcherProps {
  className?: string
}

export default function ThemeSwitcher({ className }: ThemeSwitcherProps) {
  const { preference, setTheme, themes } = useTheme()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const handleSelect = (t: ThemePreference) => {
    setTheme(t)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        onClick={() => setOpen((p) => !p)}
        aria-label="Change theme"
        aria-expanded={open}
        className={cn(
          'p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted',
          'active:scale-95 transition-all duration-150',
          open && 'bg-muted text-foreground',
        )}
      >
        <Palette size={18} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-card border border-border rounded-xl shadow-xl z-200 overflow-hidden animate-modal-content">
          <div className="px-3 pt-3 pb-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Theme</p>
          </div>
          <div className="px-2 pb-2 flex flex-col gap-0.5">
            {themes.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => handleSelect(t)}
                className={cn(
                  'w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-all duration-150',
                  'hover:bg-muted active:scale-[0.98]',
                  t === preference
                    ? 'bg-primary/10 text-foreground font-medium'
                    : 'text-muted-foreground',
                )}
              >
                <span
                  className="w-5 h-5 rounded-full shrink-0 ring-2 ring-border"
                  style={{
                    backgroundColor: THEME_ACCENT_COLORS[t],
                    boxShadow: THEME_IS_DARK[t]
                      ? 'inset 0 0 0 2px rgba(0,0,0,0.3)'
                      : 'inset 0 0 0 2px rgba(255,255,255,0.2)',
                  }}
                />
                <span className="flex-1 text-left">{THEME_LABELS[t]}</span>
                {t === preference && <Check size={14} className="text-primary shrink-0" />}
              </button>
            ))}
            <button
              type="button"
              onClick={() => handleSelect('random')}
              className={cn(
                'w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-all duration-150',
                'hover:bg-muted active:scale-[0.98]',
                preference === 'random'
                  ? 'bg-primary/10 text-foreground font-medium'
                  : 'text-muted-foreground',
              )}
            >
              <span
                className="w-5 h-5 rounded-full shrink-0 ring-2 ring-border bg-primary/20 flex items-center justify-center"
                aria-hidden
              >
                <Shuffle size={12} className="text-primary" />
              </span>
              <span className="flex-1 text-left">Random</span>
              {preference === 'random' && <Check size={14} className="text-primary shrink-0" />}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
