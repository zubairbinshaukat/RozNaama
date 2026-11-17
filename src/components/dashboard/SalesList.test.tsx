import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import SalesList from './SalesList'
import { DashboardActionsContext } from '@/context/dashboardActions'
import { AmountVisibilityContext } from '@/context/amountVisibility'
import { pendingEntryIdOf } from '@/lib/offline/overlay'
import { expenseEntry, saleEntry } from '@/lib/offline/testUtils'
import type { ExpenseOutboxEntry, OutboxEntry, SaleOutboxEntry } from '@/lib/offline/types'
import type { DayGroup } from '@/lib/dayGroups'
import type { Id } from '../../../convex/_generated/dataModel'
import { ShopSettingsContext } from '@/hooks/useShopSettings'
import { DEFAULT_SHOP_SETTINGS } from '@/lib/khata'

const viewAs = { readOnly: false }
const net = { offline: false }
const showToast = vi.fn()
const outbox = {
  entries: [] as OutboxEntry[],
  discard: vi.fn(async () => {}),
  fixSaveForToday: vi.fn(async () => {}),
  fixWithoutCategory: vi.fn(async () => {}),
  retryEntry: vi.fn(async () => {}),
}

vi.mock('@/lib/network', () => ({
  useNetworkStatus: () => ({ isOffline: net.offline, browserOnline: !net.offline }),
  useBrowserOnline: () => !net.offline,
}))
vi.mock('@/hooks/useOutbox', () => ({
  useOutbox: () => {
    const resolve = (id: string) => pendingEntryIdOf(id) ?? id
    return {
      entries: outbox.entries,
      pendingCount: outbox.entries.length,
      needsAttentionCount: 0,
      paused: null,
      loaded: true,
      isSending: () => false,
      getEntry: (id: string) => outbox.entries.find((e) => e.id === resolve(id)),
      discard: outbox.discard,
      fixSaveForToday: outbox.fixSaveForToday,
      fixWithoutCategory: outbox.fixWithoutCategory,
      retryNow: vi.fn(),
      retryEntry: outbox.retryEntry,
    }
  },
}))

const khataBadges = vi.hoisted(() => ({ map: new Map<string, unknown>() }))
vi.mock('@/hooks/useKhata', () => ({
  useKhataBadges: () => khataBadges.map,
  useCustomerDetail: () => undefined,
  usePendingKhata: () => [],
  useKhataActions: () => ({}),
}))
vi.mock('@clerk/clerk-react', () => ({ useUser: () => ({ user: null }) }))

vi.mock('@/hooks/useSales', () => ({
  useDeleteSaleItem: () => vi.fn(),
  useUpdateSaleItem: () => vi.fn(),
}))
vi.mock('@/hooks/useExpenses', () => ({
  useDeleteExpenseItem: () => vi.fn(),
  useUpdateExpenseItem: () => vi.fn(),
}))
vi.mock('@/hooks/useCategorySales', () => ({
  useCategorySalesPaginated: () => ({ results: [], status: 'Exhausted', loadMore: vi.fn(), isLoading: false }),
  useCategorySummary: () => ({ count: 0, totalAmount: 0 }),
}))
vi.mock('@/components/shared/Toast', () => ({
  useToast: () => ({ showToast }),
}))
vi.mock('@/context/ViewAsContext', () => ({
  useIsViewingOtherSafe: () => viewAs.readOnly,
  useViewAsUserIdForQuery: () => undefined,
}))

afterEach(() => {
  cleanup()
  viewAs.readOnly = false
  net.offline = false
  outbox.entries = []
  showToast.mockReset()
  outbox.discard.mockClear()
  outbox.fixSaveForToday.mockClear()
  outbox.fixWithoutCategory.mockClear()
  outbox.retryEntry.mockClear()
})

const USER = 'u1' as Id<'users'>

function day(overrides: Partial<DayGroup> = {}): DayGroup {
  return {
    dateKey: '2026-03-12',
    dateLabel: 'Thu, 12 Mar',
    salesTotal: 1500,
    expenseTotal: 2000,
    net: -500,
    saleCount: 4,
    expenseCount: 1,
    items: [{
      _id: 's1' as Id<'sales'>,
      userId: USER,
      sessionId: 'ss1' as Id<'saleSessions'>,
      productName: 'Chai',
      amount: 1500,
      saleDate: 1,
      createdAt: 1,
    }],
    expenses: [{
      _id: 'e1' as Id<'expenses'>,
      userId: USER,
      amount: 2000,
      note: 'Rent',
      expenseDate: 1,
      createdAt: 1,
    }],
    ...overrides,
  }
}

