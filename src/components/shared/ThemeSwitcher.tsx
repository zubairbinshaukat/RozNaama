import { useState, useRef, useEffect } from 'react'
import { Palette, Check } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { THEME_LABELS, THEME_ACCENT_COLORS, THEME_IS_DARK, type Theme } from '@/lib/constants'
import { cn } from '@/lib/utils'

interface ThemeSwitcherProps {
  className?: string
}

export default function ThemeSwitcher({ className }: ThemeSwitcherProps) {
  const { theme, setTheme, themes } = useTheme()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click
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

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const handleSelect = (t: Theme) => {
    setTheme(t)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Trigger button */}
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

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-card border border-border rounded-xl shadow-xl z-200 overflow-hidden animate-modal-content">
          <div className="px-3 pt-3 pb-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Theme</p>
          </div>
          <div className="px-2 pb-2 flex flex-col gap-0.5">
            {themes.map((t) => (
              <button
                key={t}
                onClick={() => handleSelect(t)}
                className={cn(
                  'w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-all duration-150',
                  'hover:bg-muted active:scale-[0.98]',
                  t === theme
                    ? 'bg-primary/10 text-foreground font-medium'
                    : 'text-muted-foreground',
                )}
              >
                {/* Color swatch */}
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
                {t === theme && <Check size={14} className="text-primary shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
