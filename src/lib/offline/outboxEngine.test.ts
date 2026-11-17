import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConvexError } from 'convex/values'
import { OutboxEngine, LOCK_BUSY_RETRY_MS, type OutboxEngineOptions } from './outboxEngine'
import { InMemoryOutboxStore } from './outboxStore'
import { backoffDelayMs, classifyError, BACKOFF_MAX_MS } from './classify'
import { createInTabLocks, createLocks, type LocksLike } from './platform'
import { newClientRequestId } from './ids'
import type { OutboxEntry, SendResult, StoredOutboxRecord } from './types'
import { createBus, deferred, expenseEntry, OWNER, saleEntry, saleResult, settle } from './testUtils'
import { CLIENT_REQUEST_ID_RE } from '../../../convex/lib/limits'

const appErr = (code: string, message = code) => new ConvexError({ code, message })

type Harness = {
  engine: OutboxEngine
  store: InMemoryOutboxStore
  sent: string[]
  send: ReturnType<typeof vi.fn<(e: OutboxEntry) => Promise<SendResult>>>
}

function setup(
  impl: (e: OutboxEntry) => Promise<SendResult> = async () => saleResult(1),
  opts: Partial<OutboxEngineOptions> = {},
  store = new InMemoryOutboxStore(),
): Harness {
  const sent: string[] = []
  const send = vi.fn(async (e: OutboxEntry) => {
    sent.push(e.id)
    return impl(e)
  })
  const engine = new OutboxEngine({
    owner: OWNER,
    store,
    send,
    random: () => 0.5,
    inFlight: new Map(),
    ...opts,
  })
  return { engine, store, sent, send }
}

