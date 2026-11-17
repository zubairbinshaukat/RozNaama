import { useId, useState } from 'react'
import { useQuery } from 'convex/react'
import { Users, Shield, ChevronRight, ArrowLeft } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useViewAs } from '@/context/ViewAsContext'
import { useToast } from '@/components/shared/Toast'
import QueryErrorBoundary from '@/components/shared/QueryErrorBoundary'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import { cn } from '@/lib/utils'
import { btnOutline } from '@/lib/ui'

/** Separate component so a failing `listForAdmin` query is caught by the boundary around it. */
function AdminUserList({ onSelect, currentId }: { onSelect: (id: Id<'users'>, name: string) => void; currentId: Id<'users'> | null }) {
  const users = useQuery(api.users.listForAdmin, {})

  if (users === undefined) {
    return (
      <div className="flex flex-col gap-2" aria-hidden>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 rounded-2xl skeleton" />
        ))}
      </div>
    )
  }

  if (users.length === 0) {
    return <p className="text-base text-muted-foreground text-center py-8">No users yet.</p>
  }

  return (
    <ul className="flex flex-col gap-2">
      {users.map((u) => {
        const current = u._id === currentId
        return (
          <li key={u._id}>
            <button
              type="button"
              onClick={() => onSelect(u._id, u.name)}
              aria-current={current ? 'true' : undefined}
              className={cn(
                'w-full flex items-center gap-3 text-left rounded-2xl border bg-card px-4 min-h-16 py-3',
                'hover:bg-muted/50 active:scale-[0.97] transition-all duration-150',
                current ? 'border-primary/50 bg-primary/5' : 'border-border/70',
              )}
            >
              <span className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-base font-bold" aria-hidden>
                {u.name.trim().charAt(0).toUpperCase() || '?'}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-base font-semibold text-foreground truncate">{u.name}</span>
                <span className="block text-[13px] text-muted-foreground truncate">{u.email}</span>
              </span>
              <ChevronRight size={16} className="text-muted-foreground shrink-0" aria-hidden />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export default function AdminAccessDialog() {
  const { isAdmin, viewAsName, viewAsUserId, isViewingOther, clearViewAs, setViewAs } = useViewAs()
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const titleId = useId()

  if (!isAdmin) return null

  const buttonLabel = isViewingOther && viewAsName ? viewAsName : 'Access'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'shrink-0 inline-flex items-center gap-1.5 min-h-11 px-4 rounded-2xl text-sm font-semibold',
          'bg-primary/10 text-primary border border-primary/25',
          'hover:bg-primary/15 active:scale-[0.97] transition-all duration-150',
          isViewingOther && 'border-border/70 bg-muted text-foreground hover:bg-muted/70',
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Shield size={16} strokeWidth={2} className="shrink-0" aria-hidden />
        <span className="max-w-[9rem] sm:max-w-[14rem] truncate">{buttonLabel}</span>
      </button>

      {open && (
        <Sheet onClose={() => setOpen(false)} labelledBy={titleId} size="lg">
          <SheetHeader
            titleId={titleId}
            title="User access"
            subtitle="View another account's dashboard (read-only)"
            icon={<Users size={18} />}
            onClose={() => setOpen(false)}
          />
          <SheetBody>
            <QueryErrorBoundary fallbackMessage="Couldn't load users">
              <AdminUserList
                currentId={viewAsUserId}
                onSelect={(id, name) => {
                  setViewAs(id, name)
                  setOpen(false)
                  showToast(`Now viewing ${name}'s data (read-only)`, 'info')
                }}
              />
            </QueryErrorBoundary>
          </SheetBody>

          {isViewingOther && (
            <SheetFooter>
              <button
                type="button"
                onClick={() => {
                  clearViewAs()
                  setOpen(false)
                  showToast('Back to your own data', 'info')
                }}
                className={cn(btnOutline, 'w-full')}
              >
                <ArrowLeft size={18} /> View my data
              </button>
            </SheetFooter>
          )}
        </Sheet>
      )}
    </>
  )
}
