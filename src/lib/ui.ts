/**
 * Shared Tailwind class recipes so every sheet, form and card uses the same
 * sizes (≥ 48px tap targets, 16px inputs) and press feedback.
 */

const pressable = 'active:scale-[0.97] transition-all duration-150 disabled:opacity-55 disabled:pointer-events-none'

/** The one primary action on a surface. */
export const btnPrimary =
  `inline-flex items-center justify-center gap-2 min-h-12 px-5 rounded-2xl bg-gradient-brand text-brand-foreground text-base font-semibold shadow-glow-md hover:brightness-105 ${pressable}`

/** Neutral secondary action (Cancel, Close, Done). */
export const btnSecondary =
  `inline-flex items-center justify-center gap-2 min-h-12 px-5 rounded-2xl bg-muted text-foreground text-base font-semibold hover:bg-muted/70 ${pressable}`

/** Outlined action that sits next to a primary one (Edit). */
export const btnOutline =
  `inline-flex items-center justify-center gap-2 min-h-12 px-5 rounded-2xl border border-border bg-card text-foreground text-base font-semibold hover:bg-muted/60 ${pressable}`

/** Destructive confirm (Delete). */
export const btnDanger =
  `inline-flex items-center justify-center gap-2 min-h-12 px-5 rounded-2xl bg-destructive text-destructive-foreground text-base font-semibold hover:brightness-110 ${pressable}`

/** Quiet destructive entry point (opens a confirm). */
export const btnDangerGhost =
  `inline-flex items-center justify-center gap-2 min-h-12 px-5 rounded-2xl border border-negative/30 text-negative text-base font-semibold hover:bg-negative/10 ${pressable}`

/** Text inputs: 16px (no iOS zoom), 48px tall. */
export const inputBase =
  'w-full min-h-12 px-4 rounded-2xl border border-input bg-background text-base font-medium text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-ring/60 focus:border-transparent transition-shadow disabled:opacity-50'

export const inputInvalid = 'border-negative focus:ring-negative/40'

export const fieldLabel = 'text-sm font-semibold text-foreground'

export const fieldHint = 'text-[13px] text-muted-foreground'

export const fieldError = 'flex items-center gap-1.5 text-sm font-medium text-negative'

/** Pill chip (quick amounts, quick dates). */
export const chip =
  'inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-full border text-sm font-semibold whitespace-nowrap active:scale-[0.97] transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none'

export const chipIdle = 'border-border bg-card text-foreground hover:bg-muted/70'

export const chipActive = 'border-transparent bg-primary text-primary-foreground'
