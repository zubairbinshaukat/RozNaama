import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import LoadMoreButton from './LoadMoreButton'

afterEach(cleanup)

describe('LoadMoreButton', () => {
  it('renders nothing while the first page loads', () => {
    const { container } = render(<LoadMoreButton status="LoadingFirstPage" onLoadMore={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when exhausted', () => {
    const { container } = render(<LoadMoreButton status="Exhausted" onLoadMore={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('calls onLoadMore when clicked and more can be loaded', () => {
    const onLoadMore = vi.fn()
    render(<LoadMoreButton status="CanLoadMore" onLoadMore={onLoadMore} />)
    const button = screen.getByRole('button', { name: 'Show More' })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('is disabled with a spinner while loading more', () => {
    const onLoadMore = vi.fn()
    render(<LoadMoreButton status="LoadingMore" onLoadMore={onLoadMore} />)
    const button = screen.getByRole('button', { name: 'Show More' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.querySelector('svg')).not.toBeNull()
    fireEvent.click(button)
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('has no spinner when idle and supports a custom label', () => {
    render(<LoadMoreButton status="CanLoadMore" onLoadMore={vi.fn()} label="Load older days" />)
    const button = screen.getByRole('button', { name: 'Load older days' })
    expect(button.querySelector('svg')).toBeNull()
  })
})
