# Convex v2 rollout runbook

This runbook covers the backend hardening and summary tables on branch `v2`: `dailyTotals`, `totalsState`, `userTotals`, `categoryStats`, the read-only audit, the migrations and the day feed. You run every command here yourself, in PowerShell from the repo root.

- **Dev deployment:** `dev:ideal-kookabura-797`. `.env.local` sets `CONVEX_DEPLOYMENT` to it, so a plain `npx convex …` targets dev.
- **Prod:** add `--prod` to every command (`npx convex run --prod …`, `npx convex env set --prod …`).
- **JSON args:** wrap the JSON in single quotes, e.g. `npx convex run audit:run '{}'`. This works in PowerShell 7 (verified on dev). Do not use `--%`: it breaks through `npx.cmd`. Flags such as `--prod` can go before or after the function name.

## What changes and what stays the same

- **One deploy, no read cutover.** Every read checks each user at runtime. It uses the summary tables only when that user's `totalsState.totalsReady` is true, the request `timeZone` equals `totalsState.timeZone`, and the env var `TOTALS_READS` is not `off`. Until the backfill finishes for a user, that user's reads use the legacy scan, which gives the same numbers.
- **Write hooks start at deploy.** Every write updates the summary tables from the moment of deploy, even before the backfill. The rebuild then fixes the history.
- **Schema changes are additive.**
  - `users` gets the optional fields `tokenIdentifier` and `timeZone`, plus the index `by_token`.
  - `sales` gets the index `by_userId_categoryId_saleDate`.
  - New tables: `dailyTotals`, `totalsState`, `userTotals`, `categoryStats`, plus the `migrations` component tables.
  - `totalsState` holds the read gate (zone, `totalsReady`, `categoryCountsReady`) and changes rarely. `userTotals` holds the all-time sums and the rebuild cursor and changes on every write. They are separate so that chart, list and category queries do not re-run on every write.
- **Old cached PWA clients keep working.** Every old query and mutation keeps its name, args and return shape. The old list queries are only marked `@deprecated`, to be removed after 2026-12-17.
- **Users are linked to their Clerk account on login.** Each `users` row stores the Clerk `tokenIdentifier` (`issuer|subject`) the first time that person signs in after the deploy. Later sign-ins with the same email but a *different* Clerk user id are refused with "This email is linked to a different account. Please contact support." A change of issuer only (same Clerk user id, e.g. a new Frontend API domain) is accepted and relinked.
  - **Moving to a new Clerk instance (e.g. dev → prod keys) gives every user a new user id**, so already-linked users would be locked out. Before such a move, clear `tokenIdentifier` on all `users` rows (they relink by email on next login), or write a migration that maps old subjects to new ones.

---

## 0. Pre-flight

```powershell
npm ci
npm test
npm run lint
npm run build
npm run typecheck:convex
```

All four checks must pass: tests green, lint at 0 errors and 0 warnings, build OK, typecheck OK.

Make sure Clerk auth is configured on **both** deployments. `convex/auth.config.ts` reads `CLERK_JWT_ISSUER_DOMAIN`, and a push fails or auth breaks without it.

```powershell
npx convex env list
npx convex env list --prod
# If it is missing on dev (use your Clerk Frontend API URL):
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev
```

Make sure `TOTALS_READS` is **unset**, or set to anything other than `off`, on both deployments.

Expected side effects of the first real push:

- **`convex/_generated/` is regenerated.** On this branch the agents edited `api.d.ts` by hand in codegen style, so expect a diff there, mostly ordering and formatting. Review it and commit it.
- **Indexes are backfilled.** The new indexes are `sales.by_userId_categoryId_saleDate` and `users.by_token`. On prod the CLI may say an index backfill is large and ask you to confirm. Answer yes, because the indexes are additive and reads keep working while they build.

---

## 1. Dev phase (`ideal-kookabura-797`)

### 1.1 Deploy the backend

```powershell
npx convex dev --once
```

**If dev already runs an earlier v2 build** (the one that kept the gate inside `userTotals`): the push validates, because the old gate fields on `userTotals` became optional and the new `totalsState` table starts empty. Until the backfill runs again, every dev user has no `totalsState` row, so reads use the scan (same numbers) and hooks keep bucketing in the zone stored on the old row. Re-run the backfills with `"reset":true`, because the component remembers the earlier runs as done:

