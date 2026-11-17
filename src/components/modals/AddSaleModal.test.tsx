import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConvexError } from 'convex/values'
import { ToastProvider } from '@/components/shared/Toast'
import { getEntryHistory, recordSaleProducts, resetEntryHistoryMemory } from '@/lib/entryHistory'
import AddSaleModal from './AddSaleModal'

const auth: { userId: string | null } = { userId: 'user_a' }
const submitSale = vi.fn()

vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({ user: auth.userId ? { id: auth.userId } : null, isSignedIn: Boolean(auth.userId), isLoaded: true }),
}))

vi.mock('@/hooks/useSubmitEntry', () => ({
  useSubmitEntry: () => ({ submitSale, submitExpense: vi.fn() }),
}))

vi.mock('@/hooks/useCategories', () => ({
  useCategories: () => [
    { _id: 'cat_drinks', userId: 'u1', name: 'Drinks', color: '#3b82f6', createdAt: 1 },
  ],
}))

function renderModal(onClose = vi.fn()) {
  render(<ToastProvider><AddSaleModal onClose={onClose} /></ToastProvider>)
  return { onClose }
}

const amountInput = () => screen.getByLabelText('How much?') as HTMLInputElement
const nameInput = () => screen.getByLabelText('What did you sell?') as HTMLInputElement

beforeEach(() => {
  window.localStorage.clear()
  resetEntryHistoryMemory()
  auth.userId = 'user_a'
  submitSale.mockReset()
  submitSale.mockResolvedValue({ status: 'saved', entryId: 'e1', result: { sessionId: 's1', itemCount: 1, totalAmount: 50 } })
  recordSaleProducts('user_a', [{ name: 'Chai', amount: 50, categoryId: 'cat_drinks' }], 1)
  recordSaleProducts('user_a', [{ name: 'Biscuit', amount: 30, categoryId: 'cat_deleted' }], 2)
})

afterEach(cleanup)

describe('AddSaleModal smart entry', () => {
  it('puts the amount above the product name', () => {
    renderModal()
    const order = amountInput().compareDocumentPosition(nameInput())
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows recent products when the name is empty', () => {
    renderModal()
    const group = screen.getByRole('group', { name: 'Recent items' })
    expect(within(group).getByRole('button', { name: 'Use Biscuit' })).toBeTruthy()
    expect(within(group).getByRole('button', { name: 'Use Chai' })).toBeTruthy()
  })

  it('filters chips live while typing', () => {
    renderModal()
    fireEvent.change(nameInput(), { target: { value: 'bis' } })
    const group = screen.getByRole('group', { name: 'Matching items' })
    expect(within(group).getByRole('button', { name: 'Use Biscuit' })).toBeTruthy()
    expect(within(group).queryByRole('button', { name: 'Use Chai' })).toBeNull()
  })

  it('tapping a chip fills name, amount and a category that still exists', () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Use Chai' }))
    expect(nameInput().value).toBe('Chai')
    expect(amountInput().value).toBe('50')
    expect(screen.getByText('Drinks')).toBeTruthy()
  })

  it('leaves the category unset when the remembered one was deleted', () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Use Biscuit' }))
    expect(nameInput().value).toBe('Biscuit')
    expect(amountInput().value).toBe('30')
    expect(screen.getByText('No category')).toBeTruthy()
  })

  it('typing a known name never overwrites a typed amount; tapping the chip does', () => {
    renderModal()
    fireEvent.change(amountInput(), { target: { value: '999' } })
    fireEvent.change(nameInput(), { target: { value: 'Chai' } })
    expect(amountInput().value).toBe('999')
    fireEvent.click(screen.getByRole('button', { name: 'Use Chai' }))
    expect(amountInput().value).toBe('50')
  })

  it('chips work per item row', () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Add another item' }))
    const item2 = screen.getByRole('group', { name: 'Item 2' })
    fireEvent.click(within(item2).getByRole('button', { name: 'Use Biscuit' }))
    const item1 = screen.getByRole('group', { name: 'Item 1' })
    expect((within(item1).getByLabelText('What did you sell?') as HTMLInputElement).value).toBe('')
    expect((within(item2).getByLabelText('What did you sell?') as HTMLInputElement).value).toBe('Biscuit')
  })

  it('records history only after a successful save', async () => {
    submitSale.mockRejectedValueOnce(new Error('offline'))
    renderModal()
    fireEvent.change(amountInput(), { target: { value: '120' } })
    fireEvent.change(nameInput(), { target: { value: 'Samosa' } })
    fireEvent.click(screen.getByRole('button', { name: /Save sale/ }))
    await waitFor(() => expect(submitSale).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: /Save sale/ })).toHaveProperty('disabled', false))
    expect(getEntryHistory('user_a').products.map((p) => p.name)).not.toContain('Samosa')

    fireEvent.click(screen.getByRole('button', { name: /Save sale/ }))
    await waitFor(() => expect(submitSale).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(getEntryHistory('user_a').products.find((p) => p.name === 'Samosa')?.lastAmount).toBe(120),
    )
  })

  it('removing a chip forgets it', () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Chai from suggestions' }))
    expect(screen.queryByRole('button', { name: 'Use Chai' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('button', { name: 'Use Chai' })).toBeTruthy()
  })

  it('shows no chips for another account', () => {
    auth.userId = 'user_b'
    renderModal()
    expect(screen.queryByRole('button', { name: 'Use Chai' })).toBeNull()
  })
})

