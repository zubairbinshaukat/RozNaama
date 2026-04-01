import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useViewAsUserIdForQuery } from '@/context/ViewAsContext'
import type { Id } from '../../convex/_generated/dataModel'

export type Category = {
  _id:       Id<'categories'>
  userId:    Id<'users'>
  name:      string
  color:     string
  createdAt: number
}

/** Returns the current user's categories, or undefined while loading */
export function useCategories(): Category[] | undefined {
  const viewAsUserId = useViewAsUserIdForQuery()
  return useQuery(api.categories.list, {
    ...(viewAsUserId !== undefined ? { viewAsUserId } : {}),
  }) as Category[] | undefined
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
