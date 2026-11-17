import { CloudOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { OFFLINE_EDIT_MESSAGE } from '@/hooks/useCanEditOnline'

/** Small inline note above a write action that needs internet. */
export default function OfflineEditNote({ className }: { className?: string }) {
  return (
    <p
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-2xl bg-muted px-3.5 py-2.5 text-sm font-medium text-muted-foreground',
        className,
      )}
    >
      <CloudOff size={16} className="shrink-0 mt-0.5" aria-hidden />
      <span>{OFFLINE_EDIT_MESSAGE}</span>
    </p>
  )
}
