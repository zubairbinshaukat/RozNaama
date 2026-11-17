import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { OutboxContext, type OutboxContextValue } from '@/lib/offline/context'
import { OutboxEngine } from '@/lib/offline/outboxEngine'
import { InMemoryOutboxStore } from '@/lib/offline/outboxStore'
import { getErrorMessage } from '@/lib/errors'
import type { OutboxEntry, SendResult } from '@/lib/offline/types'
import { CLIENT_REQUEST_ID_RE } from '../../convex/lib/limits'
import { saleResult } from '@/lib/offline/testUtils'
import { STORAGE_FAILED_MESSAGE, SUBMIT_ONLINE_WAIT_MS, useSubmitEntry, VIEW_AS_SUBMIT_MESSAGE } from './useSubmitEntry'
import { dropEntryCategories, moveEntryToToday, useOutbox } from './useOutbox'

const mocks = vi.hoisted(() => ({
  recordSale: vi.fn(),
  recordExpense: vi.fn(),
  isOffline: false,
  viewAs: undefined as string | undefined,
}))

vi.mock('convex/react', () => ({
  useMutation: (ref: unknown) => {
    const name = String((ref as { _name?: string })?._name ?? ref)
    return name.includes('expenses') ? mocks.recordExpense : mocks.recordSale
  },
}))
vi.mock('../../convex/_generated/api', () => ({
  api: {
    saleSessions: { record: { _name: 'saleSessions:record' } },
    expenses: { record: { _name: 'expenses:record' } },
    khata: { recordSale: { _name: 'khata:recordSale' }, openAdvance: { _name: 'khata:openAdvance' }, receivePayment: { _name: 'khata:receivePayment' } },
  },
}))
vi.mock('@/lib/network', () => ({
  useNetworkStatus: () => ({ isOffline: mocks.isOffline, browserOnline: !mocks.isOffline }),
}))
vi.mock('@/context/ViewAsContext', () => ({
  useViewAsUserIdForQuery: () => mocks.viewAs,
}))

const OWNER = 'user_a'
const SALE = { items: [{ productName: 'Chai', amount: 50 }], sessionDate: Date.parse('2026-03-12T00:00:00+05:00') }

function makeEngine(send: (e: OutboxEntry) => Promise<SendResult>, store = new InMemoryOutboxStore()) {
  const engine = new OutboxEngine({ owner: OWNER, store, send, inFlight: new Map() })
  return { engine, store }
}

function wrapperFor(value: OutboxContextValue | null) {
  return ({ children }: { children: ReactNode }) =>
    value ? <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider> : <>{children}</>
}

function render(value: OutboxContextValue | null) {
  return renderHook(() => ({ submit: useSubmitEntry(), outbox: useOutbox() }), { wrapper: wrapperFor(value) })
}

