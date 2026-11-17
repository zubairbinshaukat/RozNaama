import { useEffect, useId, useState } from 'react'
import { AlertCircle, CalendarDays, Clock, CloudOff, Loader2, RotateCw, Tag, Trash2, User } from 'lucide-react'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import Amount from '@/components/shared/Amount'
import AmountInput from '@/components/shared/AmountInput'
import { useToast } from '@/components/shared/Toast'
import { useFormatMoney } from '@/context/amountVisibility'
import { useOutbox } from '@/hooks/useOutbox'
import { cn, formatDate, formatTime } from '@/lib/utils'
import { btnDangerGhost, btnOutline, btnPrimary, btnSecondary, fieldError, fieldLabel } from '@/lib/ui'
import { checkAmount } from '@/lib/amount'
import { NO_NAME, parseMoreThanBaqi, toPaisa } from '@/lib/khata'
import { entryAmount, entryDateMs, isKhataEntry, type OutboxEntry } from '@/lib/offline/types'
import { pendingCategoryName, pendingEntryKindLabel, pendingEntryTitle } from '@/lib/pendingEntries'
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

function itemsOf(entry: OutboxEntry) {
  return entry.kind === 'sale' || entry.kind === 'khataSale' ? entry.args.items : []
}

/**
 * Tap a "Waiting to sync" row → this sheet: what is waiting, why, and what
 * the owner can do (fix, try again, or discard). Edits wait until it syncs.
 */
export default function PendingEntrySheet({ rowId, categories, onClose }: PendingEntrySheetProps) {
  const titleId = useId()
  const amountId = useId()
  const { getEntry, isSending, discard, fixSaveForToday, fixWithoutCategory, fixPaymentAmount, retryEntry } = useOutbox()
  const { showToast } = useToast()
  const money = useFormatMoney()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  /** "Change amount" for a payment over the Baqi: the typed amount, null while closed. */
  const [newAmount, setNewAmount] = useState<string | null>(null)
  const [amountError, setAmountError] = useState<string | null>(null)
  const entry = getEntry(rowId)

  // Synced (or discarded in another tab) while open: nothing left to show.
  useEffect(() => {
    if (!entry && !busy) onClose()
  }, [entry, busy, onClose])

  if (!entry) return null

  const sending = isSending(entry.id)
  const needsFix = entry.status === 'needsAttention'
  const reason = entry.lastError?.reason
  const items = itemsOf(entry)
  const hasCategories = items.some((i) => i.categoryId !== undefined)
  const khata = isKhataEntry(entry) ? entry.khata : null
  const baqiNow = needsFix && entry.kind === 'khataPayment' ? parseMoreThanBaqi(entry.lastError?.message) : null
  const fix: Fix | null = !needsFix
    ? null
    : reason === 'clock'
      ? { label: 'Save for today', run: fixSaveForToday }
      : reason === 'notFound' && (entry.kind === 'sale' || hasCategories)
        ? { label: 'Save without category', run: fixWithoutCategory }
        : null
  const total = entryAmount(entry)
  const title = pendingEntryTitle(entry)
  const singleItem = items.length === 1 ? items[0] : undefined
  const singleCategory = singleItem ? pendingCategoryName(entry, singleItem.categoryId, categories) : undefined
  const problemText = baqiNow !== null && khata
    ? `${khata.customerName?.trim() ? `${khata.customerName.trim()}'s Baqi` : 'Baqi'} is now ${money(baqiNow)}`
    : entry.lastError?.message || 'This entry could not be synced.'

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

  const saveNewAmount = () => {
    if (newAmount === null) return
    const check = checkAmount(newAmount)
    if (!check.ok) { setAmountError(check.message); return }
    if (baqiNow !== null && toPaisa(check.value) > toPaisa(baqiNow)) {
      setAmountError(`More than Baqi (${money(baqiNow)})`)
      return
    }
    void act(() => fixPaymentAmount(entry.id, check.value), 'Fixed — syncing now', onClose)
  }

  return (
    <>
      <Sheet onClose={onClose} dismissible={!busy} labelledBy={titleId} layer={520}>
        <SheetHeader
          titleId={titleId}
          title={<span className="wrap-break-word">{title}</span>}
          subtitle={`${pendingEntryKindLabel(entry)} · not synced yet`}
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
                ? problemText
                : sending
                  ? 'Syncing now…'
                  : 'Saved on this phone. It will sync by itself when you are online.'}
            </span>
          </div>

          <div className={cn('rounded-3xl px-5 py-4', entry.kind === 'expense' ? 'bg-negative/8' : 'bg-muted/50')}>
            <p className="text-sm font-semibold text-muted-foreground">
              {entry.kind === 'expense' ? 'Amount spent'
                : entry.kind === 'khataPayment' ? 'Received'
                  : entry.kind === 'khataAdvance' ? 'Advance' : 'Amount'}
            </p>
            <p
              className={cn(
                'text-[2rem] font-bold tabular tracking-tight leading-tight',
                entry.kind === 'expense' ? 'text-negative' : 'text-foreground',
              )}
            >
              <Amount value={total} />
            </p>
            {entry.kind === 'khataSale' && (
              <p className="text-[15px] font-semibold text-negative mt-1">
                Baqi: <Amount value={Math.max(0, total - entry.args.receivedNow)} />
              </p>
            )}
          </div>

          {newAmount !== null && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={amountId} className={fieldLabel}>New amount</label>
              <AmountInput
                id={amountId}
                value={newAmount}
                onChange={(v) => { setNewAmount(v); setAmountError(null) }}
                invalid={amountError !== null}
                disabled={busy}
                quickAmounts={baqiNow !== null && baqiNow > 0 ? [baqiNow] : undefined}
              />
              {amountError && (
                <p className={fieldError} role="alert"><AlertCircle size={16} /> {amountError}</p>
              )}
            </div>
          )}

          {items.length > 1 && (
            <ul className="flex flex-col divide-y divide-border/60 rounded-3xl border border-border/70" aria-label="Items">
              {items.map((item, i) => {
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
            {khata && (
              <DetailRow icon={<User size={18} />} label="Customer">
                {khata.customerName?.trim() || <span className="text-muted-foreground">{NO_NAME}</span>}
              </DetailRow>
            )}
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
            {baqiNow !== null && (
              newAmount === null ? (
                <button
                  type="button"
                  disabled={busy || sending}
                  onClick={() => setNewAmount(String(baqiNow))}
                  className={cn(btnPrimary, 'w-full')}
                >
                  Change amount
                </button>
              ) : (
                <button type="button" disabled={busy || sending} onClick={saveNewAmount} className={cn(btnPrimary, 'w-full')}>
                  {busy && <Loader2 size={18} className="animate-[spin_1s_linear_infinite]" />} Save new amount
                </button>
              )
            )}
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
