import type { RefObject } from 'react'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import CoachMark from '@/components/shared/CoachMark'
import { HIDDEN_DIGITS, useAmountVisibility } from '@/context/amountVisibility'
import { TIP_KEYS, tipStorageKey } from '@/hooks/useOneTimeTip'

interface AmountsEyeTipProps {
  /** The eye button in the greeting row. */
  target: RefObject<HTMLButtonElement | null>
  /** Clerk user id (null = not known yet → not shown). */
  userId: string | null
  /** Dashboard has rendered its numbers and is in the user's own data. */
  enabled: boolean
  /** A sheet or the FAB menu is open. */
  blocked: boolean
}

/** "PKR ••••" → "PKR 2,500": what the eye does, in one glance. */
function EyeIllustration() {
  return (
    <div
      aria-hidden
      className="flex items-center justify-center gap-2.5 rounded-2xl bg-primary/8 border border-primary/15 px-3 py-3"
    >
      <span className="flex items-center gap-1.5 rounded-full bg-card border border-border/70 pl-1 pr-2.5 h-9 shadow-card">
        <span className="w-7 h-7 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
          <EyeOff size={16} />
        </span>
        <span className="text-[13px] font-bold text-muted-foreground tabular tracking-wide">PKR {HIDDEN_DIGITS}</span>
      </span>
      <ArrowRight size={16} className="text-primary shrink-0" />
      <span className="flex items-center gap-1.5 rounded-full bg-card border border-primary/30 pl-1 pr-2.5 h-9 shadow-card">
        <span className="w-7 h-7 rounded-full bg-gradient-brand text-brand-foreground flex items-center justify-center">
          <Eye size={16} />
        </span>
        <span className="text-[13px] font-bold text-foreground tabular">PKR 2,500</span>
      </span>
    </div>
  )
}

/** One-time walkthrough for the hide / show amounts eye button (dashboard only). */
export default function AmountsEyeTip({ target, userId, enabled, blocked }: AmountsEyeTipProps) {
  const { hidden } = useAmountVisibility()
  const storageKey = tipStorageKey(TIP_KEYS.amountsEye, userId)
  return (
    <CoachMark
      // A different user on this phone gets a fresh tip.
      key={storageKey ?? 'none'}
      storageKey={storageKey}
      enabled={enabled}
      blocked={blocked}
      target={target}
      illustration={<EyeIllustration />}
      title={hidden ? 'Your amounts are hidden' : 'Your amounts are showing'}
      body="Tap the eye to show or hide money amounts — handy when someone is looking at your phone."
      primaryLabel="Try it"
      tryHint="Now tap the eye"
      dismissLabel="Got it"
      success={hidden ? 'Nice! Tap again anytime to show.' : 'Nice! Tap again anytime to hide.'}
    />
  )
}