const ctxFor = (engine: OutboxEngine | null): OutboxContextValue =>
  ({ owner: engine ? OWNER : null, ownerSource: engine ? 'clerk' : 'none', engine, state: engine?.getState() ?? null })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse('2026-03-12T10:00:00+05:00'))
  mocks.recordSale.mockReset()
  mocks.recordExpense.mockReset()
  mocks.isOffline = false
  mocks.viewAs = undefined
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useSubmitEntry', () => {
  it('online: enqueues, syncs through the outbox and reports saved', async () => {
    const send = vi.fn<(e: OutboxEntry) => Promise<SendResult>>(async () => saleResult(1))
    const { engine, store } = makeEngine(send)
    engine.setAuthReady(true)
    const { result } = render(ctxFor(engine))
    let out: Awaited<ReturnType<typeof result.current.submit.submitSale>> | undefined
    await act(async () => { out = await result.current.submit.submitSale({ ...SALE, categoryLabels: { c: 'Drinks' } }) })
    expect(out).toMatchObject({ status: 'saved', result: saleResult(1).result })
    expect(out?.entryId).toMatch(CLIENT_REQUEST_ID_RE)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0]).toMatchObject({ id: out?.entryId, kind: 'sale', dayKey: '2026-03-12', categoryLabels: { c: 'Drinks' } })
    expect(mocks.recordSale).not.toHaveBeenCalled()
    expect(store.records.size).toBe(0)
  })

  it('online but slow: reports queued after 4s and keeps the entry', async () => {
    const send = vi.fn(() => new Promise<SendResult>(() => {}))
    const { engine, store } = makeEngine(send)
    engine.setAuthReady(true)
    const { result } = render(ctxFor(engine))
    let p!: Promise<unknown>
    act(() => { p = result.current.submit.submitExpense({ amount: 20, expenseDate: SALE.sessionDate }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(SUBMIT_ONLINE_WAIT_MS) })
    await expect(p).resolves.toMatchObject({ status: 'queued' })
    expect(store.records.size).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(mocks.recordExpense).not.toHaveBeenCalled()
  })

  it('offline: queued at once, nothing sent', async () => {
    mocks.isOffline = true
    const send = vi.fn(async () => saleResult(1))
    const { engine, store } = makeEngine(send) // not auth-ready (offline start)
    const { result } = render(ctxFor(engine))
    let out: unknown
    await act(async () => { out = await result.current.submit.submitSale(SALE) })
    expect(out).toMatchObject({ status: 'queued' })
    expect(store.records.size).toBe(1)
    expect(send).not.toHaveBeenCalled()
  })

  it('outbox write fails while online: sends directly with the clientRequestId (once)', async () => {
    const send = vi.fn(async () => saleResult(1))
    const { engine, store } = makeEngine(send)
    engine.setAuthReady(true)
    store.failWrites = true
    mocks.recordSale.mockResolvedValue({ sessionId: 'ss9', totalAmount: 50, itemCount: 1 })
    const { result } = render(ctxFor(engine))
    let out: unknown
    await act(async () => { out = await result.current.submit.submitSale({ ...SALE, categoryLabels: { c: 'Drinks' } }) })
    expect(out).toMatchObject({ status: 'saved', result: { sessionId: 'ss9' } })
    expect(mocks.recordSale).toHaveBeenCalledTimes(1)
    const args = mocks.recordSale.mock.calls[0]![0] as Record<string, unknown>
    expect(args.clientRequestId).toMatch(CLIENT_REQUEST_ID_RE)
    expect(args).not.toHaveProperty('categoryLabels')
    expect(send).not.toHaveBeenCalled()
  })

  it('outbox write fails while offline: throws a readable error', async () => {
    mocks.isOffline = true
    const { engine, store } = makeEngine(vi.fn(async () => saleResult(1)))
    store.failWrites = true
    const { result } = render(ctxFor(engine))
    let err: unknown
    await act(async () => { await result.current.submit.submitSale(SALE).catch((e: unknown) => { err = e }) })
    expect(getErrorMessage(err, 'x')).toBe(STORAGE_FAILED_MESSAGE)
    expect(mocks.recordSale).not.toHaveBeenCalled()
  })

  it('admin view-as: refuses (nothing queued)', async () => {
    mocks.viewAs = 'other_user'
    const { engine, store } = makeEngine(vi.fn(async () => saleResult(1)))
    const { result } = render(ctxFor(engine))
    let err: unknown
    await act(async () => { await result.current.submit.submitSale(SALE).catch((e: unknown) => { err = e }) })
    expect(getErrorMessage(err, 'x')).toBe(VIEW_AS_SUBMIT_MESSAGE)
    expect(store.records.size).toBe(0)
  })

  it('no signed-in owner: refuses', async () => {
    const { result } = render(ctxFor(null))
    await act(async () => {
      await expect(result.current.submit.submitSale(SALE)).rejects.toBeTruthy()
    })
  })

  it('outside OutboxProvider: plain mutation with a clientRequestId', async () => {
    mocks.recordExpense.mockResolvedValue({ expenseId: 'e1', amount: 20 })
    const { result } = render(null)
    let out: unknown
    await act(async () => { out = await result.current.submit.submitExpense({ amount: 20, expenseDate: 1, note: 'Tea' }) })
    expect(out).toMatchObject({ status: 'saved', result: { expenseId: 'e1' } })
    expect(mocks.recordExpense.mock.calls[0]![0]).toMatchObject({ amount: 20, note: 'Tea', clientRequestId: expect.stringMatching(CLIENT_REQUEST_ID_RE) })
  })
})

describe('useOutbox fixes', () => {
  const entry: OutboxEntry = {
    v: 1, id: 'abcdefabcdefabcdef', owner: OWNER, kind: 'sale', dayKey: '2027-01-01', tz: 'Asia/Karachi',
    createdAt: 1, status: 'needsAttention', attempts: 1, nextAttemptAt: 0,
    args: { items: [{ productName: 'Chai', amount: 50, categoryId: 'c1' as never }], sessionDate: Date.parse('2027-01-01T00:00:00+05:00') },
    categoryLabels: { c1: 'Drinks' },
  }

  it('moveEntryToToday keeps the id and moves date + dayKey', () => {
    const moved = moveEntryToToday(entry)
    expect(moved.id).toBe(entry.id)
    expect(moved.dayKey).toBe('2026-03-12')
    expect(moved.kind === 'sale' && moved.args.sessionDate).toBe(Date.parse('2026-03-12T00:00:00+05:00'))
  })

  it('dropEntryCategories removes category ids and labels', () => {
    const out = dropEntryCategories(entry)
    expect(out.kind === 'sale' && out.args.items[0]).toEqual({ productName: 'Chai', amount: 50 })
    expect(out).not.toHaveProperty('categoryLabels')
  })

  it('useOutbox exposes entries and accepts synthetic row ids', async () => {
    const store = new InMemoryOutboxStore()
    const { engine } = makeEngine(vi.fn(async () => saleResult(1)), store)
    await store.put(entry as never)
    await engine.start()
    const { result } = render(ctxFor(engine))
    expect(result.current.outbox.pendingCount).toBe(1)
    expect(result.current.outbox.needsAttentionCount).toBe(1)
    expect(result.current.outbox.getEntry(`pending:${entry.id}:0`)?.id).toBe(entry.id)
    await act(async () => { await result.current.outbox.discard(`pending:${entry.id}:0`) })
    expect(store.records.size).toBe(0)
  })
})