describe('AddSaleModal submit (offline-first)', () => {
  function fillAndSave(amount: string, name: string) {
    fireEvent.change(amountInput(), { target: { value: amount } })
    fireEvent.change(nameInput(), { target: { value: name } })
    fireEvent.click(screen.getByRole('button', { name: /Save sale/ }))
  }

  it('saved on the server: "Saved" toast, closes, remembers the product, sends category labels', async () => {
    submitSale.mockResolvedValueOnce({
      status: 'saved', entryId: 'e1', result: { sessionId: 's1', itemCount: 1, totalAmount: 120 },
    })
    const { onClose } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Use Chai' }))
    fireEvent.change(amountInput(), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: /Save sale/ }))

    expect(await screen.findByText('Saved · 1 sale, PKR 120')).toBeTruthy()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(submitSale).toHaveBeenCalledWith(expect.objectContaining({
      items: [{ productName: 'Chai', amount: 120, categoryId: 'cat_drinks' }],
      categoryLabels: { cat_drinks: 'Drinks' },
    }))
    expect(getEntryHistory('user_a').products.find((p) => p.name === 'Chai')?.lastAmount).toBe(120)
  })

  it('queued on the phone: "Saved on phone — will sync", closes and still remembers the product', async () => {
    submitSale.mockResolvedValueOnce({ status: 'queued', entryId: 'e2' })
    const { onClose } = renderModal()
    fillAndSave('80', 'Pakora')
    expect(await screen.findByText('Saved on phone — will sync')).toBeTruthy()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(getEntryHistory('user_a').products.find((p) => p.name === 'Pakora')?.lastAmount).toBe(80)
    // No category picked → no labels sent.
    expect(submitSale.mock.calls[0]?.[0]).not.toHaveProperty('categoryLabels')
  })

  it('queued with a problem: shows the problem message', async () => {
    submitSale.mockResolvedValueOnce({
      status: 'queued',
      entryId: 'e3',
      problem: { reason: 'clock', message: "Your phone's date looks wrong.", at: 1 },
    })
    renderModal()
    fillAndSave('80', 'Pakora')
    expect(await screen.findByText("Saved on phone. Your phone's date looks wrong.")).toBeTruthy()
  })

  it('error (e.g. could not save on this phone): stays open with the message, nothing remembered', async () => {
    submitSale.mockRejectedValueOnce(new ConvexError({
      code: 'VALIDATION',
      message: "Couldn't save on this phone. Connect to the internet and try again.",
    }))
    const { onClose } = renderModal()
    fillAndSave('80', 'Pakora')
    const alerts = await screen.findAllByText("Couldn't save on this phone. Connect to the internet and try again.")
    expect(alerts.length).toBeGreaterThan(0)
    expect(onClose).not.toHaveBeenCalled()
    expect(getEntryHistory('user_a').products.map((p) => p.name)).not.toContain('Pakora')
    expect(screen.getByRole('button', { name: /Save sale/ })).toHaveProperty('disabled', false)
  })
})