```powershell
npx convex run migrations:run '{"fn":"migrations:backfillUserTotals","reset":true}'
npx convex run migrations:run '{"fn":"migrations:backfillCategoryStats","reset":true}'
```

The rebuild clears the old gate fields from each `userTotals` row. Prod has never seen these tables, so none of this applies there.

`--once` pushes and exits instead of watching. Check the output for "Convex functions ready". If `npx convex dev` stops with a schema validation error, stop and run the audit logic against a copy instead. That error should not happen, because every new field is optional.

### 1.2 Read-only audit

```powershell
npx convex run audit:run '{}'
```

If the action times out on large data, run one table at a time:

```powershell
npx convex run audit:run '{"table":"users"}'
npx convex run audit:run '{"table":"categories"}'
npx convex run audit:run '{"table":"saleSessions"}'
npx convex run audit:run '{"table":"sales"}'
npx convex run audit:run '{"table":"expenses"}'
```

Save the output. It feeds the I/O estimate in section 5. The report has these parts:

- **`tables.<t>.scanned`:** row count of each table.
- **`distinctUserDays`:** about the number of `dailyTotals` rows the backfill will write. It is computed in PKT, so it is exact for PKT users.
- **Issue counters**, each with up to 20 sample ids. These mostly matter:
  - `sales.orphanedCategoryId` and `sales.crossUserCategoryId`: fixed by `cleanOrphanCategoryIds`.
  - `saleSessions.itemCountMismatch` and `totalAmountMismatch`: the totals reproduce what the old queries showed (they use the session fields), so this is informational only.
  - `users.duplicateEmail` and `duplicateEmailConflictingTokens`: investigate these by hand before prod.
  - `users.missingTokenIdentifier`: normal before users sign in again. `upsertUser` links the token on the next app open.

### 1.3 Migrations, in this order

Each migration is a dry run first: it runs one batch (one user) and rolls it back. Then run it for real.

```powershell
# a) Unlink sales that point at a missing or another user's category
npx convex run migrations:run '{"fn":"migrations:cleanOrphanCategoryIds","dryRun":true}'
npx convex run migrations:run '{"fn":"migrations:cleanOrphanCategoryIds"}'

# b) Start the dailyTotals/userTotals rebuild for every user (schedules totals:rebuildMonth chains)
npx convex run migrations:run '{"fn":"migrations:backfillUserTotals","dryRun":true}'
npx convex run migrations:run '{"fn":"migrations:backfillUserTotals"}'

# c) Recount categoryStats (sets categoryCountsReady; users with >8000 categorised sales stay on the scan)
npx convex run migrations:run '{"fn":"migrations:backfillCategoryStats","dryRun":true}'
npx convex run migrations:run '{"fn":"migrations:backfillCategoryStats"}'
```

Wait for each migration to show `isDone: true` before you start the next one.

### 1.4 Monitor

```powershell
# Migration progress (Ctrl+C to stop watching)
npx convex run --component migrations lib:getStatus --watch

# Rebuild progress across all users
npx convex run totals:status '{}'
```

When `backfillUserTotals` reports done, it has only **started** each user's rebuild. The monthly rebuild steps keep running in the scheduler. The rebuild is finished when `totals:status` shows all of these:

- `rows` equals the number of users (every user gets a `totalsState` row).
- `totalsReady` equals `rows`.
- `rebuilding` is `0`.
- `truncated` is `false`.

After `backfillCategoryStats`, `categoryCountsReady` equals `rows`, minus any users with more than 8000 categorised sales. For those users the migration sets `categoryCountsReady` to false (even if it was true before), so their category reads use the scan.

For one user:

```powershell
npx convex run totals:status '{"userId":"<usersId>"}'
```

You can also follow progress in the Dashboard: Functions → `totals:rebuildMonth` logs, and Schedules.

To stop a running migration:

```powershell
npx convex run --component migrations lib:cancel '{"name":"migrations:backfillUserTotals"}'
```

All three migrations are idempotent:

