import { useId, useState } from 'react'
import { useClerk, useUser } from '@clerk/clerk-react'
import { CloudOff, LogOut, UserCog } from 'lucide-react'
import Sheet, { SheetBody, SheetHeader } from '@/components/shared/Sheet'
import ConfirmModal from '@/components/modals/ConfirmModal'
import { useToast } from '@/components/shared/Toast'
import { useOutbox } from '@/hooks/useOutbox'
import { useBrowserOnline } from '@/lib/network'
import { readLastUserHint } from '@/lib/userHints'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { btnOutline, btnSecondary } from '@/lib/ui'
import { unsyncedSignOutMessage } from '@/lib/pendingEntries'

/**
 * Avatar button → account sheet (Manage account / Sign out). Replaces Clerk's
 * UserButton so signing out with unsynced entries can be confirmed first.
 */
export default function AccountMenu() {
  const { user, isLoaded } = useUser()
  const clerk = useClerk()
  const online = useBrowserOnline()
  const { pendingCount } = useOutbox()
  const { showToast } = useToast()
  const titleId = useId()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const hint = user ? null : readLastUserHint()
  const name = user?.fullName?.trim() || user?.firstName || hint?.name || 'Account'
  const email = user?.primaryEmailAddress?.emailAddress
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  const canUseAccount = isLoaded && user != null && online

  const signOut = async () => {
    setConfirming(false)
    setOpen(false)
    try {
      await clerk.signOut({ redirectUrl: '/' })
    } catch (e) {
      showToast(getErrorMessage(e, 'Could not sign out. Check your internet and try again.'), 'error')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={pendingCount > 0 ? `Account, ${pendingCount} not synced` : 'Account'}
        className="relative w-11 h-11 flex items-center justify-center rounded-full active:scale-[0.97] transition-all"
      >
        {user?.imageUrl ? (
          <img src={user.imageUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
        ) : (
          <span className="w-9 h-9 rounded-full bg-primary/12 text-primary flex items-center justify-center text-base font-bold" aria-hidden>
            {initial}
          </span>
        )}
        {pendingCount > 0 && (
          <span
            className="absolute top-1 right-1 w-3 h-3 rounded-full bg-warning border-2 border-background"
            aria-hidden
            data-testid="account-pending-dot"
          />
        )}
      </button>

      {open && (
        <Sheet onClose={() => setOpen(false)} labelledBy={titleId} size="sm">
          <SheetHeader
            titleId={titleId}
            title={<span className="wrap-break-word">{name}</span>}
            subtitle={email}
            icon={<span className="text-base font-bold">{initial}</span>}
            onClose={() => setOpen(false)}
          />
          <SheetBody className="flex flex-col gap-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            {pendingCount > 0 && (
              <p role="status" className="flex items-start gap-2 rounded-2xl bg-warning/10 border border-warning/40 px-3.5 py-2.5 text-sm font-medium text-foreground">
                <CloudOff size={16} className="shrink-0 mt-0.5 text-warning" aria-hidden />
                {pendingCount === 1 ? '1 entry is waiting to sync.' : `${pendingCount} entries are waiting to sync.`}
              </p>
            )}
            {!canUseAccount && (
              <p className="flex items-start gap-2 rounded-2xl bg-muted px-3.5 py-2.5 text-sm font-medium text-muted-foreground">
                <CloudOff size={16} className="shrink-0 mt-0.5" aria-hidden />
                Connect to the internet to manage your account or sign out.
              </p>
            )}
            <button
              type="button"
              disabled={!canUseAccount}
              onClick={() => {
                setOpen(false)
                clerk.openUserProfile()
              }}
              className={cn(btnOutline, 'w-full justify-start')}
            >
              <UserCog size={18} /> Manage account
            </button>
            <button
              type="button"
              disabled={!canUseAccount}
              onClick={() => (pendingCount > 0 ? setConfirming(true) : void signOut())}
              className={cn(btnSecondary, 'w-full justify-start')}
            >
              <LogOut size={18} /> Sign out
            </button>
          </SheetBody>
        </Sheet>
      )}

      {confirming && (
        <ConfirmModal
          title="Sign out?"
          message={unsyncedSignOutMessage(pendingCount)}
          confirmLabel="Sign out"
          onConfirm={() => void signOut()}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  )
}
