import { useMemo } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useViewAsUserIdForQuery } from '@/context/ViewAsContext'
import { useLiveQueriesEnabled, useSnapshotAccess, useSnapshotWriter } from './offlineData'
import type { SnapshotPatch } from '@/lib/offline/snapshot'
import type { Id } from '../../convex/_generated/dataModel'

export type Category = {
  _id:       Id<'categories'>
  userId:    Id<'users'>
  name:      string
  color:     string
  createdAt: number
}

/** Returns the current user's categories (live, else the snapshot), or undefined while loading */
export function useCategories(): Category[] | undefined {
  const viewAsUserId = useViewAsUserIdForQuery()
  const ready = useLiveQueriesEnabled()
  const live = useQuery(api.categories.list, ready ? {
    ...(viewAsUserId !== undefined ? { viewAsUserId } : {}),
  } : 'skip') as Category[] | undefined
  const snap = useSnapshotAccess()
  const patch = useMemo(
    (): SnapshotPatch | null => (live !== undefined ? { kind: 'categories', value: live } : null),
    [live],
  )
  useSnapshotWriter(snap.canWrite ? patch : null, snap.write)
  return live ?? snap.record?.categories ?? undefined
}

/** Returns a mutation to create a category */
export function useCreateCategory() {
  return useMutation(api.categories.create)
}

/** Returns a mutation to update a category's name/color */
export function useUpdateCategory() {
  return useMutation(api.categories.update)
}

/** Returns a mutation to delete a category */
export function useRemoveCategory() {
  return useMutation(api.categories.remove)
}
