import { describe, expect, it, vi } from 'vitest'
import { subscribeToTransitions } from './convexTransitions'

describe('subscribeToTransitions', () => {
  it('returns null for missing / closed / unsupported clients', () => {
    expect(subscribeToTransitions(undefined, vi.fn())).toBeNull()
    expect(subscribeToTransitions({}, vi.fn())).toBeNull()
    const closed = {
      get sync(): unknown {
        throw new Error('ConvexReactClient has already been closed.')
      },
    }
    expect(subscribeToTransitions(closed, vi.fn())).toBeNull()
  })

  it('forwards transitions and unsubscribes', () => {
    const handlers = new Map<number, () => void>()
    let next = 0
    const client = {
      sync: {
        addOnTransitionHandler(fn: () => void) {
          const id = next++
          handlers.set(id, fn)
          return () => handlers.delete(id)
        },
      },
    }
    const cb = vi.fn()
    const off = subscribeToTransitions(client, cb)
    expect(off).not.toBeNull()
    for (const fn of handlers.values()) fn()
    expect(cb).toHaveBeenCalledTimes(1)
    off?.()
    expect(handlers.size).toBe(0)
  })
})
