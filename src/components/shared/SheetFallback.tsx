/**
 * Suspense fallback while a lazily loaded sheet's code arrives (usually
 * instant: chunks are prefetched / precached). Same footprint as a Sheet:
 * bottom panel on phones, centred card from `sm` up. Skeleton shimmer only.
 */
export default function SheetFallback() {
  return (
    <div className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center" aria-hidden data-testid="sheet-fallback">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="skeleton w-10 h-10 rounded-2xl" />
          <div className="skeleton h-5 w-40 rounded-full" />
        </div>
        <div className="skeleton h-12 w-full rounded-2xl" />
        <div className="skeleton h-12 w-full rounded-2xl" />
        <div className="skeleton h-12 w-2/3 rounded-2xl" />
      </div>
    </div>
  )
}
