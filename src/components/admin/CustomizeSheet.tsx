import { useId } from 'react'
import { Eye, EyeOff, SlidersHorizontal } from 'lucide-react'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import { useToast } from '@/components/shared/Toast'
import { ADMIN_CARDS } from '@/lib/admin'
import { btnOutline, btnSecondary } from '@/lib/ui'
import { cn } from '@/lib/utils'
import { useCardPrefs } from './cardPrefs'

const GROUPS = [...new Set(ADMIN_CARDS.map((c) => c.group))]

/** Show / hide each admin card on this device (localStorage). */
export default function CustomizeSheet({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const { isHidden, toggle, showAll, hiddenCount } = useCardPrefs()
  const { showToast } = useToast()

  return (
    <Sheet onClose={onClose} labelledBy={titleId} size="md">
      <SheetHeader
        titleId={titleId}
        title="Customize"
        subtitle="Choose which cards to show. Saved on this device."
        icon={<SlidersHorizontal size={18} />}
        onClose={onClose}
      />
      <SheetBody className="flex flex-col gap-5">
        {GROUPS.map((group) => (
          <section key={group} aria-label={group} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground px-1">{group}</h3>
            <ul className="flex flex-col gap-2">
              {ADMIN_CARDS.filter((c) => c.group === group).map((c) => {
                const shown = !isHidden(c.id)
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={shown}
                      onClick={() => toggle(c.id)}
                      className={cn(
                        'w-full flex items-center gap-3 min-h-12 px-4 rounded-2xl border text-left text-[15px] font-semibold active:scale-[0.97] transition-all',
                        shown ? 'border-primary/30 bg-primary/5 text-foreground' : 'border-border bg-card text-muted-foreground',
                      )}
                    >
                      {shown ? <Eye size={18} className="text-primary shrink-0" /> : <EyeOff size={18} className="shrink-0" />}
                      <span className="flex-1">{c.label}</span>
                      <span className="text-[13px] font-medium">{shown ? 'Shown' : 'Hidden'}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </SheetBody>
      <SheetFooter className="flex gap-2">
        <button
          type="button"
          disabled={hiddenCount === 0}
          onClick={() => {
            showAll()
            showToast('All cards are shown again', 'success')
          }}
          className={cn(btnOutline, 'flex-1')}
        >
          <Eye size={18} /> Show all
        </button>
        <button type="button" onClick={onClose} className={cn(btnSecondary, 'flex-1')}>Done</button>
      </SheetFooter>
    </Sheet>
  )
}
