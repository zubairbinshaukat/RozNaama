import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConvexError } from 'convex/values'
import { ToastProvider } from '@/components/shared/Toast'
import { getEntryHistory, recordExpenseTitle, resetEntryHistoryMemory } from '@/lib/entryHistory'
import AddExpenseModal from './AddExpenseModal'

const submitExpense = vi.fn()

vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({ user: { id: 'user_a' }, isSignedIn: true, isLoaded: true }),
}))

vi.mock('@/hooks/useSubmitEntry', () => ({
  useSubmitEntry: () => ({ submitSale: vi.fn(), submitExpense }),
}))

function renderModal(onClose = vi.fn()) {
  render(<ToastProvider><AddExpenseModal onClose={onClose} /></ToastProvider>)
  return { onClose }
}

const amountInput = () => screen.getByLabelText('Expense amount in PKR') as HTMLInputElement
const titleInput = () => screen.getByLabelText('Expense note (optional)') as HTMLInputElement

function fillAndSave(amount: string, title: string) {
  fireEvent.change(amountInput(), { target: { value: amount } })
  fireEvent.change(titleInput(), { target: { value: title } })
  fireEvent.click(screen.getByRole('button', { name: /Add expense/ }))
}

beforeEach(() => {
  window.localStorage.clear()
  resetEntryHistoryMemory()
  submitExpense.mockReset()
  submitExpense.mockResolvedValue({ status: 'saved', entryId: 'e1', result: { expenseId: 'x1', amount: 1 } })
  ;['Electricity', 'Rent', 'Rickshaw', 'Tea for staff', 'Bags'].forEach((t, i) =>
    recordExpenseTitle('user_a', t, (i + 1) * 100, i + 1),
  )
})

afterEach(cleanup)

describe('AddExpenseModal smart entry', () => {
  it('shows the 4 most recent titles, and older ones when searching', () => {
    renderModal()
    const recent = screen.getByRole('group', { name: 'Recent expenses' })
    expect(within(recent).getAllByRole('button', { name: /^Use / })).toHaveLength(4)
    expect(within(recent).queryByRole('button', { name: 'Use Electricity' })).toBeNull()

    fireEvent.change(titleInput(), { target: { value: 'elec' } })
    const matches = screen.getByRole('group', { name: 'Matching expenses' })
    expect(within(matches).getByRole('button', { name: 'Use Electricity' })).toBeTruthy()
  })

  it('tapping a chip fills the title and last amount, overwriting a typed amount', () => {
    renderModal()
    fireEvent.change(amountInput(), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use Rent' }))
    expect(titleInput().value).toBe('Rent')
    expect(amountInput().value).toBe('200')
  })

  it('remembers the title after a successful save', async () => {
    renderModal()
    fillAndSave('750', 'Generator fuel')
    await waitFor(() => expect(submitExpense).toHaveBeenCalledTimes(1))
    expect(submitExpense.mock.calls[0]?.[0]).toMatchObject({ amount: 750, note: 'Generator fuel' })
    await waitFor(() => expect(getEntryHistory('user_a').expenses[0]?.title).toBe('Generator fuel'))
  })

  it('does not remember the title when the save fails', async () => {
    submitExpense.mockRejectedValueOnce(new Error('offline'))
    renderModal()
    fillAndSave('750', 'Generator fuel')
    await waitFor(() => expect(submitExpense).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(getEntryHistory('user_a').expenses.map((e) => e.title)).not.toContain('Generator fuel')
  })
})

describe('AddExpenseModal submit (offline-first)', () => {
  it('saved: "Expense saved" toast and closes', async () => {
    const { onClose } = renderModal()
    fillAndSave('300', 'Chai')
    expect(await screen.findByText('Expense saved')).toBeTruthy()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('queued: "Saved on phone — will sync", closes and remembers the title', async () => {
    submitExpense.mockResolvedValueOnce({ status: 'queued', entryId: 'e2' })
    const { onClose } = renderModal()
    fillAndSave('300', 'Chai')
    expect(await screen.findByText('Saved on phone — will sync')).toBeTruthy()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(getEntryHistory('user_a').expenses[0]?.title).toBe('Chai')
  })

  it('error in admin view-as: shows the server-style message and stays open', async () => {
    submitExpense.mockRejectedValueOnce(new ConvexError({
      code: 'FORBIDDEN',
      message: 'Switch back to your own account to add entries.',
    }))
    const { onClose } = renderModal()
    fillAndSave('300', 'Chai')
    expect((await screen.findAllByText('Switch back to your own account to add entries.')).length).toBeGreaterThan(0)
    expect(onClose).not.toHaveBeenCalled()
  })
})
