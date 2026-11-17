import { useId, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Sheet, { SheetBody, SheetHeader } from './Sheet'

afterEach(cleanup)

function Demo({ onClose, dismissible = true }: { onClose: () => void; dismissible?: boolean }) {
  const id = useId()
  return (
    <Sheet onClose={onClose} labelledBy={id} dismissible={dismissible}>
      <SheetHeader titleId={id} title="Demo" onClose={onClose} />
      <SheetBody>
        <button type="button">Inside</button>
        <input aria-label="Field" />
      </SheetBody>
    </Sheet>
  )
}

describe('Sheet', () => {
  it('renders a labelled modal dialog in a portal and locks page scroll', () => {
    const { unmount } = render(<Demo onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Demo' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('Escape closes only when dismissible', () => {
    const onClose = vi.fn()
    const { unmount } = render(<Demo onClose={onClose} dismissible={false} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    unmount()
    render(<Demo onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape closes only the top-most of stacked sheets', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    function Stacked() {
      const [showInner, setShowInner] = useState(true)
      return (
        <>
          <Demo onClose={outer} />
          {showInner && <Demo onClose={() => { inner(); setShowInner(false) }} />}
        </>
      )
    }
    render(<Stacked />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })

  it('returns focus to the opener when closed', () => {
    function Opener() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open</button>
          {open && <Demo onClose={() => setOpen(false)} />}
        </>
      )
    }
    render(<Opener />)
    const opener = screen.getByRole('button', { name: 'Open' })
    opener.focus()
    fireEvent.click(opener)
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(document.activeElement).toBe(opener)
  })

  describe('drag to close (phones)', () => {
    const drag = (el: Element, dx: number, dy: number) => {
      fireEvent.touchStart(el, { touches: [{ clientX: 100, clientY: 100 }] })
      fireEvent.touchMove(el, { touches: [{ clientX: 100 + dx / 2, clientY: 100 + dy / 2 }] })
      fireEvent.touchMove(el, { touches: [{ clientX: 100 + dx, clientY: 100 + dy }] })
      fireEvent.touchEnd(el, { touches: [] })
    }

    it('dragging down from anywhere on the sheet closes it', async () => {
      const onClose = vi.fn()
      render(<Demo onClose={onClose} />)
      drag(screen.getByRole('button', { name: 'Inside' }), 0, 400)
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    })

    it('a sideways swipe (e.g. calendar month) does not close it', async () => {
      const onClose = vi.fn()
      render(<Demo onClose={onClose} />)
      drag(screen.getByRole('dialog'), 300, 20)
      await new Promise((r) => setTimeout(r, 300))
      expect(onClose).not.toHaveBeenCalled()
    })

    it('dragging on a text field does not close it', async () => {
      const onClose = vi.fn()
      render(<Demo onClose={onClose} />)
      drag(screen.getByLabelText('Field'), 0, 400)
      await new Promise((r) => setTimeout(r, 300))
      expect(onClose).not.toHaveBeenCalled()
    })

    it('does nothing while not dismissible (saving)', async () => {
      const onClose = vi.fn()
      render(<Demo onClose={onClose} dismissible={false} />)
      drag(screen.getByRole('dialog'), 0, 400)
      await new Promise((r) => setTimeout(r, 300))
      expect(onClose).not.toHaveBeenCalled()
    })
  })
})