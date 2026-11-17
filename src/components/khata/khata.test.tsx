import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/shared/Toast'
import { ShopSettingsContext, type ShopSettingsContextValue } from '@/hooks/useShopSettings'
import { DEFAULT_SHOP_SETTINGS, type KhataCustomer, type KhataCustomerDetail, type KhataOpenRow } from '@/lib/khata'
import { buildEntry } from '@/hooks/useSubmitEntry'
import type { OutboxEntry } from '@/lib/offline/types'
import type { Id } from '../../../convex/_generated/dataModel'
import FAB from '@/components/shared/FAB'
import AddSaleModal from '@/components/modals/AddSaleModal'
import PendingEntrySheet from '@/components/modals/PendingEntrySheet'
import SettingsSheet from '@/components/dashboard/SettingsSheet'
import Khata from '@/pages/Khata'
import ReceivePaymentSheet from './ReceivePaymentSheet'
import CompleteOrderSheet from './CompleteOrderSheet'
import CustomerSheet from './CustomerSheet'
import type { EntryTarget } from './model'
import AdvanceSheet from './AdvanceSheet'
import EntrySheet from './EntrySheet'
import ReceivePaymentFlow from './ReceivePaymentFlow'
import { badgeText } from './badgeContext'
import type { KhataBadge, KhataEntryDetail } from '@/lib/khata'

const m = vi.hoisted(() => ({
  viewAs: false,
  offline: false,
  submitSale: vi.fn(),
  submitKhataSale: vi.fn(),
  submitPayment: vi.fn(),
  submitAdvance: vi.fn(),
  completeAdvance: vi.fn(),
  updateSettings: vi.fn(),
  fixPaymentAmount: vi.fn(async () => {}),
  customers: [] as unknown[],
  detail: undefined as unknown,
  entryDetail: undefined as unknown,
  setEntryCustomer: vi.fn(),
  totals: undefined as unknown,
  openRows: { due: [] as unknown[], booked: [] as unknown[] },
  pending: [] as unknown[],
  outboxEntries: [] as unknown[],
}))

vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({ user: { id: 'user_a', fullName: 'Khan Store' }, isSignedIn: true, isLoaded: true }),
}))
vi.mock('@/lib/network', () => ({
  useNetworkStatus: () => ({ isOffline: m.offline, browserOnline: !m.offline }),
  useBrowserOnline: () => !m.offline,
}))
vi.mock('@/context/ViewAsContext', () => ({
  useIsViewingOtherSafe: () => m.viewAs,
  useViewAsUserIdForQuery: () => undefined,
  useViewAs: () => ({ isViewingOther: m.viewAs, viewAsName: m.viewAs ? 'Bilal' : null }),
}))
vi.mock('@/hooks/useCategories', () => ({ useCategories: () => [] }))
vi.mock('@/hooks/useSubmitEntry', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useSubmitEntry')>()),
  useSubmitEntry: () => ({
    submitSale: m.submitSale, submitExpense: vi.fn(), submitKhataSale: m.submitKhataSale,
    submitPayment: m.submitPayment, submitAdvance: m.submitAdvance,
  }),
}))
vi.mock('@/hooks/useOutbox', () => ({
  useOutbox: () => ({
    entries: m.outboxEntries, pendingCount: m.outboxEntries.length, needsAttentionCount: 0, paused: null, loaded: true,
    isSending: () => false,
    getEntry: (id: string) => (m.outboxEntries as OutboxEntry[]).find((e) => e.id === id.replace(/^pending:/, '').split(':')[0]),
    discard: vi.fn(), fixSaveForToday: vi.fn(), fixWithoutCategory: vi.fn(), fixPaymentAmount: m.fixPaymentAmount,
    retryNow: vi.fn(), retryEntry: vi.fn(),
  }),
}))
vi.mock('@/hooks/useKhata', () => ({
  useCustomerSearch: () => m.customers,
  useCustomerDetail: (id: string | null) => (id ? m.detail : undefined),
  useEntryDetail: (id: string | null) => (id ? m.entryDetail : undefined),
  useKhataTotals: () => m.totals,
  useKhataOpenList: (segment: 'due' | 'booked') => ({
    results: m.openRows[segment], status: 'Exhausted', loadMore: vi.fn(), isLoading: false,
  }),
  usePendingKhata: () => m.pending,
  useKhataReceivedInRange: () => ({ total: 0, count: 0, capped: false }),
  useKhataBadges: () => undefined,
  useKhataActions: () => ({
    completeAdvance: m.completeAdvance, cancelAdvance: vi.fn(), forgiveRemaining: vi.fn(), updateEntry: vi.fn(),
    removePayment: vi.fn(), removeEntry: vi.fn(), updateCustomer: vi.fn(), archiveCustomer: vi.fn(),
    setEntryCustomer: m.setEntryCustomer,
  }),
  useUpdateShopSettings: () => m.updateSettings,
}))

