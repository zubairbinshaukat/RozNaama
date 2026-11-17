import { useViewAsUserIdForQuery } from '@/context/ViewAsContext'
import type { Id } from '../../convex/_generated/dataModel'

export type ViewAsQueryPatch = { viewAsUserId: Id<'users'> } | Record<string, never>

/**
 * Spread into Convex query args: `{ viewAsUserId }` while an admin is viewing
 * another user, otherwise `{}` (so the arg is omitted entirely).
 */
export function useViewAsQueryPatch(): ViewAsQueryPatch {
  const id = useViewAsUserIdForQuery()
  return id !== undefined ? { viewAsUserId: id } : {}
}
