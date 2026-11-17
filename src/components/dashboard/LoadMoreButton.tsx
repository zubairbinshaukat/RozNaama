import { Loader2 } from 'lucide-react'

export type LoadMoreStatus = 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted'

interface LoadMoreButtonProps {
  status:     LoadMoreStatus
  onLoadMore: () => void
  label?:     string
}

/**
 * "Show More" button for `usePaginatedQuery` lists. Hidden while the first
 * page loads and once the list is exhausted; disabled with a spinner while
 * the next page is loading.
 */
export default function LoadMoreButton({ status, onLoadMore, label = 'Show More' }: LoadMoreButtonProps) {
  if (status === 'Exhausted' || status === 'LoadingFirstPage') return null

  const loading = status === 'LoadingMore'

  return (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={() => { if (status === 'CanLoadMore') onLoadMore() }}
        disabled={loading}
        aria-busy={loading}
        className="inline-flex items-center justify-center gap-2 min-h-12 w-full sm:w-auto px-6 rounded-2xl border border-border bg-card text-base font-semibold text-foreground hover:bg-muted/60 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.97] transition-all"
      >
        {loading && (
          <Loader2 size={18} aria-hidden="true" className="animate-[spin_1s_linear_infinite]" />
        )}
        <span>{label}</span>
      </button>
    </div>
  )
}