- **Re-running a finished migration** is a no-op.
- **`"reset":true`** walks every user again.
- **`backfillUserTotals`** still skips users that are already ready in their zone.
- **`rebuildAllUserTotals`** is the force path: it restarts the rebuild for **every** user, ready or not. Use it after a rollback window or a suspected drift:

  ```powershell
  npx convex run migrations:run '{"fn":"migrations:rebuildAllUserTotals"}'
  # again later (it is a normal migration, so a second run needs "reset":true):
  npx convex run migrations:run '{"fn":"migrations:rebuildAllUserTotals","reset":true}'
  ```

### 1.5 Spot-check the totals

Get a few user ids, including a heavy user, a light user, and a user whose `timeZone` is not Asia/Karachi if there is one:

```powershell
npx convex data users --limit 20
```

Compare their months with a fresh recompute. This is read-only:

```powershell
npx convex run totals:verifyUserTotals '{"userId":"<usersId>"}'
npx convex run totals:verifyUserTotals '{"userId":"<usersId>","monthKey":"2026-10"}'
npx convex run totals:verifyUserTotals '{"userId":"<usersId>","monthKey":"2025-12"}'
```

You want `ok: true` and `mismatches: []`. If a user shows a mismatch, rebuild only that user and verify again:

```powershell
npx convex run totals:rebuildUserTotals '{"userId":"<usersId>"}'
```

### 1.6 Manual UI click-through (dev frontend: `npm run dev`)

Sign in as a normal user, then as an admin, and check each item:

- [ ] The app loads past the "syncing" screen. The Dashboard summary cards (today, week, month, all-time, top category) match what you expect.
- [ ] Add a sale with 2 items, one with a category and one without. You get a success toast, and today's card, the Daily list and the weekly chart all update.
- [ ] Add an expense. The net total and the day header (sales, expenses, net) update.
- [ ] Edit a sale amount. Edit a sale's date to yesterday: it moves to the other day group and both day totals update.
- [ ] Delete a sale item and an expense. When a day becomes empty, it disappears.
- [ ] Weekly, Monthly and Yearly tabs: the charts render, the lists paginate with "Show More", and no day shows up twice after adding a sale while page 2 is loaded.
- [ ] Yearly: the year picker includes the current year and the past years that have data.
- [ ] Manage Categories: the counts are right. Create a category, rename it, and change its colour. A duplicate name gives an error toast.
- [ ] Open a category: the summary (count and total) and the paginated history are right.
- [ ] Delete a category that has sales. The sales stay, now uncategorised, and the counts update.
- [ ] Validation: an amount of 0, an 81-character product name, or a 101-character note each give a readable error toast, not a raw server error.
- [ ] Admin: Access dialog → view another user. Their data shows and editing is blocked. Reload the page: the view-as choice is restored. Delete or stop using that user id, and you get the "That user is no longer available" toast.
- [ ] Offline/online toggle (DevTools): the app recovers without a white screen.
- [ ] Optional: `npx convex env set TOTALS_READS off`, reload, and the numbers are identical. Then `npx convex env remove TOTALS_READS`.

---

## 2. Prod phase

### 2.1 Backup first

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
npx convex export --prod --path "backups\roznaama-prod-$(Get-Date -Format yyyyMMdd-HHmm).zip"
```

Keep the zip outside git. Check that it is non-empty before you continue.

### 2.2 Deploy the backend, then the frontend

```powershell
npx convex env list --prod                 # CLERK_JWT_ISSUER_DOMAIN set, TOTALS_READS unset
npx convex deploy                          # pushes to the project's prod deployment; confirm the large index backfill if asked
```

Deploy the **backend before the frontend**: the new frontend calls `getDayFeed`, `listByCategoryIdPaginated`, `getCategorySummary` and `validateViewAsTarget`, which must already exist. Old cached PWA clients keep working against the new backend.

Then ship the frontend through Vercel, the usual way (merge or push to the production branch). Do this only once you have decided to go ahead.

### 2.3 Audit and migrations (same commands as dev, with `--prod`)

```powershell
npx convex run --prod audit:run '{}'

npx convex run --prod migrations:run '{"fn":"migrations:cleanOrphanCategoryIds","dryRun":true}'
npx convex run --prod migrations:run '{"fn":"migrations:cleanOrphanCategoryIds"}'
npx convex run --prod migrations:run '{"fn":"migrations:backfillUserTotals","dryRun":true}'
npx convex run --prod migrations:run '{"fn":"migrations:backfillUserTotals"}'
npx convex run --prod migrations:run '{"fn":"migrations:backfillCategoryStats","dryRun":true}'
npx convex run --prod migrations:run '{"fn":"migrations:backfillCategoryStats"}'

