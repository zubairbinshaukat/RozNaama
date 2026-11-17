import { CloudOff, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useNetworkStatus } from '@/lib/network'
import { useDataFreshness } from '@/hooks/useDataFreshness'

/**
 * Tiny muted chip saying how fresh the numbers are. Hidden while live.
 * - snapshot mode, online: "Updating…" (session is being checked);
 * - otherwise: "Offline · last updated 2:45 PM".
 */
export default function DataFreshnessChip({ className }: { className?: string }) {
  const { mode, label } = useDataFreshness()
  const { isOffline } = useNetworkStatus()
  if (mode === 'live') return null

  const updating = mode === 'snapshot' && !isOffline
  const text = updating
    ? 'Updating…'
    : label
      ? `Offline · ${label.charAt(0).toLowerCase()}${label.slice(1)}`
      : 'Offline'

  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[12px] font-semibold text-muted-foreground',
        className,
      )}
    >
      {updating
        ? <Loader2 size={14} className="animate-[spin_1s_linear_infinite]" aria-hidden />
        : <CloudOff size={14} aria-hidden />}
      {text}
    </span>
  )
}
