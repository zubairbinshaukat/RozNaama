import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Search, SearchX, X } from 'lucide-react'
import Amount from '@/components/shared/Amount'
import EmptyState from '@/components/shared/EmptyState'
import LoadMoreButton from '@/components/dashboard/LoadMoreButton'
import { USERS_PAGE, useAdminUsers, type AdminUserRow } from '@/hooks/useAdmin'
import { USER_SORTS, lastActiveLabel, sortLoadedUsers, type UserSortId } from '@/lib/admin'
import { chip, chipActive, chipIdle, inputBase } from '@/lib/ui'
import { cn } from '@/lib/utils'

/** Wait this long after the last keystroke before searching on the server. */
export const SEARCH_DEBOUNCE_MS = 300

function UserRow({ user }: { user: AdminUserRow }) {
  const last = lastActiveLabel(user.lastActivityAt)
  return (
    <li>
      <Link
        to={`/admin/users/${user._id}`}
        className="w-full flex items-center gap-3 text-left rounded-2xl border border-border/70 bg-card px-4 py-3 min-h-18 hover:bg-muted/50 active:scale-[0.97] transition-all duration-150"
      >
        <span className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-base font-bold" aria-hidden>
          {user.name.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-base font-semibold text-foreground truncate">{user.name}</span>
          <span className="block text-[13px] text-muted-foreground truncate">{user.email}</span>
          <span className={cn('block text-[13px] font-medium', last === 'Today' ? 'text-positive' : 'text-muted-foreground')}>
            Last active: {last}
          </span>
        </span>
        <span className="shrink-0 flex flex-col items-end gap-0.5 text-right">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Today</span>
          <Amount value={user.todaySales} className="text-sm font-bold text-foreground" />
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Month</span>
          <Amount value={user.monthSales} className="text-sm font-semibold text-foreground" />
        </span>
        <ChevronRight size={16} className="text-muted-foreground shrink-0" aria-hidden />
      </Link>
    </li>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden data-testid="users-skeleton">
      {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 rounded-2xl skeleton" />)}
    </div>
  )
}

/** Searchable, sortable, paginated user list (admin.listUsers). Tap a row → user detail. */
export default function UsersList() {
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<UserSortId>('recent')

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(input.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [input])

  const sortDef = USER_SORTS.find((s) => s.id === sort) ?? USER_SORTS[0]
  const { results, status, loadMore } = useAdminUsers(search, sortDef.server)
  const rows = useMemo(() => sortLoadedUsers(results, sort), [results, sort])
  const clientSorted = sort === 'recent' || sort === 'allTime'

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" aria-hidden />
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search name or email"
          aria-label="Search users by name or email"
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

      <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1" role="group" aria-label="Sort users">
        {USER_SORTS.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={sort === s.id}
            onClick={() => setSort(s.id)}
            className={cn(chip, sort === s.id ? chipActive : chipIdle)}
          >
            {s.label}
          </button>
        ))}
      </div>
      {clientSorted && status !== 'LoadingFirstPage' && status !== 'Exhausted' && (
        <p className="px-1 text-[13px] text-muted-foreground">
          Sorted among the {rows.length} users loaded. Tap Show More to include more.
        </p>
      )}

      {status === 'LoadingFirstPage' ? (
        <ListSkeleton />
      ) : rows.length === 0 && status === 'Exhausted' ? (
        <EmptyState
          icon={<SearchX size={48} strokeWidth={1.5} />}
          title={search ? 'No users match' : 'No users yet'}
          message={search ? `Nobody's name or email contains “${search}”.` : 'Users appear here after they sign in.'}
          showActions={false}
        />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Users">
          {rows.map((u) => <UserRow key={u._id} user={u} />)}
        </ul>
      )}
      <LoadMoreButton status={status} onLoadMore={() => loadMore(USERS_PAGE)} />
    </div>
  )
}