describe('SalesList', () => {
  it('shows the empty state when there are no days', () => {
    render(<SalesList days={[]} categories={[]} />)
    expect(screen.getByText('No sales or expenses yet')).toBeTruthy()
  })

  it('empty state offers record buttons only when the dashboard provides actions', () => {
    const openAddSale = vi.fn()
    const openAddExpense = vi.fn()
    render(
      <DashboardActionsContext.Provider value={{ openAddSale, openAddExpense }}>
        <SalesList days={[]} categories={[]} />
      </DashboardActionsContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /record a sale/i }))
    fireEvent.click(screen.getByRole('button', { name: /add expense/i }))
    expect(openAddSale).toHaveBeenCalledTimes(1)
    expect(openAddExpense).toHaveBeenCalledTimes(1)
  })

  it('empty state has no record buttons in admin read-only mode', () => {
    viewAs.readOnly = true
    render(
      <DashboardActionsContext.Provider value={{ openAddSale: vi.fn(), openAddExpense: vi.fn() }}>
        <SalesList days={[]} categories={[]} />
      </DashboardActionsContext.Provider>,
    )
    expect(screen.queryByRole('button', { name: /record a sale/i })).toBeNull()
  })

  it('day header shows counts on one line and only the net: loss with a minus sign', () => {
    render(<SalesList days={[day()]} categories={[]} />)
    expect(screen.getByText('Thu, 12 Mar')).toBeTruthy()
    expect(screen.getByText('4 sales · 1 expense')).toBeTruthy()
    const header = screen.getByRole('button', { expanded: false })
    expect(header.textContent).toContain('−PKR 500')
    expect(header.textContent).not.toMatch(/Loss|Profit/)
    // Sales / Expenses breakdown is not repeated in the collapsed header.
    expect(header.textContent).not.toContain('PKR 1,500')
  })

  it('a profitable day shows the net without a sign, in the positive colour', () => {
    render(<SalesList days={[day({ expenseTotal: 500, net: 1000 })]} categories={[]} />)
    const header = screen.getByRole('button', { expanded: false })
    const net = within(header).getByText('PKR 1,000')
    expect(net.className).toContain('text-positive')
  })

  it('shows the Sales / Expenses breakdown once expanded', () => {
    render(<SalesList days={[day()]} categories={[]} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getAllByText('PKR 1,500').length).toBeGreaterThan(0)
    expect(screen.getAllByText('PKR 2,000').length).toBeGreaterThan(0)
  })

  it('hides every amount when the amount switch is off', () => {
    render(
      <AmountVisibilityContext.Provider value={{ hidden: true, toggle: vi.fn() }}>
        <SalesList days={[day()]} categories={[]} />
      </AmountVisibilityContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(document.body.textContent).not.toMatch(/PKR \d/)
    expect(document.body.textContent).toContain('PKR ••••')
    expect(screen.getByRole('button', { name: /^Chai, PKR ••••/ })).toBeTruthy()
  })
  it('says "No sales" for an expense-only day', () => {
    render(<SalesList days={[day({ saleCount: 0, items: [], salesTotal: 0, net: -2000 })]} categories={[]} />)
    expect(screen.getByText('No sales · 1 expense')).toBeTruthy()
  })

  it('expands to show sale and expense rows; tapping a sale opens details with Edit and Delete', async () => {
    render(<SalesList days={[day()]} categories={[]} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.click(screen.getByRole('button', { name: /^Chai, PKR 1,500/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Chai' })
    expect(within(dialog).getByRole('button', { name: /edit/i })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: /delete/i })).toBeTruthy()
    expect(screen.queryByText(/Editing needs internet/)).toBeNull()
  })

  it('delete from the detail sheet still asks for confirmation', async () => {
    render(<SalesList days={[day()]} categories={[]} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.click(screen.getByRole('button', { name: /^Expense: Rent/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Rent' })
    fireEvent.click(within(dialog).getByRole('button', { name: /delete/i }))
    const confirm = screen.getByRole('alertdialog', { name: 'Delete Expense' })
    expect(confirm.textContent).toContain('Rent')
  })

  it('hides Edit and Delete in admin read-only mode', async () => {
    viewAs.readOnly = true
    render(<SalesList days={[day()]} categories={[]} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.click(screen.getByRole('button', { name: /^Chai, PKR 1,500/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Chai' })
    expect(within(dialog).queryByRole('button', { name: /edit/i })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /delete/i })).toBeNull()
  })
})

describe('SalesList offline: edits are blocked', () => {
  const OFFLINE_EDIT = 'Editing needs internet. New sales and expenses still save offline.'

  it('detail sheet shows the note; Edit explains instead of opening the form', async () => {
    net.offline = true
    render(<SalesList days={[day()]} categories={[]} expandAll />)
    fireEvent.click(screen.getByRole('button', { name: /^Chai, PKR 1,500/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Chai' })
    expect(within(dialog).getByText(OFFLINE_EDIT)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /edit/i }))
    expect(showToast).toHaveBeenCalledWith(OFFLINE_EDIT, 'error')
    // Still on the detail sheet: the edit form never opened.
    expect(screen.getByRole('dialog', { name: 'Chai' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Edit sale' })).toBeNull()
  })

  it('Delete explains instead of asking to confirm', async () => {
    net.offline = true
    render(<SalesList days={[day()]} categories={[]} expandAll />)
    fireEvent.click(screen.getByRole('button', { name: /^Expense: Rent/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Rent' })
    fireEvent.click(within(dialog).getByRole('button', { name: /delete/i }))
    expect(showToast).toHaveBeenCalledWith(OFFLINE_EDIT, 'error')
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

describe('SalesList pending (not yet synced) rows', () => {
  const CATS = [{ _id: 'cat_live' as Id<'categories'>, userId: USER, name: 'Snacks', color: '#22c55e', createdAt: 1 }]

  function pendingDay(entry: SaleOutboxEntry | ExpenseOutboxEntry): DayGroup {
    const base = day({ items: [], expenses: [], saleCount: 0, expenseCount: 0 })
    if (entry.kind === 'sale') {
      return {
        ...base,
        saleCount: entry.args.items.length,
        items: entry.args.items.map((it, i) => ({
          _id: `pending:${entry.id}:${i}` as Id<'sales'>,
          userId: USER,
          sessionId: `pending:${entry.id}` as Id<'saleSessions'>,
          productName: it.productName,
          amount: it.amount,
          ...(it.categoryId ? { categoryId: it.categoryId } : {}),
          saleDate: entry.args.sessionDate,
          createdAt: entry.createdAt,
        })),
      }
    }
    return {
      ...base,
      expenseCount: 1,
      expenses: [{
        _id: `pending:${entry.id}` as Id<'expenses'>,
        userId: USER,
        amount: entry.args.amount,
        ...(entry.args.note ? { note: entry.args.note } : {}),
        expenseDate: entry.args.expenseDate,
        createdAt: entry.createdAt,
      }],
    }
  }

  it('shows "Waiting to sync" and the category name saved with the entry', () => {
    const entry = saleEntry('ent-1', {
      args: { items: [{ productName: 'Samosa', amount: 60, categoryId: 'cat_gone' as Id<'categories'> }], sessionDate: 1 },
      categoryLabels: { cat_gone: 'Fried food' },
    })
    outbox.entries = [entry]
    render(<SalesList days={[pendingDay(entry)]} categories={CATS} expandAll />)
    const row = screen.getByRole('button', { name: /^Samosa, PKR 60, Fried food, waiting to sync/ })
    expect(within(row).getByText('Waiting to sync')).toBeTruthy()
    expect(within(row).getByText(/Fried food/)).toBeTruthy()
  })

  it('opens the pending sheet (no Edit) and discards after confirming', async () => {
    const entry = expenseEntry('ent-2', { args: { amount: 20, expenseDate: 1, note: 'Ice' } })
    outbox.entries = [entry]
    render(<SalesList days={[pendingDay(entry)]} categories={[]} expandAll />)
    fireEvent.click(screen.getByRole('button', { name: /^Expense: Ice, PKR 20, waiting to sync/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Ice' })
    expect(within(sheet).getByText(/Saved on this phone/)).toBeTruthy()
    expect(within(sheet).queryByRole('button', { name: /edit/i })).toBeNull()

    fireEvent.click(within(sheet).getByRole('button', { name: /discard/i }))
    const confirm = screen.getByRole('alertdialog', { name: 'Discard entry?' })
    expect(outbox.discard).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(outbox.discard).toHaveBeenCalledWith('ent-2'))
    expect(showToast).toHaveBeenCalledWith('Entry discarded', 'success')
  })

  it('wrong phone date: "Needs a fix" + "Save for today" and "Try again"', async () => {
    const entry = saleEntry('ent-3', {
      status: 'needsAttention',
      lastError: { reason: 'clock', message: "Your phone's date looks wrong.", at: 1 },
    })
    outbox.entries = [entry]
    render(<SalesList days={[pendingDay(entry)]} categories={[]} expandAll />)
    const row = screen.getByRole('button', { name: /^Chai, PKR 50, needs a fix/ })
    expect(within(row).getByText('Needs a fix')).toBeTruthy()
    fireEvent.click(row)
    const sheet = await screen.findByRole('dialog', { name: 'Chai' })
    expect(within(sheet).getByText("Your phone's date looks wrong.")).toBeTruthy()
    expect(within(sheet).queryByRole('button', { name: 'Save without category' })).toBeNull()

    fireEvent.click(within(sheet).getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(outbox.retryEntry).toHaveBeenCalledWith('ent-3'))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save for today' }))
    await waitFor(() => expect(outbox.fixSaveForToday).toHaveBeenCalledWith('ent-3'))
  })

  it('deleted category: offers "Save without category"', async () => {
    const entry = saleEntry('ent-4', {
      status: 'needsAttention',
      lastError: { reason: 'notFound', message: 'That category was deleted.', at: 1 },
    })
    outbox.entries = [entry]
    render(<SalesList days={[pendingDay(entry)]} categories={[]} expandAll />)
    fireEvent.click(screen.getByRole('button', { name: /^Chai, PKR 50/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Chai' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save without category' }))
    await waitFor(() => expect(outbox.fixWithoutCategory).toHaveBeenCalledWith('ent-4'))
    expect(within(sheet).queryByRole('button', { name: 'Save for today' })).toBeNull()
  })
})

describe('SalesList with Advance & Udhaar on', () => {
  const ON = {
    settings: { ...DEFAULT_SHOP_SETTINGS, khataEnabled: true }, isLoading: false, khataOn: true, isLive: true, viewAsUserId: undefined,
  }

  it('shows "Baqi 3,000" on a linked sale and opens the customer sheet', async () => {
    khataBadges.map = new Map([['ss1', {
      saleSessionId: 'ss1', role: 'delivery', entryId: 'k1', customerId: 'c1', kind: 'udhaar', status: 'due',
      remaining: 3000, customerName: 'Ali',
    }]])
    render(
      <ShopSettingsContext.Provider value={ON}>
        <SalesList days={[day()]} categories={[]} expandAll />
      </ShopSettingsContext.Provider>,
    )
    const row = screen.getByRole('button', { name: /^Chai, PKR 1,500, Baqi PKR 3,000/ })
    expect(within(row).getByTestId('khata-badge').textContent).toBe('Baqi\u00a03,000')
    fireEvent.click(row)
    expect(await screen.findByRole('dialog', { name: 'Customer' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Chai' })).toBeNull()
  })

  it('payment sessions say "Received · Ali"; unlinked rows are unchanged', () => {
    khataBadges.map = new Map([['ss1', {
      saleSessionId: 'ss1', role: 'payment', entryId: 'k1', customerId: 'c1', kind: 'advance', status: 'booked',
      remaining: null, customerName: 'Ali',
    }]])
    render(
      <ShopSettingsContext.Provider value={ON}>
        <SalesList days={[day()]} categories={[]} expandAll />
      </ShopSettingsContext.Provider>,
    )
    expect(screen.getByTestId('khata-badge').textContent).toBe('Received · Ali')
    khataBadges.map = new Map()
  })
})