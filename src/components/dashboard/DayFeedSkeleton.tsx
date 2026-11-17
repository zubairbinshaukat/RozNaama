/** Shimmer placeholders shaped like day cards while the first day-feed page loads. */
export default function DayFeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true" data-testid="day-feed-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-3xl border border-border/70 bg-card p-3.5 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="skeleton w-12 h-13 rounded-2xl" />
            <div className="flex-1 flex flex-col gap-2">
              <div className="skeleton h-4 w-24 rounded-full" />
              <div className="skeleton h-3 w-32 rounded-full" />
            </div>
            <div className="skeleton h-9 w-20 rounded-xl" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="skeleton h-10 rounded-xl" />
            <div className="skeleton h-10 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  )
}
