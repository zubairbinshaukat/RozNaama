import { useEffect, useId, useState } from 'react'
import { AlertCircle, CalendarDays, Clock, CloudOff, Loader2, RotateCw, Tag, Trash2 } from 'lucide-react'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import Amount from '@/components/shared/Amount'
import { useToast } from '@/components/shared/Toast'
import { useFormatMoney } from '@/context/amountVisibility'
import { useOutbox } from '@/hooks/useOutbox'
import { cn, formatDate, formatTime } from '@/lib/utils'
import { btnDangerGhost, btnOutline, btnPrimary, btnSecondary } from '@/lib/ui'
import { entryDateMs, entryExpenseTotal, entrySalesTotal } from '@/lib/offline/types'
import { pendingCategoryName, pendingEntryTitle } from '@/lib/pendingEntries'
import type { Category } from '@/hooks/useCategories'
import ConfirmModal from './ConfirmModal'
import { DetailRow } from './SaleDetailModal'

interface PendingEntrySheetProps {
  /** Synthetic row id (`pending:<entryId>[:<i>]`) or the outbox entry id. */
  rowId:      string
  categories: Category[]
  onClose:    () => void
}

type Fix = { label: string; run: (id: string) => Promise<void> }

/**
 * Tap a "Waiting to sync" row → this sheet: what is waiting, why, and what
 * the owner can do (fix, try again, or discard). Edits wait until it syncs.
 */