const ON: ShopSettingsContextValue = {
  settings: { ...DEFAULT_SHOP_SETTINGS, khataEnabled: true, udhaarRecognition: 'cash' },
  isLoading: false, khataOn: true, isLive: true, viewAsUserId: undefined,
}

function wrap(ui: ReactNode, settings: ShopSettingsContextValue = ON) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ShopSettingsContext.Provider value={settings}>{ui}</ShopSettingsContext.Provider>
      </ToastProvider>
    </MemoryRouter>,
  )
}

const ALI: KhataCustomer = {
  _id: 'c1' as Id<'customers'>, _creationTime: 1, userId: 'u1' as Id<'users'>, name: 'Ali', normalizedName: 'ali',
  phone: '03001234567', dueTotal: 3000, heldTotal: 0, openCount: 1, lastActivityAt: 1, createdAt: 1,
}
const DUE_TARGET: EntryTarget = {
  entryId: 'k1' as Id<'khataEntries'>, customerId: ALI._id, customerName: 'Ali', kind: 'udhaar', status: 'due',
  recognition: 'delivery', remaining: 3000, paid: 3000, total: 6000, itemLabel: 'Suit', openedAt: Date.parse('2026-03-01T00:00:00+05:00'),
}

beforeEach(() => {
  localStorage.clear()
  m.viewAs = false
  m.offline = false
  for (const fn of [m.submitSale, m.submitKhataSale, m.submitPayment, m.submitAdvance, m.completeAdvance, m.updateSettings]) fn.mockReset()
  m.fixPaymentAmount.mockClear()
  m.customers = [ALI]
  m.detail = undefined
  m.totals = { dueTotal: 0, dueCount: 0, heldTotal: 0, heldCount: 0 }
  m.openRows = { due: [], booked: [] }
  m.pending = []
  m.outboxEntries = []
})
afterEach(cleanup)

