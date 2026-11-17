import { useEffect, useId, useState } from 'react'
import { Check, ListChecks, Search, SearchX, X } from 'lucide-react'
import Sheet, { SheetBody, SheetFooter, SheetHeader } from '@/components/shared/Sheet'
import LoadMoreButton from '@/components/dashboard/LoadMoreButton'
import { USERS_PAGE, useAdminUsers } from '@/hooks/useAdmin'
import { WATCHLIST_MAX, initialsOf } from '@/lib/admin'
import { btnOutline, btnPrimary, inputBase } from '@/lib/ui'
import { cn } from '@/lib/utils'
import { SEARCH_DEBOUNCE_MS } from './UsersList'

export type ChosenUser = { id: string; name: string }

/**
 * Searchable multi-select of all users (admin.listUsers, by name) for the
 * watchlist. Nothing changes until Save.
 */
export default function ChooseUsersSheet({
  initial,
  onSave,
  onClose,
}: {
  initial: readonly ChosenUser[]
  onSave: (users: ChosenUser[]) => void
  onClose: () => void
}) {
  const titleId = useId()
  const [chosen, setChosen] = useState<ChosenUser[]>(() => [...initial])
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(input.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [input])

  const { results, status, loadMore } = useAdminUsers(search, 'name')
  const chosenIds = new Set(chosen.map((c) => c.id))
  const full = chosen.length >= WATCHLIST_MAX

  const toggle = (id: string, name: string) => {
    setChosen((prev) =>
      prev.some((c) => c.id === id)
        ? prev.filter((c) => c.id !== id)
        : prev.length >= WATCHLIST_MAX ? prev : [...prev, { id, name }],
    )
  }

  return (
    <Sheet onClose={onClose} labelledBy={titleId} size="md">
      <SheetHeader
        titleId={titleId}
        title="Choose users"
        subtitle={`Show up to ${WATCHLIST_MAX} on your admin home`}
        icon={<ListChecks size={18} />}
        onClose={onClose}
      >
        <div className="relative mt-3">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" aria-hidden />
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search name or email"
            aria-label="Search users to choose"
            maxLength={100}
            className={cn(inputBase, 'pl-11 pr-12')}
          />
          {input.length > 0 && (
            <button
              type="button"
              onClick={() => setInput('')}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground active:scale-[0.97] transition-all"
            >
              <X size={18} />
            </button>
          )}
        </div>
        {chosen.length > 0 && (
          <ul className="flex gap-2 overflow-x-auto -mx-4 px-4 sm:-mx-5 sm:px-5 pt-3 pb-1" aria-label="Chosen users">
            {chosen.map((c) => (
              <li key={c.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => toggle(c.id, c.name)}
                  aria-label={`Remove ${c.name}`}
                  className="inline-flex items-center gap-1.5 min-h-11 pl-3 pr-2 rounded-full bg-primary/10 text-primary text-sm font-semibold active:scale-[0.97] transition-all"
                >
                  <span className="max-w-36 truncate">{c.name}</span>
                  <X size={16} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SheetHeader>

      <SheetBody className="flex flex-col gap-2">
        {status === 'LoadingFirstPage' ? (
          <div className="flex flex-col gap-2" aria-hidden data-testid="choose-skeleton">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 rounded-2xl skeleton" />)}
          </div>
        ) : results.length === 0 && status === 'Exhausted' ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <SearchX size={48} strokeWidth={1.5} aria-hidden />
            <p className="text-[15px]">{search ? `No one matches “${search}”` : 'No users yet'}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Users">
            {results.map((u) => {
              const on = chosenIds.has(u._id)
              const disabled = !on && full
              return (
                <li key={u._id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={disabled}
                    onClick={() => toggle(u._id, u.name)}
                    className={cn(
                      'w-full flex items-center gap-3 min-h-14 px-3 rounded-2xl border text-left active:scale-[0.97] transition-all disabled:opacity-50 disabled:active:scale-100',
                      on ? 'border-primary/40 bg-primary/5' : 'border-border/70 bg-card hover:bg-muted/50',
                    )}
                  >
                    <span className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-bold" aria-hidden>
                      {initialsOf(u.name)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[15px] font-semibold text-foreground truncate">{u.name}</span>
                      <span className="block text-[13px] text-muted-foreground truncate">{u.email}</span>
                    </span>
                    <span
                      className={cn(
                        'w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors',
                        on ? 'bg-primary border-primary text-primary-foreground' : 'border-border',
                      )}
                      aria-hidden
                    >
                      {on && <Check size={16} strokeWidth={3} />}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <LoadMoreButton status={status} onLoadMore={() => loadMore(USERS_PAGE)} />
      </SheetBody>

      <SheetFooter className="flex flex-col gap-2">
        {full && (
          <p role="status" className="text-[13px] text-muted-foreground text-center">
            That's the most ({WATCHLIST_MAX}). Remove one to add another.
          </p>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={cn(btnOutline, 'flex-1')}>Cancel</button>
          <button type="button" onClick={() => onSave(chosen)} className={cn(btnPrimary, 'flex-1')}>
            <Check size={18} /> Save{chosen.length > 0 ? ` (${chosen.length})` : ''}
          </button>
        </div>
      </SheetFooter>
    </Sheet>
  )
}
