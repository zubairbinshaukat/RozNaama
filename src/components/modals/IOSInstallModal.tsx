import { useId, useMemo, useState } from 'react'
import { Download, Share2, SquarePlus, Check } from 'lucide-react'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import { cn } from '@/lib/utils'
import { btnPrimary, btnSecondary } from '@/lib/ui'

interface IOSInstallModalProps {
  onClose: () => void
}

const STEPS = [
  { icon: Share2, text: <>Tap the <b className="text-foreground">Share</b> icon in Safari.</> },
  { icon: SquarePlus, text: <>Choose <b className="text-foreground">Add to Home Screen</b>.</> },
  { icon: Check, text: <>Tap <b className="text-foreground">Add</b>. RozNaama now opens like an app.</> },
]

export default function IOSInstallModal({ onClose }: IOSInstallModalProps) {
  const [sharing, setSharing] = useState(false)
  const titleId = useId()

  const canShare = useMemo(() => {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  }, [])

  const handleShare = async () => {
    if (!canShare || sharing) return
    setSharing(true)
    try {
      await navigator.share({
        title: 'RozNaama',
        url: window.location.href,
      })
    } catch {
      // User may cancel the share sheet; ignore.
    } finally {
      setSharing(false)
    }
  }

  const close = () => { if (!sharing) onClose() }

  return (
    <Sheet onClose={close} dismissible={!sharing} labelledBy={titleId} layer={650}>
      <SheetHeader
        titleId={titleId}
        title="Add RozNaama to Home Screen"
        subtitle="iPhone doesn't show an install button. It takes 3 taps:"
        icon={<Download size={18} />}
        onClose={close}
        closeDisabled={sharing}
      />
      <SheetBody>
        <ol className="flex flex-col gap-2.5">
          {STEPS.map((s, i) => (
            <li key={i} className="flex items-center gap-3 rounded-2xl bg-muted/50 px-3.5 py-3">
              <span className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-sm font-bold" aria-hidden>
                {i + 1}
              </span>
              <s.icon size={18} className="text-muted-foreground shrink-0" aria-hidden />
              <span className="text-[15px] text-muted-foreground">{s.text}</span>
            </li>
          ))}
        </ol>
      </SheetBody>
      <SheetFooter>
        <div className="flex gap-3">
          <button type="button" onClick={close} disabled={sharing} className={cn(btnSecondary, 'flex-1')}>
            Done
          </button>
          <button type="button" onClick={handleShare} disabled={!canShare || sharing} className={cn(btnPrimary, 'flex-1')}>
            <Share2 size={18} />
            {sharing ? 'Opening…' : 'Open Share'}
          </button>
        </div>
      </SheetFooter>
    </Sheet>
  )
}