npx convex run --prod --component migrations lib:getStatus --watch
npx convex run --prod totals:status '{}'
npx convex run --prod totals:verifyUserTotals '{"userId":"<usersId>"}'
```

Run the steps one at a time and wait for each to finish, as on dev. Prefer a quiet hour, such as late night PKT.

### 2.4 Monitor

- **Dashboard → Usage → Database I/O:** you should see a one-off bump during the audit and backfill, in line with the estimate in section 5, followed by a clear drop in steady-state reads. Dashboard loads stop scanning all-time sessions and expenses once users are `totalsReady`.
- **Dashboard → Logs:** look for `ConvexError` spikes, especially `VALIDATION`, which would mean the stricter write validation is rejecting real client flows.
- **Health:** watch for function errors and scheduler backlog (Schedules) while the `rebuildMonth` chains run.
- Re-run `totals:status` after a few hours of real traffic. Spot-check 2 or 3 users with `verifyUserTotals` again.

---

## 3. Kill switch

To force every read back onto the legacy scan path, which uses no summary tables, set the env var. It applies without a redeploy:

```powershell
npx convex env set --prod TOTALS_READS off
```

Writes keep maintaining the summary tables, so you can switch back at any time:

```powershell
npx convex env remove --prod TOTALS_READS
```

## 4. Rollback

Use the smallest step that fixes the problem.

1. **Wrong numbers for one user:**
   ```powershell
   npx convex run --prod totals:rebuildUserTotals '{"userId":"<usersId>"}'
   ```
   The user is served from the scan while the rebuild runs, because it sets `totalsReady` to false.
2. **Wrong numbers broadly:** turn on the kill switch (section 3). Then run `migrations:rebuildAllUserTotals` (with `"reset":true` if it ran before), which rebuilds every user. `migrations:backfillUserTotals` does **not** help here: it skips users whose `totalsState.totalsReady` is already true in their current zone.
3. **Bad function code:** redeploy the previous functions but **keep the new `convex/schema.ts` and `convex/convex.config.ts`**. The new tables now hold data, and a schema without them would be rejected or would drop the migrations component state. For example:
   ```powershell
   git worktree add ..\rz-rollback e6ddbc2
   Copy-Item convex\schema.ts, convex\convex.config.ts ..\rz-rollback\convex\ -Force
   # in ..\rz-rollback: npm ci; then npx convex deploy
   ```
   The old functions ignore the new optional fields and tables. Note that while the old code runs, writes do **not** update the summary tables, so they go stale. When you redeploy v2:
   - Set `TOTALS_READS=off` **before** the redeploy.
   - Run `migrations:rebuildAllUserTotals` (with `"reset":true` if it ran before). `backfillUserTotals` would skip users that are still marked ready.
   - Run `migrations:backfillCategoryStats` with `"reset":true`. It always recounts.
   - Then remove the kill switch.
4. **Data damage:** restore from the export in section 2.1 with `npx convex import --prod --replace-all <zip>`. This is a last resort, because it discards every write made since the backup.

---

## 5. Expected Database I/O (one-off)

Take the counts from the audit report: U = users, C = categories, S = saleSessions, L = sales, E = expenses, D = `distinctUserDays`. Then estimate:

- **K:** distinct (user, categoryId) pairs in `sales`. It is at most C plus the number of orphaned ids.
- **O:** `orphanedCategoryId` plus `crossUserCategoryId`.
- **M:** total months with data, summed over users.
- **Lc:** categorised sales.

| Step | Document reads | Document writes |
|---|---|---|
| `audit:run` (read-only) | ≈ 2U + C + 2S + 4L + E (upper bound; lookups are cached per page) | 0 |
| `cleanOrphanCategoryIds` | ≈ U + 2K + O | ≈ O sales + their `categoryStats` rows |
| `backfillUserTotals` | ≈ U + S + E + D | ≈ D (`dailyTotals`) + U × (M/U + 2) (`userTotals` cursor patches) + 2U (`totalsState`) |
| `backfillCategoryStats` | ≈ U + Lc + C | ≈ K (`categoryStats`) + U |

Bytes ≈ documents × average document size. You can read the average size per table in Dashboard → Data, or assume about 0.3–0.5 KB for these small rows. As a rough total:

**I/O ≈ (2U + C + 2S + 4L + E) + (S + E + D + Lc + 2K) reads and (D + K + O + U·(M/U + 3)) writes, multiplied by the average doc size.**

The steady state should drop:

- **`getStats`:** before, it read every session and expense on each dashboard load. After, it reads at most 31 `dailyTotals` rows, 1 `totalsState` row and 1 `userTotals` row, plus today's sales for the top category.
- **Charts and Yearly:** they read at most 366 day rows instead of the raw sessions and expenses.
- **Day lists:** they page by day instead of loading whole ranges.

---

## 6. Idempotency ledger (`clientRequests`) for the offline outbox

Deploy this **before** any frontend that sends `clientRequestId`. An older backend rejects the unknown argument (`ArgumentValidationError` naming `clientRequestId`), and the outbox then pauses instead of retrying without the id.

- **Schema (additive):** new table `clientRequests` (`userId`, `clientRequestId`, `kind` `'sale' | 'expense'`, optional `sessionId` / `expenseId`, `totalAmount`, `itemCount`, `createdAt`) with indexes `by_userId_clientRequestId` and `by_createdAt`. It starts empty, so there is no index backfill and no migration.
- **API (additive):** `saleSessions.record` and `expenses.record` accept an optional `clientRequestId` (16–64 chars of `[A-Za-z0-9_-]`; a `crypto.randomUUID()` fits). Return shapes do not change. A call without it behaves exactly as before and never reads or writes the ledger.
- **Behaviour with an id:** the ledger is checked before any write. A replay of the same (user, id) returns the first result and writes nothing, so the summary tables are not touched twice. This holds even if the entry was deleted in between: it is not recreated. The same id reused for the other kind gives `VALIDATION`. A failed first attempt leaves no ledger row, so the retry applies normally. Ids are per user.
- **Deploy:** the normal `npx convex dev --once` (dev) and `npx convex deploy` (prod). `convex/_generated/api.d.ts` gains `clientRequests` and `model/idempotency`; the regenerated file may differ in formatting only.
- **Pruning (manual, no cron):** rows older than 180 days can be deleted. The mutation works in batches of 500 and reschedules itself until done. It is a no-op until the first rows reach 180 days (about May 2027), so run it now and then after that:

  ```powershell
  npx convex run clientRequests:pruneClientRequests '{}'
  npx convex run --prod clientRequests:pruneClientRequests '{}'
  # optional: '{"batchSize":1000}' or an explicit '{"cutoff":<ms>}'
  ```

  A phone that replays an entry more than 180 days old, after its row was pruned, would create it again. The outbox flushes long before that.
- **Rollback:** older function code ignores the table. Keep it in `convex/schema.ts` if you redeploy older functions, as for the other v2 tables.

---

## 7. Admin dashboard (Clerk role "Admin")

- **Admin check:** Clerk role `"Admin"` in the JWT claims (top-level `role`, `public_metadata.role`, `publicMetadata.role`, or a namespaced `…/public_metadata` claim) — the same rule as before the admin dashboard. No Convex env var is needed (`ADMIN_EMAILS` from the first draft is not read; remove it if you set it: `npx convex env remove ADMIN_EMAILS`).
- **Clerk setup (dev and prod instances):**
  1. Clerk dashboard → Users → your user → Metadata → **Public**: `{ "role": "Admin" }` (exact case).
  2. Configure → JWT templates → **convex** → claims must include `"public_metadata": "{{user.public_metadata}}"` (add it next to the existing claims, save). Without it the server never sees the role and admin pages stay hidden.
  3. Sign out and back in (or wait for the token to refresh) so the new claim is in the JWT.
- **Schema (additive):** index `users.by_name` (small backfill on deploy). Read-only functions `admin:overview`, `admin:listUsers`, `admin:getUser`, `admin:watchSummaries`, `users:getMyAccess`. `convex/_generated/api.d.ts` gains `admin` and `model/adminStats`.
- **Limits:** `overview` reads ≤ 40 users per page (≈ 33 docs per ready user, ≤ 500 for a not-ready one) and the page loads every page; `listUsers` ≤ 25 rows per page, search examines ≤ 1000 users per page; `watchSummaries` ≤ 20 users (≈ 45 docs per ready user, ≤ 504 for a not-ready one). Users whose totals are not ready are read from capped scans and flagged `partial`.
- **Watchlist** is stored in the admin's browser (`localStorage`, per Clerk user id); nothing to migrate.
- **Deploy order:** backend first, then frontend. Old frontends keep working: `validateViewAsTarget`, `listForAdmin` and `viewAsUserId` are unchanged and the admin rule is the same one they used.

---

## 8. Advance & Udhaar (Khata)

Opt-in per shop. Shops that never turn it on see no change.

- **Schema (additive, no migration, no backfill):**
  - New tables `shopSettings`, `customers`, `khataEntries`, `khataPayments`, `khataSessionLinks`, `khataTotals`. They start empty, so their indexes build instantly.
  - `clientRequests.kind` gains `'khataSale' | 'khataAdvance' | 'khataPayment'`, plus the optional fields `khataEntryId`, `khataPaymentId`, `khataRemaining`, `khataStatus`. Existing `'sale'` / `'expense'` rows still validate.
  - Round 2 (customer optional): `khataEntries.customerId` and `khataPayments.customerId` became optional. This only widens the schema: existing dev rows still validate, and prod has never had these tables. No migration.
- **Customer is optional (round 2):** `khata.recordSale` / `khata.openAdvance` accept no `customer` (or a blank name) and create a nameless record. New functions `khata.entryDetail` (query) and `khata.setEntryCustomer` (mutation). Khata query rows now return `customerId` / `customerName` as `null` for nameless records. Deploy this backend before the frontend that sends nameless records; an older backend rejects a missing `customer`.
- **API (additive):** new modules `settings` (`get`, `update`) and `khata` (queries `getTotals`, `listOpen`, `searchCustomers`, `customerDetail`, `receivedInRange`, `badgesForRange`; mutations `recordSale`, `openAdvance`, `receivePayment`, `completeAdvance`, `cancelAdvance`, `forgiveRemaining`, `updateEntry`, `removePayment`, `removeEntry`, `updateCustomer`, `archiveCustomer`, `setEntryCustomer`; query `entryDetail`; internal `verifyUser`, `rebuildUser`). Every existing function keeps its name, args and return shape. `convex/_generated/api.d.ts` gains `settings`, `khata`, `model/settings`, `model/khata`, `model/khataBalance`, `model/khataLinks`.
- **Summary tables are not touched directly.** Khata sales go through the normal session / sale / expense helpers, so `dailyTotals`, `userTotals` and `categoryStats` stay exact. No rebuild is needed.
- **Behaviour change for existing sales (only where khata created them):** `sales.updateItem` / `sales.removeItem` on a session created by khata return `VALIDATION` ("This is an Udhaar/Advance payment. Change it in Khata.", "This sale is linked to Udhaar/Advance. Cancel it from Khata." or, with khata off, "Turn on Advance & Udhaar in Settings to change it."). Shops without khata data pay one extra indexed read on an empty range per edit (two for a date move).
- **Deploy order:** backend first (`npx convex dev --once`, then `npx convex deploy`), then the PWA. Old PWAs never call the new functions.
- **Spot checks (read-only):**

  ```powershell
  npx convex run khata:verifyUser '{"userId":"<usersId>"}'
  npx convex run totals:verifyUserTotals '{"userId":"<usersId>"}'
  ```

  You want `ok: true` from both. If `khata:verifyUser` reports drift, repair that user (it recomputes entry balances from payments and the customer / shop sums from the entries; it never touches sales):

  ```powershell
  npx convex run khata:rebuildUser '{"userId":"<usersId>"}'
  ```

  Both read at most 5000 entries per user (`capped: true` above that; `rebuildUser` then fixes entries only, not the sums).
- **Rollback:** the frontend hides everything when `khataEnabled` is false or the new build is rolled back. If you redeploy older functions, keep the new `convex/schema.ts` (the tables hold data). Note that older `sales.updateItem` code has no khata lock, so edits made meanwhile to khata sessions are not copied to their entries; run `khata:verifyUser` for khata users after redeploying this version.