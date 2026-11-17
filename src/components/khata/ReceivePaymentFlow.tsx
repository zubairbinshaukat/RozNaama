import { useId, useState } from 'react'
import { HandCoins } from 'lucide-react'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import { useCustomerDetail } from '@/hooks/useKhata'
import { btnSecondary } from '@/lib/ui'
import { cn } from '@/lib/utils'
import type { Id } from '../../../convex/_generated/dataModel'
import CustomerPicker from './CustomerPicker'
import ReceivePaymentSheet from './ReceivePaymentSheet'
import { ChooseEntrySheet } from './CustomerSheet'
import { toTarget, type EntryTarget } from './model'
import type { PickedCustomer } from './customer'

/** FAB "Receive payment": customer with open records → (which record) → payment sheet. */
export default function ReceivePaymentFlow({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const [picked, setPicked] = useState<PickedCustomer | null>(null)
  const customerId: Id<'customers'> | null = picked?.kind === 'existing' ? picked.id : null
  const detail = useCustomerDetail(customerId)
  const [target, setTarget] = useState<EntryTarget | null>(null)
  const open = (detail?.entries ?? []).filter((e) => e.status === 'booked' || e.status === 'due')
  const only = open.length === 1 ? open[0] : undefined
  const customerName = detail?.customer.name ?? ''

  const chosen = target ?? (only ? toTarget(only, customerName) : null)
  if (chosen) return <ReceivePaymentSheet target={chosen} onClose={onClose} />
  if (customerId && detail && open.length > 1) {
    return (
      <ChooseEntrySheet
        entries={open}
        onClose={onClose}
        onPick={(e) => setTarget(toTarget(e, customerName))}
      />
    )
  }

  return (
    <Sheet onClose={onClose} labelledBy={titleId}>
      <SheetHeader titleId={titleId} title="Receive payment" subtitle="Who paid?" icon={<HandCoins size={18} />} onClose={onClose} />
      <SheetBody className="flex flex-col gap-4">
        <CustomerPicker value={picked} onChange={setPicked} openOnly />
        {customerId && detail === undefined && <div className="skeleton h-14 rounded-2xl" aria-hidden />}
        {customerId && detail && open.length === 0 && (
          <p className="text-[15px] text-muted-foreground">{customerName} has nothing open.</p>
        )}
      </SheetBody>
      <SheetFooter>
        <button type="button" onClick={onClose} className={cn(btnSecondary, 'w-full')}>Cancel</button>
      </SheetFooter>
    </Sheet>
  )
}
