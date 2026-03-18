import { useEffect, useMemo, useState } from 'react'
import { Download, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface IOSInstallModalProps {
  onClose: () => void
}

export default function IOSInstallModal({ onClose }: IOSInstallModalProps) {
  const [sharing, setSharing] = useState(false)

  const canShare = useMemo(() => {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  }, [])

  useEffect(() => {
    if (sharing) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, sharing])

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

  return (
    <div
      className="fixed inset-0 z-650 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ios-install-title"
    >
      <div
        className="absolute inset-0 bg-black/60 animate-modal-backdrop"
        onClick={() => { if (!sharing) onClose() }}
        aria-hidden
      />

      <div className="relative w-full max-w-md bg-card border border-border/70 rounded-2xl shadow-2xl animate-modal-content overflow-hidden">
        <div className="px-5 pt-5 pb-4 flex items-start gap-3 border-b border-border/60">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-primary/10">
            <Download size={18} className="text-primary" />
          </div>
          <div className="flex-1">
            <h2 id="ios-install-title" className="text-base font-semibold text-foreground">
              Add RozNaama to Home Screen
            </h2>
            <p className="text-sm text-muted-foreground mt-1 leading-snug">
              iOS doesn't support the automatic install prompt. Use the Share menu instead.
            </p>
          </div>
        </div>

        <div className="px-5 py-4">
          <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1">
            <li>Tap the Share icon in Safari.</li>
            <li>Select <span className="text-foreground font-medium">Add to Home Screen</span>.</li>
            <li>Tap <span className="text-foreground font-medium">Add</span>.</li>
          </ol>
        </div>

        <div className="px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-1 flex gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => { if (!sharing) onClose() }}
            disabled={sharing}
            className="flex-1 active:scale-[0.97]"
          >
            Done
          </Button>
          <Button
            type="button"
            onClick={handleShare}
            disabled={!canShare || sharing}
            className="flex-1 bg-gradient-brand hover:opacity-90 text-white border-0 gap-2 active:scale-[0.97]"
          >
            <Share2 size={16} />
            {sharing ? 'Opening…' : 'Open Share'}
          </Button>
        </div>
      </div>
    </div>
  )
}