export default function PendingEntrySheet({ rowId, categories, onClose }: PendingEntrySheetProps) {
  const titleId = useId()
  const { getEntry, isSending, discard, fixSaveForToday, fixWithoutCategory, retryEntry } = useOutbox()
  const { showToast } = useToast()
  const money = useFormatMoney()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const entry = getEntry(rowId)

  // Synced (or discarded in another tab) while open: nothing left to show.
  useEffect(() => {
    if (!entry && !busy) onClose()
  }, [entry, busy, onClose])

  if (!entry) return null

  const sending = isSending(entry.id)
  const needsFix = entry.status === 'needsAttention'
  const reason = entry.lastError?.reason
  const fix: Fix | null = !needsFix
    ? null
    : reason === 'clock'
      ? { label: 'Save for today', run: fixSaveForToday }
      : reason === 'notFound'
        ? { label: 'Save without category', run: fixWithoutCategory }
        : null
  const total = entry.kind === 'sale' ? entrySalesTotal(entry) : entryExpenseTotal(entry)
  const title = pendingEntryTitle(entry)
  const singleItem = entry.kind === 'sale' && entry.args.items.length === 1 ? entry.args.items[0] : undefined
  const singleCategory = singleItem ? pendingCategoryName(entry, singleItem.categoryId, categories) : undefined

  const act = async (run: () => Promise<void>, success: string, after?: () => void) => {
    setBusy(true)
    try {
      await run()
      showToast(success, 'success')
      after?.()
    } catch (e) {
      showToast(e instanceof Error && e.message ? e.message : 'Something went wrong. Try again.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const onDiscard = () =>
    act(() => discard(entry.id), 'Entry discarded', () => {
      setConfirming(false)
      onClose()
    })

  return (
    <>
      <Sheet onClose={onClose} dismissible={!busy} labelledBy={titleId} layer={520}>
        <SheetHeader
          titleId={titleId}
          title={<span className="wrap-break-word">{title}</span>}
          subtitle={entry.kind === 'sale' ? 'Sale · not synced yet' : 'Expense · not synced yet'}
          icon={<CloudOff size={18} />}
          iconClassName="bg-muted text-muted-foreground"
          onClose={onClose}
          closeDisabled={busy}
        />
        <SheetBody className="flex flex-col gap-4">
          <div
            role="status"
            className={cn(
              'flex items-start gap-2.5 rounded-2xl px-4 py-3 text-[15px] font-medium',
              needsFix ? 'bg-warning/10 text-foreground border border-warning/40' : 'bg-muted text-muted-foreground',
            )}
          >
            {needsFix
              ? <AlertCircle size={18} className="shrink-0 mt-0.5 text-warning" aria-hidden />
              : sending
                ? <Loader2 size={18} className="shrink-0 mt-0.5 animate-[spin_1s_linear_infinite]" aria-hidden />
                : <CloudOff size={18} className="shrink-0 mt-0.5" aria-hidden />}
            <span>
              {needsFix
                ? entry.lastError?.message || 'This entry could not be synced.'
                : sending
                  ? 'Syncing now…'
                  : 'Saved on this phone. It will sync by itself when you are online.'}
            </span>
          </div>

          <div className={cn('rounded-3xl px-5 py-4', entry.kind === 'expense' ? 'bg-negative/8' : 'bg-muted/50')}>
            <p className="text-sm font-semibold text-muted-foreground">
              {entry.kind === 'expense' ? 'Amount spent' : 'Amount'}
            </p>
            <p
              className={cn(
                'text-[2rem] font-bold tabular tracking-tight leading-tight',
                entry.kind === 'expense' ? 'text-negative' : 'text-foreground',
              )}
            >
              <Amount value={total} />
            </p>
          </div>

          {entry.kind === 'sale' && entry.args.items.length > 1 && (
            <ul className="flex flex-col divide-y divide-border/60 rounded-3xl border border-border/70" aria-label="Items">
              {entry.args.items.map((item, i) => {
                const cat = pendingCategoryName(entry, item.categoryId, categories)
                return (
                  <li key={i} className="flex items-center gap-3 px-4 py-3">
                    <span className="flex-1 min-w-0">
                      <span className="block text-base font-semibold text-foreground truncate">{item.productName}</span>
                      <span className="block text-[13px] text-muted-foreground truncate">{cat ?? 'No category'}</span>
                    </span>
                    <Amount value={item.amount} className="text-base font-bold text-foreground shrink-0" />
                  </li>
                )
              })}
            </ul>
          )}

          <dl className="flex flex-col divide-y divide-border/60 rounded-3xl border border-border/70">
            <DetailRow icon={<CalendarDays size={18} />} label="Date">{formatDate(entryDateMs(entry))}</DetailRow>
            <DetailRow icon={<Clock size={18} />} label="Saved at">{formatTime(entry.createdAt)}</DetailRow>
            {singleItem && (
              <DetailRow icon={<Tag size={18} />} label="Category">
                {singleCategory ?? <span className="text-muted-foreground">No category</span>}
              </DetailRow>
            )}
          </dl>
        </SheetBody>

        <SheetFooter>
          <div className="flex flex-col gap-3">
            {fix && (
              <button
                type="button"
                disabled={busy || sending}
                onClick={() => act(() => fix.run(entry.id), 'Fixed — syncing now', onClose)}
                className={cn(btnPrimary, 'w-full')}
              >
                {fix.label}
              </button>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                disabled={busy || sending}
                onClick={() => setConfirming(true)}
                className={cn(btnDangerGhost, 'flex-1')}
              >
                <Trash2 size={18} /> Discard
              </button>
              {needsFix ? (
                <button
                  type="button"
                  disabled={busy || sending}
                  onClick={() => act(() => retryEntry(entry.id), 'Trying again…')}
                  className={cn(btnOutline, 'flex-1')}
                >
                  {busy
                    ? <Loader2 size={18} className="animate-[spin_1s_linear_infinite]" />
                    : <RotateCw size={18} />}
                  Try again
                </button>
              ) : (
                <button type="button" onClick={onClose} disabled={busy} className={cn(btnSecondary, 'flex-1')}>
                  Close
                </button>
              )}
            </div>
          </div>
        </SheetFooter>
      </Sheet>

      {confirming && (
        <ConfirmModal
          title="Discard entry?"
          message={`"${title}" (${money(total)}) has not synced. Discarding removes it from this phone.`}
          confirmLabel="Discard"
          destructive
          loading={busy}
          onConfirm={onDiscard}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  )
}