async function seed(store: InMemoryOutboxStore, ...entries: OutboxEntry[]) {
  for (const e of entries) await store.put(e as unknown as StoredOutboxRecord)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse('2026-03-12T10:00:00+05:00'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('OutboxEngine ordering', () => {
  it('sends FIFO by createdAt, one at a time, and deletes on success', async () => {
    const h = setup()
    await seed(h.store, saleEntry('c', { createdAt: 3 }), saleEntry('a', { createdAt: 1 }), expenseEntry('b', { createdAt: 2 }))
    await h.engine.start()
    h.engine.setAuthReady(true)
    await h.engine.flush()
    await settle()
    expect(h.sent).toEqual(['a', 'b', 'c'])
    expect(h.store.records.size).toBe(0)
    expect(h.engine.getState().entries).toEqual([])
  })

  it('drops a sent entry from state at once, before the store delete finishes (no double count)', async () => {
    const store = new InMemoryOutboxStore()
    const gate = deferred<void>()
    const realDelete = store.delete.bind(store)
    store.delete = async (id: string) => { await gate.promise; return realDelete(id) }
    const h = setup(async () => saleResult(1), {}, store)
    await seed(store, saleEntry('a'))
    await h.engine.start()
    h.engine.setAuthReady(true)
    await settle()
    expect(h.sent).toEqual(['a'])
    expect(store.records.has('a')).toBe(true)
    expect(h.engine.getState().entries).toEqual([])
    await h.engine.refresh()
    expect(h.engine.getState().entries).toEqual([])
    gate.resolve()
    await settle()
    expect(store.records.size).toBe(0)
  })

  it('does not send before auth is ready', async () => {
    const h = setup()
    await seed(h.store, saleEntry('a'))
    await h.engine.start()
    await h.engine.flush()
    expect(h.sent).toEqual([])
  })

  it('never sends the next entry while one is in flight; never re-sends an in-flight entry', async () => {
    const first = deferred<SendResult>()
    const h = setup((e) => (e.id === 'a' ? first.promise : Promise.resolve(saleResult(2))))
    await seed(h.store, saleEntry('a', { createdAt: 1 }), saleEntry('b', { createdAt: 2 }))
    await h.engine.start()
    h.engine.setAuthReady(true)
    await settle()
    h.engine.trigger()
    h.engine.trigger()
    await settle()
    expect(h.sent).toEqual(['a'])
    expect(h.engine.getState().sendingIds).toEqual(['a'])
    first.resolve(saleResult(1))
    await settle(30)
    expect(h.sent).toEqual(['a', 'b'])
  })

  it('a remounted engine sharing the tab in-flight map waits instead of re-sending', async () => {
    const inFlight = new Map<string, Promise<unknown>>()
    const store = new InMemoryOutboxStore()
    const pending = deferred<SendResult>()
    const h1 = setup(() => pending.promise, { inFlight }, store)
    await seed(store, saleEntry('a'))
    await h1.engine.start()
    h1.engine.setAuthReady(true)
    await settle()
    expect(h1.sent).toEqual(['a'])
    h1.engine.dispose()

    const h2 = setup(async () => saleResult(9), { inFlight }, store)
    await h2.engine.start()
    h2.engine.setAuthReady(true)
    await h2.engine.flush()
    expect(h2.sent).toEqual([])

    pending.resolve(saleResult(1))
    await settle(30)
    expect(store.records.size).toBe(0)
    expect(h2.sent).toEqual([])
  })
})

describe('OutboxEngine errors', () => {
  it('backs off on transient errors (2s, 4s …) and keeps FIFO behind the failing head', async () => {
    let fail = true
    const h = setup(async () => {
      if (fail) throw new Error('network down')
      return saleResult(1)
    })
    await seed(h.store, saleEntry('a', { createdAt: 1 }), saleEntry('b', { createdAt: 2 }))
    await h.engine.start()
    h.engine.setAuthReady(true)
    await settle(20)
    expect(h.sent).toEqual(['a'])
    const a1 = h.engine.getState().entries.find((e) => e.id === 'a')!
    expect(a1.attempts).toBe(1)
    expect(a1.nextAttemptAt - Date.now()).toBe(2000)
    expect(a1.lastError?.reason).toBe('transient')

    await h.engine.flush()
    expect(h.sent).toEqual(['a'])

    await vi.advanceTimersByTimeAsync(2000)
    await settle(20)
    expect(h.sent).toEqual(['a', 'a'])
    const a2 = h.engine.getState().entries.find((e) => e.id === 'a')!
    expect(a2.attempts).toBe(2)
    expect(a2.nextAttemptAt - Date.now()).toBe(4000)

    fail = false
    await vi.advanceTimersByTimeAsync(4000)
    await settle(30)
    expect(h.sent).toEqual(['a', 'a', 'a', 'b'])
    expect(h.store.records.size).toBe(0)
  })

  it('backoff is min(2^n·2s, 5min) ±20%', () => {
    expect(backoffDelayMs(1, () => 0.5)).toBe(2000)
    expect(backoffDelayMs(3, () => 0.5)).toBe(8000)
    expect(backoffDelayMs(30, () => 0.5)).toBe(BACKOFF_MAX_MS)
    expect(backoffDelayMs(1, () => 0)).toBe(1600)
    expect(backoffDelayMs(1, () => 0.999999)).toBe(2400)
  })

  it('VALIDATION / NOT_FOUND → needsAttention, and the queue moves on', async () => {
    const h = setup(async (e) => {
      if (e.id === 'a') throw appErr('VALIDATION', 'Amount is too large')
      if (e.id === 'b') throw appErr('NOT_FOUND', 'Category not found')
      return saleResult(3)
    })
    await seed(h.store, saleEntry('a', { createdAt: 1 }), saleEntry('b', { createdAt: 2 }), saleEntry('c', { createdAt: 3 }))
    await h.engine.start()
    h.engine.setAuthReady(true)
    await settle(40)
    expect(h.sent).toEqual(['a', 'b', 'c'])
    const [a, b] = h.engine.getState().entries
    expect(a).toMatchObject({ id: 'a', status: 'needsAttention', lastError: { reason: 'validation', message: 'Amount is too large' } })
    expect(b).toMatchObject({ id: 'b', status: 'needsAttention', lastError: { reason: 'notFound' } })

    // needsAttention entries are not retried.
    await h.engine.flush()
    expect(h.sent).toEqual(['a', 'b', 'c'])
  })

  it('a future-date VALIDATION is classified as a wrong phone clock', () => {
    expect(classifyError(appErr('VALIDATION', 'Sale date cannot be in the future'))).toMatchObject({
      action: 'needsAttention',
      reason: 'clock',
    })
  })

  it('UNAUTHORIZED pauses until auth changes', async () => {
    let authed = false
    const h = setup(async () => {
      if (!authed) throw appErr('UNAUTHORIZED', 'Unauthorized')
      return saleResult(1)
    })
    await seed(h.store, saleEntry('a', { createdAt: 1 }), saleEntry('b', { createdAt: 2 }))
    await h.engine.start()
    h.engine.setAuthReady(true)
    await settle(20)
    expect(h.sent).toEqual(['a'])
    expect(h.engine.getState().paused?.reason).toBe('unauthorized')
    await h.engine.flush()
    expect(h.sent).toEqual(['a'])

    authed = true
    h.engine.setAuthReady(false)
    h.engine.setAuthReady(true)
    await settle(40)
    expect(h.engine.getState().paused).toBeNull()
    expect(h.sent).toEqual(['a', 'a', 'b'])
  })

  it('USER_NOT_FOUND pauses like UNAUTHORIZED; FORBIDDEN pauses and is shown', () => {
    expect(classifyError(appErr('USER_NOT_FOUND'))).toMatchObject({ action: 'pause', reason: 'unauthorized' })
    expect(classifyError(appErr('FORBIDDEN', 'Forbidden'))).toMatchObject({ action: 'pause', reason: 'forbidden', message: 'Forbidden' })
  })

  it('pauses (never retries without the id) when the backend rejects clientRequestId as an argument', async () => {
    const err = new Error(
      '[CONVEX M(saleSessions:record)] ArgumentValidationError: Object contains extra field `clientRequestId` that is not in the validator.',
    )
    const h = setup(async () => { throw err })
    await seed(h.store, saleEntry('a'))
    await h.engine.start()
    h.engine.setAuthReady(true)
    await settle(20)
    expect(h.engine.getState().paused?.reason).toBe('missingBackend')
    expect(h.sent).toEqual(['a'])
    // An auth change does not clear it; only retryNow does.
    h.engine.setAuthReady(false)
    h.engine.setAuthReady(true)
    await settle(20)
    expect(h.sent).toEqual(['a'])
    expect(h.send.mock.calls.every(([e]) => e.id === 'a')).toBe(true)
  })

  it('plain server errors are transient', () => {
    expect(classifyError(new Error('[CONVEX] Server Error'))).toMatchObject({ action: 'retry' })
  })
})

describe('OutboxEngine scoping and versions', () => {
  it('only reads and sends its own owner’s entries', async () => {
    const h = setup()
    await seed(h.store, saleEntry('mine'), saleEntry('theirs', { owner: 'user_b' }))
    await h.engine.start()
    expect(h.engine.getState().entries.map((e) => e.id)).toEqual(['mine'])
    h.engine.setAuthReady(true)
    await settle(20)
    expect(h.sent).toEqual(['mine'])
    expect(h.store.records.has('theirs')).toBe(true)
    await expect(h.engine.enqueue(saleEntry('x', { owner: 'user_b' }))).rejects.toThrow()
  })

  it('skips (keeps) entries of an unknown version', async () => {
    const h = setup()
    await h.store.put({ ...saleEntry('future'), v: 2 } as unknown as StoredOutboxRecord)
    await seed(h.store, saleEntry('now', { createdAt: 5 }))
    await h.engine.start()
    expect(h.engine.getState().skippedCount).toBe(1)
    h.engine.setAuthReady(true)
    await settle(20)
    expect(h.sent).toEqual(['now'])
    expect(h.store.records.has('future')).toBe(true)
  })
})

describe('OutboxEngine API', () => {
  it('enqueue persists, flushes, and waitFor resolves saved', async () => {
    const h = setup()
    await h.engine.start()
    h.engine.setAuthReady(true)
    const wait = h.engine.waitFor('a', 4000)
    await h.engine.enqueue(saleEntry('a'))
    await expect(wait).resolves.toEqual({ status: 'saved', result: saleResult(1) })
    expect(h.store.records.size).toBe(0)
  })

  it('waitFor resolves queued on timeout, and with the problem on needsAttention', async () => {
    const h = setup(async (e) => {
      if (e.id === 'bad') throw appErr('VALIDATION', 'Nope')
      return new Promise<SendResult>(() => {})
    })
    await h.engine.start()
    h.engine.setAuthReady(true)
    const slow = h.engine.waitFor('slow', 4000)
    await h.engine.enqueue(saleEntry('slow', { createdAt: 2 }))
    await vi.advanceTimersByTimeAsync(4000)
    await expect(slow).resolves.toEqual({ status: 'queued' })

    const h2 = setup(async () => { throw appErr('VALIDATION', 'Nope') })
    await h2.engine.start()
    h2.engine.setAuthReady(true)
    const bad = h2.engine.waitFor('bad', 4000)
    await h2.engine.enqueue(saleEntry('bad'))
    await expect(bad).resolves.toMatchObject({ status: 'queued', problem: { reason: 'validation', message: 'Nope' } })
  })

  it('enqueue rejects when the store write fails', async () => {
    const h = setup()
    await h.engine.start()
    h.store.failWrites = true
    await expect(h.engine.enqueue(saleEntry('a'))).rejects.toThrow('write failed')
    expect(h.engine.getState().entries).toEqual([])
  })

  it('discard removes an entry; update resets it to pending with the same id', async () => {
    const h = setup(async () => { throw appErr('NOT_FOUND', 'Category not found') })
    await seed(h.store, saleEntry('a', { args: { items: [{ productName: 'Chai', amount: 50, categoryId: 'c1' as never }], sessionDate: 1 } }))
    await h.engine.start()
    h.engine.setAuthReady(true)
    await settle(20)
    expect(h.engine.getState().entries[0]?.status).toBe('needsAttention')

    h.send.mockImplementation(async (e) => {
      h.sent.push(e.id)
      return saleResult(1)
    })
    await h.engine.update('a', (e) => (e.kind === 'sale'
      ? { ...e, args: { ...e.args, items: e.args.items.map(({ productName, amount }) => ({ productName, amount })) } }
      : e))
    await settle(30)
    const lastCall = h.send.mock.calls.at(-1)![0]
    expect(lastCall.id).toBe('a')
    expect(lastCall.kind === 'sale' && lastCall.args.items[0]?.categoryId).toBeUndefined()
    expect(h.store.records.size).toBe(0)

    await seed(h.store, expenseEntry('z'))
    await h.engine.refresh()
    await h.engine.discard('z')
    expect(h.store.records.size).toBe(0)
  })

  it('refuses to discard an entry that is being sent', async () => {
    const h = setup(() => new Promise<SendResult>(() => {}))
    await seed(h.store, saleEntry('a'))
    await h.engine.start()
    h.engine.setAuthReady(true)
    await settle(20)
    await expect(h.engine.discard('a')).rejects.toThrow(/being sent/)
  })

  it('retryNow clears backoff and sends at once', async () => {
    let fail = true
    const h = setup(async () => {
      if (fail) throw new Error('offline')
      return saleResult(1)
    })
    await seed(h.store, saleEntry('a'))
    await h.engine.start()
    h.engine.setAuthReady(true)
    await settle(20)
    fail = false
    await h.engine.retryNow()
    await settle(20)
    expect(h.sent).toEqual(['a', 'a'])
    expect(h.store.records.size).toBe(0)
  })

  it('cross-tab: a waiter resolves when another tab sends the entry', async () => {
    const bus = createBus()
    const store = new InMemoryOutboxStore()
    const tabA = setup(async () => saleResult(7), { broadcast: bus.member() }, store)
    const tabB = setup(async () => saleResult(8), { broadcast: bus.member() }, store)
    await tabA.engine.start()
    await tabB.engine.start()
    const wait = tabB.engine.waitFor('a', 4000)
    await tabB.engine.enqueue(saleEntry('a')) // tab B is not authed yet
    tabA.engine.setAuthReady(true)
    await tabA.engine.flush()
    await expect(wait).resolves.toEqual({ status: 'saved', result: saleResult(7) })
    await settle(20)
    expect(tabB.engine.getState().entries).toEqual([])
  })

  it('does nothing (and retries later) when another holder has the flush lock', async () => {
    const busy: LocksLike = { runExclusive: (_name, fn) => fn(false) }
    const h = setup(async () => saleResult(1), { locks: busy })
    await seed(h.store, saleEntry('a'))
    await h.engine.start()
    h.engine.setAuthReady(true)
    await settle(20)
    expect(h.sent).toEqual([])
    await vi.advanceTimersByTimeAsync(LOCK_BUSY_RETRY_MS)
    expect(h.sent).toEqual([])
  })
})

describe('platform fallbacks', () => {
  it('createLocks falls back to an in-tab lock without navigator.locks', async () => {
    const locks = createLocks({})
    const order: string[] = []
    const inner = deferred<void>()
    const p1 = locks.runExclusive('x', async (ok) => { order.push(`1:${ok}`); await inner.promise })
    await locks.runExclusive('x', async (ok) => { order.push(`2:${ok}`) })
    inner.resolve()
    await p1
    expect(order).toEqual(['1:true', '2:false'])
  })

  it('createLocks uses navigator.locks with ifAvailable', async () => {
    const request = vi.fn(async (_n: string, _o: unknown, cb: (lock: unknown) => Promise<void>) => cb({}))
    const locks = createLocks({ locks: { request } })
    let got: boolean | null = null
    await locks.runExclusive('rn-outbox:u', async (ok) => { got = ok })
    expect(got).toBe(true)
    expect(request).toHaveBeenCalledWith('rn-outbox:u', { ifAvailable: true, mode: 'exclusive' }, expect.any(Function))
    expect(createInTabLocks()).toBeTruthy()
  })

  it('client request ids match the server format, with and without randomUUID', () => {
    expect(newClientRequestId()).toMatch(CLIENT_REQUEST_ID_RE)
    expect(newClientRequestId({ getRandomValues: (a) => a })).toMatch(CLIENT_REQUEST_ID_RE)
    expect(newClientRequestId(undefined)).toMatch(CLIENT_REQUEST_ID_RE)
    expect(newClientRequestId({ randomUUID: () => { throw new Error('insecure') } })).toMatch(CLIENT_REQUEST_ID_RE)
  })
})