describe('FAB', () => {
  it('shows Advance / booking and Receive payment only when passed (khata on)', () => {
    const base = { onAddCategory: vi.fn(), onAddSale: vi.fn(), onAddExpense: vi.fn(), onManageCategories: vi.fn() }
    const { unmount } = render(<FAB {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add new' }))
    expect(screen.queryByRole('button', { name: 'Advance / booking' })).toBeNull()
    unmount()

    const onAdvance = vi.fn()
    render(<FAB {...base} onAdvance={onAdvance} onReceivePayment={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add new' }))
    const labels = within(screen.getByRole('group', { name: 'Add new' })).getAllByRole('button').map((b) => b.textContent)
    expect(labels).toEqual(['Add Sale', 'Add Expense', 'Advance / booking', 'Receive payment', 'Add Category', 'Manage Categories'])
    fireEvent.click(screen.getByRole('button', { name: 'Advance / booking' }))
    expect(onAdvance).toHaveBeenCalledTimes(1)
  })
})

describe('Add Sale with Advance & Udhaar on', () => {
  const fill = () => {
    fireEvent.change(screen.getByLabelText('How much?'), { target: { value: '6000' } })
    fireEvent.change(screen.getByLabelText('What did you sell?'), { target: { value: 'Suit' } })
  }

  it('"No" path: Received now, live Baqi, customer chip → submitKhataSale with recognition', async () => {
    m.submitKhataSale.mockResolvedValue({ status: 'saved', entryId: 'e', result: { entryId: 'k1', remaining: 2000 } })
    const onClose = vi.fn()
    wrap(<AddSaleModal onClose={onClose} />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    fireEvent.change(screen.getByLabelText('Received now'), { target: { value: '4000' } })
    expect(screen.getByText(/Baqi:/).textContent).toContain('PKR 2,000')
    fireEvent.click(screen.getByRole('button', { name: 'Use Ali · 4567' }))
    fireEvent.click(screen.getByRole('button', { name: /Save sale/ }))
    expect(await screen.findByText('Saved · Baqi PKR 2,000 (Ali)')).toBeTruthy()
    expect(m.submitKhataSale).toHaveBeenCalledWith(expect.objectContaining({
      customer: { id: 'c1' }, customerName: 'Ali', receivedNow: 4000, recognition: 'cash',
      items: [{ productName: 'Suit', amount: 6000 }],
    }))
    expect(m.submitSale).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('"No" path offline: queued toast; a new customer needs a name', async () => {
    // Typed name that matches no chip = new customer (created on save), phone optional.
    m.submitKhataSale.mockResolvedValue({ status: 'queued', entryId: 'e' })
    wrap(<AddSaleModal onClose={vi.fn()} />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    fireEvent.change(screen.getByLabelText(/Customer name/), { target: { value: '  Sana   Bibi ' } })
    expect(screen.getByTestId('new-customer-hint').textContent).toContain('New customer')
    fireEvent.click(screen.getByRole('button', { name: /Add phone/ }))
    fireEvent.change(screen.getByLabelText('Phone (optional)'), { target: { value: '0321 7654321' } })
    fireEvent.click(screen.getByRole('button', { name: /Save sale/ }))
    expect(await screen.findByText('Saved on phone — will sync')).toBeTruthy()
    expect(m.submitKhataSale).toHaveBeenCalledWith(expect.objectContaining({
      customer: { name: 'Sana Bibi', phone: '0321 7654321' }, customerName: 'Sana Bibi', receivedNow: 0,
    }))
  })

  it('blank name: saved without a customer ("Saved · Baqi PKR 2,000")', async () => {
    m.submitKhataSale.mockResolvedValue({ status: 'saved', entryId: 'e', result: { entryId: 'k1', remaining: 2000 } })
    wrap(<AddSaleModal onClose={vi.fn()} />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    fireEvent.change(screen.getByLabelText('Received now'), { target: { value: '4000' } })
    fireEvent.click(screen.getByRole('button', { name: /Save sale/ }))
    expect(await screen.findByText('Saved · Baqi PKR 2,000')).toBeTruthy()
    const args = m.submitKhataSale.mock.calls[0]?.[0] as Record<string, unknown>
    expect(args).not.toHaveProperty('customer')
    expect(args).not.toHaveProperty('customerName')
  })

  it('blank name offline: queued', async () => {
    m.submitKhataSale.mockResolvedValue({ status: 'queued', entryId: 'e' })
    wrap(<AddSaleModal onClose={vi.fn()} />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    fireEvent.click(screen.getByRole('button', { name: /Save sale/ }))
    expect(await screen.findByText('Saved on phone — will sync')).toBeTruthy()
    expect(m.submitKhataSale.mock.calls[0]?.[0]).not.toHaveProperty('customer')
  })

  it('chips filter while typing (name + phone tail); a chip can be cleared with ×', () => {
    m.customers = [ALI, { ...ALI, _id: 'c2' as Id<'customers'>, name: 'Bilal', normalizedName: 'bilal', phone: undefined }]
    wrap(<AddSaleModal onClose={vi.fn()} />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    expect(screen.getByRole('group', { name: 'Recent customers' }).textContent).toContain('Bilal')
    const field = screen.getByLabelText(/Customer name/) as HTMLInputElement
    fireEvent.change(field, { target: { value: 'al' } })
    const chips = screen.getByRole('group', { name: 'Matching customers' })
    expect(within(chips).getByRole('button', { name: 'Use Ali · 4567' })).toBeTruthy()
    // "Bilal" contains "al" but is not a prefix match: it comes after Ali.
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['Ali · 4567', 'Bilal'])
    fireEvent.click(within(chips).getByRole('button', { name: 'Use Ali · 4567' }))
    expect(field.value).toBe('Ali')
    expect(screen.queryByTestId('new-customer-hint')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clear customer name' }))
    expect(field.value).toBe('')
  })

  it('received == total: inline hint and saved as a normal sale', async () => {
    m.submitSale.mockResolvedValue({ status: 'saved', entryId: 'e', result: { sessionId: 's', itemCount: 1, totalAmount: 6000 } })
    wrap(<AddSaleModal onClose={vi.fn()} />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    fireEvent.change(screen.getByLabelText('Received now'), { target: { value: '6000' } })
    expect(screen.getByText('Fully paid. This saves as a normal sale.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Save sale/ }))
    expect(await screen.findByText('Saved · 1 sale, PKR 6,000')).toBeTruthy()
    expect(m.submitKhataSale).not.toHaveBeenCalled()
  })

  it('more received than the total is an error', async () => {
    wrap(<AddSaleModal onClose={vi.fn()} />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    fireEvent.change(screen.getByLabelText('Received now'), { target: { value: '7000' } })
    fireEvent.click(screen.getByRole('button', { name: /Save sale/ }))
    expect(await screen.findByText('More than the total.')).toBeTruthy()
    expect(m.submitSale).not.toHaveBeenCalled()
  })
})

describe('Receive payment sheet', () => {
  it('"Full Baqi" fills the amount; more than Baqi is refused', async () => {
    m.submitPayment.mockResolvedValue({ status: 'saved', entryId: 'e', result: { paymentId: 'p', remaining: 0, status: 'settled' } })
    wrap(<ReceivePaymentSheet target={DUE_TARGET} onClose={vi.fn()} />)
    const input = screen.getByLabelText('Amount received') as HTMLInputElement
    fireEvent.change(input, { target: { value: '3500' } })
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))
    expect(await screen.findAllByText('More than Baqi (PKR 3,000)')).toBeTruthy()
    expect(m.submitPayment).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Full Baqi/ }))
    expect(input.value).toBe('3,000')
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))
    expect(await screen.findByText('Received PKR 3,000 · Ali paid in full')).toBeTruthy()
    expect(m.submitPayment).toHaveBeenCalledWith(expect.objectContaining({
      entryId: 'k1', amount: 3000, entryKind: 'udhaar', recognition: 'delivery', customerName: 'Ali',
    }))
  })
})

describe('Complete order sheet', () => {
  it('shows what was already paid and hands over with the final bill', async () => {
    m.completeAdvance.mockResolvedValue({ status: 'due', remaining: 2000 })
    const booked: EntryTarget = { ...DUE_TARGET, kind: 'advance', status: 'booked', paid: 5000, total: 11000, remaining: 6000 }
    wrap(<CompleteOrderSheet target={booked} onClose={vi.fn()} />)
    expect(screen.getByText('Already paid (advance)').parentElement?.textContent).toContain('PKR 5,000')
    expect((screen.getByLabelText('Final bill') as HTMLInputElement).value).toBe('11,000')
    fireEvent.change(screen.getByLabelText('Received now'), { target: { value: '4000' } })
    fireEvent.click(screen.getByRole('button', { name: /Hand over/ }))
    expect(await screen.findByText('Order handed over · Baqi PKR 2,000 (Ali)')).toBeTruthy()
    expect(m.completeAdvance).toHaveBeenCalledWith(expect.objectContaining({ entryId: 'k1', finalTotal: 11000, receivedNow: 4000 }))
  })

  it('a bill below the advance is refused', async () => {
    const booked: EntryTarget = { ...DUE_TARGET, kind: 'advance', status: 'booked', paid: 5000, total: undefined, remaining: null }
    wrap(<CompleteOrderSheet target={booked} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Final bill'), { target: { value: '4000' } })
    fireEvent.click(screen.getByRole('button', { name: /Hand over/ }))
    expect(await screen.findByText("Bill can't be less than advance. Use Cancel & refund.")).toBeTruthy()
    expect(m.completeAdvance).not.toHaveBeenCalled()
  })
})

function detailWithDue(): KhataCustomerDetail {
  return {
    customer: ALI,
    entriesCapped: false,
    entries: [{
      _id: 'k1' as Id<'khataEntries'>, _creationTime: 1, userId: 'u1' as Id<'users'>, customerId: ALI._id, kind: 'udhaar',
      status: 'due', recognition: 'delivery', total: 6000, paid: 3000, itemLabel: 'Suit', openedAt: DUE_TARGET.openedAt,
      createdAt: 1, updatedAt: 1, remaining: 3000, paymentsCapped: false,
      payments: [{
        _id: 'p1' as Id<'khataPayments'>, _creationTime: 1, userId: 'u1' as Id<'users'>, entryId: 'k1' as Id<'khataEntries'>,
        customerId: ALI._id, kind: 'payment', amount: 3000, receivedAt: DUE_TARGET.openedAt, createdAt: 1,
      }],
    }],
  }
}

describe('Customer sheet', () => {
  it('timeline, Receive payment and a WhatsApp reminder link', () => {
    m.detail = detailWithDue()
    wrap(<CustomerSheet customerId={ALI._id} onClose={vi.fn()} />)
    const sheet = screen.getByRole('dialog', { name: 'Ali' })
    expect(within(sheet).getByText('Sale · Suit')).toBeTruthy()
    expect(within(sheet).getByText('Received')).toBeTruthy()
    const link = within(sheet).getByRole('link', { name: /Remind on WhatsApp/ }) as HTMLAnchorElement
    expect(link.href).toContain('https://wa.me/923001234567?text=')
    expect(decodeURIComponent(link.href)).toContain('aap ka baqi PKR 3,000 hai. Shukriya – Khan Store')
    fireEvent.click(within(sheet).getByRole('button', { name: /Receive payment/ }))
    expect(screen.getByRole('dialog', { name: 'Receive payment' })).toBeTruthy()
  })

  it('admin view-as: read-only (no payment, menu or reminder)', () => {
    m.viewAs = true
    m.detail = detailWithDue()
    wrap(<CustomerSheet customerId={ALI._id} onClose={vi.fn()} />)
    const sheet = screen.getByRole('dialog', { name: 'Ali' })
    expect(within(sheet).queryByRole('button', { name: /Receive payment/ })).toBeNull()
    expect(within(sheet).queryByRole('button', { name: /More for/ })).toBeNull()
    expect(within(sheet).queryByRole('link', { name: /WhatsApp/ })).toBeNull()
    // Header X + footer Close only.
    expect(within(sheet).getAllByRole('button', { name: 'Close' })).toHaveLength(2)
  })
})

describe('Khata page', () => {
  const row = (over: Partial<KhataOpenRow>): KhataOpenRow => ({
    _id: 'k1' as Id<'khataEntries'>, _creationTime: 1, userId: 'u1' as Id<'users'>, customerId: ALI._id, kind: 'udhaar',
    status: 'due', recognition: 'delivery', total: 6000, paid: 3000, openedAt: Date.parse('2026-11-12T00:00:00+05:00'),
    createdAt: 1, updatedAt: 1, remaining: 3000, customerName: 'Ali', customerPhone: '03001234567', ...over,
  })

  it('empty states per segment; New advance hidden in view-as', () => {
    wrap(<Khata />)
    expect(screen.getByText('No Udhaar yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Advance/ }))
    expect(screen.getByText('No advances yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: /New advance/ })).toBeTruthy()
    cleanup()
    m.viewAs = true
    wrap(<Khata />)
    fireEvent.click(screen.getByRole('tab', { name: /Advance/ }))
    expect(screen.queryByRole('button', { name: /New advance/ })).toBeNull()
    expect(screen.getByText(/read-only/)).toBeTruthy()
  })

  it('segments show totals; rows show name, phone tail, Baqi and since', () => {
    localStorage.setItem('roznaama-amounts-hidden', 'false')
    m.totals = { dueTotal: 3000, dueCount: 1, heldTotal: 5000, heldCount: 2 }
    m.openRows = { due: [row({})], booked: [row({ _id: 'k2' as Id<'khataEntries'>, kind: 'advance', status: 'booked', paid: 5000, total: undefined, remaining: null, itemLabel: 'Suit' })] }
    wrap(<Khata />)
    const due = screen.getByRole('tab', { name: /Udhaar/ })
    expect(due.textContent).toContain('PKR 3,000')
    expect(due.textContent).toContain('1 open')
    expect(screen.getByRole('tab', { name: /Advance/ }).textContent).toContain('2 open')
    const list = screen.getByRole('list', { name: 'Udhaar' })
    expect(list.textContent).toContain('Ali · 4567')
    expect(list.textContent).toContain('since 12 Nov')
    expect(list.textContent).toContain('Baqi')
    fireEvent.click(screen.getByRole('tab', { name: /Advance/ }))
    expect(screen.getByRole('list', { name: 'Advances' }).textContent).toContain('Held')
  })

  it('search lists matching customers', () => {
    wrap(<Khata />)
    fireEvent.change(screen.getByLabelText('Search customer'), { target: { value: 'al' } })
    expect(screen.getByRole('list', { name: 'Customers' }).textContent).toContain('Ali')
  })

  it('pending advances show "Waiting to sync"', () => {
    m.pending = [buildEntry('user_a', 'ka-1', {
      kind: 'khataAdvance',
      args: { customer: { name: 'Ali' }, customerName: 'Ali', amount: 5000, receivedAt: Date.now(), recognition: 'delivery' },
    })]
    wrap(<Khata />)
    fireEvent.click(screen.getByRole('tab', { name: /Advance/ }))
    expect(screen.getByRole('list', { name: 'Waiting to sync' }).textContent).toContain('Advance · Ali')
  })
})

describe('Settings sheet', () => {
  const OFF: ShopSettingsContextValue = { ...ON, settings: DEFAULT_SHOP_SETTINGS, khataOn: false }

  it('off: switch only; turning on saves at once', async () => {
    m.updateSettings.mockResolvedValue(DEFAULT_SHOP_SETTINGS)
    wrap(<SettingsSheet onClose={vi.fn()} />, OFF)
    expect(screen.getByText('Customers ka udhaar aur advance ka hisaab rakhein.')).toBeTruthy()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: /Advance & Udhaar/ }))
    await waitFor(() => expect(m.updateSettings).toHaveBeenCalledWith({ khataEnabled: true }))
    expect(screen.getByText('Tabdeeli sirf nayi entries par lagu hogi.')).toBeTruthy()
  })

  it('on: two choice groups; switching a mode saves it', async () => {
    m.updateSettings.mockResolvedValue(DEFAULT_SHOP_SETTINGS)
    wrap(<SettingsSheet onClose={vi.fn()} />)
    expect(screen.getAllByRole('radiogroup')).toHaveLength(2)
    fireEvent.click(screen.getByRole('radio', { name: /Jab paise milein/ }))
    await waitFor(() => expect(m.updateSettings).toHaveBeenCalledWith({ advanceRecognition: 'cash' }))
  })

  it('turning off with open balances asks first', async () => {
    m.updateSettings.mockResolvedValue(DEFAULT_SHOP_SETTINGS)
    m.totals = { dueTotal: 3000, dueCount: 2, heldTotal: 5000, heldCount: 1 }
    wrap(<SettingsSheet onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('switch', { name: /Advance & Udhaar/ }))
    const confirm = screen.getByRole('alertdialog', { name: 'Advance & Udhaar band karein?' })
    expect(confirm.textContent).toContain('Aap ke 3 khaate abhi khule hain (Baqi PKR 3,000). Ye chhup jayenge, delete nahi honge. Dobara on karne par wapas nazar aayenge.')
    expect(m.updateSettings).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Band karein' }))
    await waitFor(() => expect(m.updateSettings).toHaveBeenCalledWith({ khataEnabled: false }))
  })

  it('read-only in view-as and offline', () => {
    m.viewAs = true
    wrap(<SettingsSheet onClose={vi.fn()} />)
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    m.viewAs = false
    m.offline = true
    wrap(<SettingsSheet onClose={vi.fn()} />)
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Pending payment over the Baqi', () => {
  it('"Ali\'s Baqi is now PKR 1,000" with Change amount', async () => {
    const base = buildEntry('user_a', 'kp-1', {
      kind: 'khataPayment',
      args: { entryId: 'k1' as Id<'khataEntries'>, amount: 1500, receivedAt: Date.now(), customerName: 'Ali', entryKind: 'udhaar', recognition: 'delivery' },
    })
    m.outboxEntries = [{ ...base, status: 'needsAttention', lastError: { reason: 'validation', message: 'More than Baqi (PKR 1,000)', at: 1 } }]
    wrap(<PendingEntrySheet rowId="kp-1" categories={[]} onClose={vi.fn()} />)
    expect(screen.getByText("Ali's Baqi is now PKR 1,000")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Change amount' }))
    expect((screen.getByLabelText('New amount') as HTMLInputElement).value).toBe('1,000')
    fireEvent.click(screen.getByRole('button', { name: /Save new amount/ }))
    await waitFor(() => expect(m.fixPaymentAmount).toHaveBeenCalledWith('kp-1', 1000))
  })

  it('a cancelled record can only be discarded', () => {
    const base = buildEntry('user_a', 'kp-2', {
      kind: 'khataPayment',
      args: { entryId: 'k1' as Id<'khataEntries'>, amount: 500, receivedAt: Date.now(), customerName: 'Ali', entryKind: 'advance', recognition: 'cash' },
    })
    m.outboxEntries = [{ ...base, status: 'needsAttention', lastError: { reason: 'notFound', message: 'This record was cancelled', at: 1 } }]
    wrap(<PendingEntrySheet rowId="kp-2" categories={[]} onClose={vi.fn()} />)
    expect(screen.getByText('This record was cancelled')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save without category' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change amount' })).toBeNull()
    expect(screen.getByRole('button', { name: /Discard/ })).toBeTruthy()
  })
})

// ── Records without a name ──────────────────────────────────────────────────

const NAMELESS_ROW = {
  _id: 'k9' as Id<'khataEntries'>, _creationTime: 1, userId: 'u1' as Id<'users'>, customerId: null, kind: 'udhaar',
  status: 'due', recognition: 'delivery', total: 6000, paid: 3000, itemLabel: 'Suit',
  openedAt: Date.parse('2026-11-12T00:00:00+05:00'), createdAt: 1, updatedAt: 1, remaining: 3000, customerName: null,
} as unknown as KhataOpenRow

function namelessDetail(): KhataEntryDetail {
  const { customerName: _n, ...entry } = NAMELESS_ROW as unknown as Record<string, unknown>
  void _n
  return { entry, payments: [], paymentsCapped: false, customer: null } as unknown as KhataEntryDetail
}

describe('records without a name', () => {
  beforeEach(() => {
    m.entryDetail = undefined
    m.setEntryCustomer.mockReset()
    m.setEntryCustomer.mockResolvedValue({ customerId: null })
  })

  it('advance without a name: no customer sent, toast without a name', async () => {
    m.submitAdvance.mockResolvedValue({ status: 'saved', entryId: 'e', result: { entryId: 'k1' } })
    wrap(<AdvanceSheet onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Advance received'), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: /Save advance/ }))
    expect(await screen.findByText('Saved · Advance PKR 5,000')).toBeTruthy()
    expect(m.submitAdvance.mock.calls[0]?.[0]).not.toHaveProperty('customer')
  })

  it('advance with a chip: that customer', async () => {
    m.submitAdvance.mockResolvedValue({ status: 'queued', entryId: 'e' })
    wrap(<AdvanceSheet onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use Ali · 4567' }))
    fireEvent.change(screen.getByLabelText('Advance received'), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: /Save advance/ }))
    expect(await screen.findByText('Saved on phone — will sync')).toBeTruthy()
    expect(m.submitAdvance).toHaveBeenCalledWith(expect.objectContaining({ customer: { id: 'c1' }, customerName: 'Ali' }))
  })

  it('/khata shows "No name · Suit · since 12 Nov" and opens the record sheet', () => {
    m.openRows = { due: [NAMELESS_ROW], booked: [] }
    m.entryDetail = namelessDetail()
    wrap(<Khata />)
    const list = screen.getByRole('list', { name: 'Udhaar' })
    expect(list.textContent).toContain('No name')
    expect(list.textContent).toContain('Suit · since 12 Nov')
    fireEvent.click(within(list).getByRole('button'))
    expect(screen.getByRole('dialog', { name: 'No name' })).toBeTruthy()
  })

  it('"Add name" types a new customer → setEntryCustomer', async () => {
    m.entryDetail = namelessDetail()
    wrap(<EntrySheet entryId={'k9' as Id<'khataEntries'>} onClose={vi.fn()} />)
    const sheet = screen.getByRole('dialog', { name: 'No name' })
    expect(within(sheet).queryByRole('link', { name: /WhatsApp/ })).toBeNull()
    fireEvent.click(within(sheet).getByRole('button', { name: /Add name/ }))
    const add = screen.getByRole('dialog', { name: 'Add name' })
    fireEvent.change(within(add).getByLabelText(/Customer name/), { target: { value: 'Zara' } })
    fireEvent.click(within(add).getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(m.setEntryCustomer).toHaveBeenCalledWith({ entryId: 'k9', customer: { name: 'Zara' } }))
  })

  it('"Add name" with a chip sends that customer id', async () => {
    m.entryDetail = namelessDetail()
    wrap(<EntrySheet entryId={'k9' as Id<'khataEntries'>} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Add name/ }))
    const add = screen.getByRole('dialog', { name: 'Add name' })
    fireEvent.click(within(add).getByRole('button', { name: 'Use Ali · 4567' }))
    fireEvent.click(within(add).getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(m.setEntryCustomer).toHaveBeenCalledWith({ entryId: 'k9', customer: { id: 'c1' } }))
  })

  it('customer sheet ⋯ → Change customer / Remove name', async () => {
    m.detail = detailWithDue()
    wrap(<CustomerSheet customerId={ALI._id} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'More for Udhaar · Suit' }))
    fireEvent.click(screen.getByRole('button', { name: /Change customer/ }))
    const sheet = screen.getByRole('dialog', { name: 'Change customer' })
    fireEvent.click(within(sheet).getByRole('button', { name: /Remove name/ }))
    await waitFor(() => expect(m.setEntryCustomer).toHaveBeenCalledWith({ entryId: 'k1', customer: null }))
  })

  it('FAB Receive payment lists customers as chips and nameless records as rows', async () => {
    m.openRows = {
      due: [NAMELESS_ROW, { ...NAMELESS_ROW, _id: 'k1', customerId: 'c1', customerName: 'Ali', customerPhone: '03001234567' } as unknown as KhataOpenRow],
      booked: [],
    }
    wrap(<ReceivePaymentFlow onClose={vi.fn()} />)
    expect(screen.getByRole('group', { name: 'Customers with Baqi or advance' }).textContent).toContain('Ali · 4567')
    const nameless = screen.getByRole('list', { name: 'Records without a name' })
    expect(nameless.textContent).toContain('No name · Udhaar · Suit')
    fireEvent.change(screen.getByLabelText('Search customer'), { target: { value: 'zz' } })
    expect(screen.getByText('Nothing open by that name.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search customer'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use Ali · 4567' }))
    expect(screen.getByRole('dialog', { name: 'Receive payment' }).textContent).toContain('Ali')
  })

  it('badges without a name: "Received", "Advance", "Baqi 3,000"', () => {
    const b = (over: Partial<KhataBadge>) => ({
      saleSessionId: 's', role: 'delivery', entryId: 'k', customerId: null, kind: 'udhaar', status: 'due',
      remaining: 3000, customerName: null, ...over,
    }) as unknown as KhataBadge
    expect(badgeText(b({ role: 'payment' }))).toEqual({ kind: 'label', text: 'Received' })
    expect(badgeText(b({ kind: 'advance', status: 'settled' }))).toEqual({ kind: 'label', text: 'Advance' })
    expect(badgeText(b({}))).toEqual({ kind: 'baqi', amount: 3000 })
    expect(badgeText(b({ role: 'payment', customerName: 'Ali' } as Partial<KhataBadge>))).toEqual({ kind: 'label', text: 'Received · Ali' })
  })

  it('pending record without a name shows "No name"', () => {
    const e = buildEntry('user_a', 'ks-9', {
      kind: 'khataSale',
      args: { items: [{ productName: 'Suit', amount: 6000 }], sessionDate: Date.now(), receivedNow: 0, recognition: 'delivery' },
    })
    m.outboxEntries = [e]
    wrap(<PendingEntrySheet rowId="ks-9" categories={[]} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Udhaar · No name' })).toBeTruthy()
  })
})
