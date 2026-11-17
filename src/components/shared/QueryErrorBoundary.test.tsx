import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConvexError } from 'convex/values'
import { ConvexProvider, type ConvexReactClient } from 'convex/react'
import QueryErrorBoundary from './QueryErrorBoundary'

let shouldThrow: unknown = null

function Thrower() {
  if (shouldThrow !== null) throw shouldThrow
  return <p>section content</p>
}

beforeEach(() => {
  shouldThrow = null
  // React logs caught errors to console.error; keep test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('QueryErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(<QueryErrorBoundary><Thrower /></QueryErrorBoundary>)
    expect(screen.getByText('section content')).toBeTruthy()
  })

  it('renders the default fallback for a non-Convex error (never raw message)', () => {
    shouldThrow = new Error('internal stack trace detail')
    render(<QueryErrorBoundary><Thrower /></QueryErrorBoundary>)
    expect(screen.getByRole('alert').textContent).toContain('Something went wrong loading this section')
    expect(screen.queryByText(/internal stack trace/)).toBeNull()
  })

  it('shows the ConvexError server message', () => {
    shouldThrow = new ConvexError({ code: 'VALIDATION', message: 'Bad range' })
    render(<QueryErrorBoundary><Thrower /></QueryErrorBoundary>)
    expect(screen.getByText('Bad range')).toBeTruthy()
  })

  it('Retry resets the boundary and remounts children (after a tick)', async () => {
    shouldThrow = new Error('boom')
    render(<QueryErrorBoundary><Thrower /></QueryErrorBoundary>)
    expect(screen.getByRole('alert')).toBeTruthy()
    shouldThrow = null
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    // Children stay unmounted (busy placeholder) until the remount.
    expect(screen.queryByText('section content')).toBeNull()
    expect(await screen.findByText('section content')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('Retry shows the card again when the query still fails', async () => {
    shouldThrow = new ConvexError({ code: 'VALIDATION', message: 'Still bad' })
    render(<QueryErrorBoundary><Thrower /></QueryErrorBoundary>)
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Still bad')).toBeTruthy()
  })

  it('renders a Close button only when onDismiss is given', () => {
    shouldThrow = new Error('boom')
    const onDismiss = vi.fn()
    const { unmount } = render(<QueryErrorBoundary><Thrower /></QueryErrorBoundary>)
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull()
    unmount()
    render(<QueryErrorBoundary onDismiss={onDismiss}><Thrower /></QueryErrorBoundary>)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  describe('with a Convex client (Retry waits for the cached error to be dropped)', () => {
    function fakeClient() {
      const handlers = new Set<() => void>()
      const client = {
        sync: {
          addOnTransitionHandler(fn: () => void) {
            handlers.add(fn)
            return () => handlers.delete(fn)
          },
        },
      }
      const transition = () => act(() => { for (const fn of [...handlers]) fn() })
      return { client: client as unknown as ConvexReactClient, handlers, transition }
    }

    afterEach(() => {
      vi.useRealTimers()
    })

    it('remounts on the next client transition, not before', () => {
      vi.useFakeTimers()
      const { client, handlers, transition } = fakeClient()
      shouldThrow = new Error('boom')
      render(
        <ConvexProvider client={client}>
          <QueryErrorBoundary><Thrower /></QueryErrorBoundary>
        </ConvexProvider>,
      )
      expect(handlers.size).toBe(1)
      shouldThrow = null
      fireEvent.click(screen.getByRole('button', { name: /retry/i }))
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.queryByText('section content')).toBeNull()
      transition()
      act(() => { vi.advanceTimersByTime(0) })
      expect(screen.getByText('section content')).toBeTruthy()
      expect(handlers.size).toBe(0)
    })

    it('remounts at once when a transition already happened since the error', () => {
      vi.useFakeTimers()
      const { client, transition } = fakeClient()
      shouldThrow = new Error('boom')
      render(
        <ConvexProvider client={client}>
          <QueryErrorBoundary><Thrower /></QueryErrorBoundary>
        </ConvexProvider>,
      )
      act(() => { vi.advanceTimersByTime(0) }) // failed children have unsubscribed
      transition()
      shouldThrow = null
      fireEvent.click(screen.getByRole('button', { name: /retry/i }))
      act(() => { vi.advanceTimersByTime(0) })
      expect(screen.getByText('section content')).toBeTruthy()
    })

    it('ignores a transition that lands before the failed children unsubscribed (N2)', () => {
      vi.useFakeTimers()
      const { client, transition } = fakeClient()
      shouldThrow = new Error('boom')
      render(
        <ConvexProvider client={client}>
          <QueryErrorBoundary><Thrower /></QueryErrorBoundary>
        </ConvexProvider>,
      )
      transition() // same tick as the catch → cache may still be live
      shouldThrow = null
      fireEvent.click(screen.getByRole('button', { name: /retry/i }))
      act(() => { vi.advanceTimersByTime(0) })
      expect(screen.queryByText('section content')).toBeNull()
      act(() => { vi.advanceTimersByTime(2000) }) // falls back to the timeout
      expect(screen.getByText('section content')).toBeTruthy()
    })

    it('falls back to a timeout when no transition arrives', () => {
      vi.useFakeTimers()
      const { client } = fakeClient()
      shouldThrow = new Error('boom')
      render(
        <ConvexProvider client={client}>
          <QueryErrorBoundary><Thrower /></QueryErrorBoundary>
        </ConvexProvider>,
      )
      shouldThrow = null
      fireEvent.click(screen.getByRole('button', { name: /retry/i }))
      act(() => { vi.advanceTimersByTime(1999) })
      expect(screen.queryByText('section content')).toBeNull()
      act(() => { vi.advanceTimersByTime(1) })
      expect(screen.getByText('section content')).toBeTruthy()
    })

    it('uses a fixed delay when the client exposes no transition hook', () => {
      vi.useFakeTimers()
      shouldThrow = new Error('boom')
      render(
        <ConvexProvider client={{} as unknown as ConvexReactClient}>
          <QueryErrorBoundary><Thrower /></QueryErrorBoundary>
        </ConvexProvider>,
      )
      shouldThrow = null
      fireEvent.click(screen.getByRole('button', { name: /retry/i }))
      act(() => { vi.advanceTimersByTime(999) })
      expect(screen.queryByText('section content')).toBeNull()
      act(() => { vi.advanceTimersByTime(1) })
      expect(screen.getByText('section content')).toBeTruthy()
    })
  })

  it('resets when resetKeys change', () => {
    shouldThrow = new Error('boom')
    const { rerender } = render(
      <QueryErrorBoundary resetKeys={['a']}><Thrower /></QueryErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    shouldThrow = null
    rerender(<QueryErrorBoundary resetKeys={['b']}><Thrower /></QueryErrorBoundary>)
    expect(screen.getByText('section content')).toBeTruthy()
  })

  it('calls onViewAsInvalid for FORBIDDEN while viewing another user, then resets', () => {
    shouldThrow = new ConvexError({ code: 'FORBIDDEN', message: 'Forbidden' })
    const onViewAsInvalid = vi.fn()
    const { rerender } = render(
      <QueryErrorBoundary isViewingOther onViewAsInvalid={onViewAsInvalid}>
        <Thrower />
      </QueryErrorBoundary>,
    )
    expect(onViewAsInvalid).toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()

    // Caller clears view-as → boundary resets and shows own data.
    shouldThrow = null
    rerender(
      <QueryErrorBoundary isViewingOther={false} onViewAsInvalid={onViewAsInvalid}>
        <Thrower />
      </QueryErrorBoundary>,
    )
    expect(screen.getByText('section content')).toBeTruthy()
  })

  it('handles legacy string USER_NOT_FOUND payloads as view-as invalid', () => {
    shouldThrow = new ConvexError('User not found')
    const onViewAsInvalid = vi.fn()
    render(
      <QueryErrorBoundary isViewingOther onViewAsInvalid={onViewAsInvalid}>
        <Thrower />
      </QueryErrorBoundary>,
    )
    expect(onViewAsInvalid).toHaveBeenCalled()
  })

  it('does not call onViewAsInvalid when viewing own data', () => {
    shouldThrow = new ConvexError({ code: 'FORBIDDEN', message: 'Forbidden' })
    const onViewAsInvalid = vi.fn()
    render(
      <QueryErrorBoundary isViewingOther={false} onViewAsInvalid={onViewAsInvalid}>
        <Thrower />
      </QueryErrorBoundary>,
    )
    expect(onViewAsInvalid).not.toHaveBeenCalled()
    expect(screen.getByText('Forbidden')).toBeTruthy()
  })
})
