import { BookOpenText } from 'lucide-react'

/** Small "Udhaar on" badge for users who turned Advance & Udhaar on. */
export default function KhataChip() {
  return (
    <span className="inline-flex items-center gap-1 shrink-0 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-semibold">
      <BookOpenText size={12} aria-hidden /> Udhaar on
    </span>
  )
}