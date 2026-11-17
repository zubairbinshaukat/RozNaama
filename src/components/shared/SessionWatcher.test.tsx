import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

const auth = { isLoaded: true, isSignedIn: true as boolean | undefined }
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isLoaded: auth.isLoaded, isSignedIn: auth.isSignedIn }),
  useUser: () => ({ user: auth.isSignedIn ? { id: 'user_1', firstName: 'Ali', fullName: 'Ali Khan' } : null }),
}))
vi.mock('convex/react', () => ({
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: true }),
}))
const clearSnapshot = vi.fn(async (userId: string) => { void userId })
vi.mock('@/lib/offline/snapshot', () => ({
  clearSnapshot: (userId: string) => clearSnapshot(userId),
}))

import SessionWatcher from './SessionWatcher'
import { readLastUserHint } from '@/lib/userHints'

let online = true

beforeEach(() => {
  online = true
  auth.isLoaded = true
  auth.isSignedIn = true
  localStorage.clear()
  clearSnapshot.mockClear()
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SessionWatcher rn-last-user hint', () => {
  it('writes {id, name} for the signed-in user', () => {
    render(<SessionWatcher />)
    expect(readLastUserHint()).toEqual({ id: 'user_1', name: 'Ali' })
  })

  it('keeps the hint when signed out while offline', () => {
    render(<SessionWatcher />)
    cleanup()
    online = false
    auth.isSignedIn = false
    render(<SessionWatcher />)
    expect(readLastUserHint()).toEqual({ id: 'user_1', name: 'Ali' })
    expect(clearSnapshot).not.toHaveBeenCalled()
  })

  it('clears the hint and that user\'s snapshot on a confirmed online sign-out', () => {
    render(<SessionWatcher />)
    cleanup()
    auth.isSignedIn = false
    render(<SessionWatcher />)
    expect(readLastUserHint()).toBeNull()
    expect(clearSnapshot).toHaveBeenCalledWith('user_1')
  })

  it('does nothing while Clerk is still loading', () => {
    localStorage.setItem('rn-last-user', JSON.stringify({ id: 'user_1', name: 'Ali' }))
    auth.isLoaded = false
    auth.isSignedIn = undefined
    render(<SessionWatcher />)
    expect(readLastUserHint()).toEqual({ id: 'user_1', name: 'Ali' })
  })
})
