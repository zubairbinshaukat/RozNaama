import { useEffect, useMemo, useState } from 'react'
import { Eye, ListChecks } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import { useToast } from '@/components/shared/Toast'
import { useWatchSummaries, useWatchlist } from '@/hooks/useAdmin'
import { btnPrimary } from '@/lib/ui'
import ChooseUsersSheet, { type ChosenUser } from './ChooseUsersSheet'
import WatchCard from './WatchCard'
import { useImpersonate } from './useImpersonate'

const GRID = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'

function WatchSkeleton({ count }: { count: number }) {
  return (
    <div className={GRID} aria-hidden data-testid="watch-skeleton">
      {Array.from({ length: Math.min(Math.max(count, 1), 6) }).map((_, i) => (
        <div key={i} className="rounded-3xl border border-border/70 bg-card p-4 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="skeleton w-11 h-11 rounded-full" />
            <div className="flex-1 flex flex-col gap-2">
              <div className="skeleton h-4 w-32 rounded-full" />
              <div className="skeleton h-3 w-40 rounded-full" />
            </div>
          </div>
          <div className="skeleton h-4 w-48 rounded-full" />
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((k) => <div key={k} className="skeleton h-16 rounded-2xl" />)}
          </div>
          <div className="skeleton h-11 rounded-2xl" />
        </div>
      ))}
    </div>
  )
}

/** Admin home: cards for the users the admin chose to keep an eye on (this device). */
export default function Watchlist() {
  const { ids, save } = useWatchlist()
  const rows = useWatchSummaries(ids)
  const impersonate = useImpersonate()
  const { showToast } = useToast()
  const [choosing, setChoosing] = useState(false)

  // Drop users that no longer exist (the server skips them).
  useEffect(() => {
    if (rows && ids.length > 0 && rows.length < ids.length) {
      const alive = new Set(rows.map((r) => r.userId as string))
      const kept = ids.filter((id) => alive.has(id))
      if (kept.length !== ids.length) save(kept)
    }
  }, [rows, ids, save])

  const initial = useMemo((): ChosenUser[] => {
    const names = new Map((rows ?? []).map((r) => [r.userId as string, r.name]))
    return ids.map((id) => ({ id, name: names.get(id) ?? 'User' }))
  }, [ids, rows])

  const onSave = (users: ChosenUser[]) => {
    save(users.map((u) => u.id))
    setChoosing(false)
    showToast(users.length === 0 ? 'Watchlist cleared' : `Watching ${users.length} ${users.length === 1 ? 'user' : 'users'}`, 'success')
  }

  const chooseButton = (
    <button type="button" onClick={() => setChoosing(true)} className={btnPrimary}>
      <ListChecks size={18} /> Choose users
    </button>
  )

  return (
    <section aria-labelledby="watchlist-heading" className="flex flex-col gap-3">
      <div className="flex items-center gap-2 min-h-11">
        <h2 id="watchlist-heading" className="flex-1 text-lg font-bold text-foreground">Watchlist</h2>
        {ids.length > 0 && (
          <button
            type="button"
            onClick={() => setChoosing(true)}
            className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-full text-sm font-semibold text-primary hover:bg-primary/8 active:scale-[0.97] transition-all"
          >
            <ListChecks size={18} aria-hidden /> Edit ({ids.length})
          </button>
        )}
      </div>

      {ids.length === 0 ? (
        <EmptyState
          icon={<Eye size={48} strokeWidth={1.5} />}
          title="Pick the shops you want to keep an eye on"
          message="Their latest entry and today's, this week's and this month's sales show up here."
          showActions={false}
          action={chooseButton}
        />
      ) : rows === undefined ? (
        <WatchSkeleton count={ids.length} />
      ) : (
        <div className={GRID}>
          {rows.map((row) => <WatchCard key={row.userId} row={row} onAccess={impersonate} />)}
        </div>
      )}

      {choosing && <ChooseUsersSheet initial={initial} onSave={onSave} onClose={() => setChoosing(false)} />}
    </section>
  )
}
