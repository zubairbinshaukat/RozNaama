/**
 * Internal maintenance for the `clientRequests` idempotency ledger (never public).
 *
 *   npx convex run clientRequests:pruneClientRequests '{}'
 *   npx convex run --prod clientRequests:pruneClientRequests '{}'
 *
 * Deletes ledger rows older than CLIENT_REQUEST_RETENTION_MS (180 days), one
 * batch per mutation, rescheduling itself with the same fixed cutoff until a
 * batch comes back short. Not scheduled by a cron: run it by hand (it is a
 * no-op until rows are 180 days old).
 */
import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation } from './_generated/server'
import { CLIENT_REQUEST_RETENTION_MS } from './lib/limits'

const DEFAULT_BATCH = 500
const MAX_BATCH = 4000

export const pruneClientRequests = internalMutation({
  args: {
    /** Delete rows with createdAt < cutoff (ms). Default: now − 180 days. */
    cutoff:    v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    cutoff:      v.number(),
    deleted:     v.number(),
    rescheduled: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ cutoff: number; deleted: number; rescheduled: boolean }> => {
    const cutoff = args.cutoff ?? Date.now() - CLIENT_REQUEST_RETENTION_MS
    const requested = Math.floor(args.batchSize ?? DEFAULT_BATCH)
    const batchSize = Number.isFinite(requested)
      ? Math.min(Math.max(requested, 1), MAX_BATCH)
      : DEFAULT_BATCH

    const rows = await ctx.db
      .query('clientRequests')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', cutoff))
      .take(batchSize)
    for (const row of rows) {
      await ctx.db.delete('clientRequests', row._id)
    }

    const rescheduled = rows.length === batchSize
    if (rescheduled) {
      await ctx.scheduler.runAfter(0, internal.clientRequests.pruneClientRequests, {
        cutoff,
        batchSize,
      })
    }
    return { cutoff, deleted: rows.length, rescheduled }
  },
})
