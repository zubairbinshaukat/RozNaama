# RozNaama — Claude Code Project Guide

## Project Overview

**RozNaama** is a sales tracking PWA built for non-technical small business owners and shopkeepers in Pakistan. Users record daily sales via a FAB modal, view analytics on a dashboard, and organise items by category.

**Stack:** React 19 + Vite 8 + Tailwind CSS v4 + Convex v1 (backend) + Clerk (auth) + Recharts

---

## Phase Status

| Phase | Status |
|---|---|
| Phase 1 — Scaffold + Landing Page | ✅ Complete |
| Phase 2 — Auth + Dashboard + Sales Flow | ✅ Complete |
| Phase 3 — Convex v2 hardening (wrappers, validation, summary tables, day feed, tests) | ✅ Code complete — rollout per `docs/convex-v2-rollout.md` |

---

## First-Time Setup

```bash
# 1. Copy and fill in env vars
cp .env.local.example .env.local
# Edit .env.local with real Clerk + Convex keys

# 2. Install dependencies (already done if node_modules exists)
npm install

# 3. Start Convex (REQUIRED before running the frontend)
#    This generates convex/_generated/ and deploys the schema
npx convex dev

# 4. Start the frontend (in a separate terminal)
npm run dev
```

> **Important:** `npx convex dev` MUST be run at least once before TypeScript will be happy with the frontend. It generates `convex/_generated/` which provides typed API references. The stub files in `convex/_generated/` are placeholders that get replaced.

---

## Environment Variables

**Frontend (`.env.local`):**

| Variable | Description |
|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (from Clerk dashboard) |
| `VITE_CONVEX_URL` | Convex deployment URL (from `npx convex dev` output) |

Both are required. If missing, the app shows a setup instructions page instead of crashing.

**Convex Dashboard (backend):** In [Convex Dashboard](https://dashboard.convex.dev/) → your deployment → Settings → Environment Variables, set:

| Variable | Description |
|---|---|
| `CLERK_JWT_ISSUER_DOMAIN` | Clerk Frontend API URL (e.g. `https://your-app.clerk.accounts.dev`). Get it from [Clerk → Configure → Convex](https://dashboard.clerk.com/apps/setup/convex). |

| `TOTALS_READS` | Optional kill switch. `off` forces every read back onto the legacy scan path (summary tables still get written). Unset = normal. |

`CLERK_JWT_ISSUER_DOMAIN` is required for auth: without it, `ctx.auth.getUserIdentity()` is null and Convex functions throw `Unauthorized`.

**Admin “Access” (view other users):** Convex checks `role === "Admin"` on the JWT (top-level, `public_metadata`, `publicMetadata`, or a namespaced `…/public_metadata` claim; `convex/model/users.ts`). Ensure the [Clerk JWT template for Convex](https://clerk.com/docs/backend-requests/jwt-templates) includes **`public_metadata`** (or **`publicMetadata`**) so server-side admin checks match `user.publicMetadata` in the app.

---

## Architecture

### Auth flow
1. `main.tsx` — wraps app in `ClerkProvider` → `ConvexProviderWithClerk` → `BrowserRouter`
2. `/dashboard` is wrapped in `ProtectedRoute` which checks `useAuth().isSignedIn`
3. On mount, `ProtectedRoute` calls `upsertUser({ name, email, timeZone })` once per Clerk user (retry with backoff 0.5/1.5/4 s, then an error screen with Retry). The server ignores `email` and uses the JWT.
4. Admin "view as" is restored from storage and checked with `users.validateViewAsTarget` (never throws; `null` → cleared + toast).

### Data flow
- Identity → user only in `convex/model/users.ts`: `by_token` (Clerk `tokenIdentifier`) first, then the verified JWT email (`by_email`). Queries never write; `upsertUser` links the token lazily.
- All data (sales, categories, sessions, expenses, summaries) is scoped by `userId`.
- Errors: `ConvexError({ code, message })`, codes `UNAUTHORIZED | FORBIDDEN | USER_NOT_FOUND | NOT_FOUND | VALIDATION`. Legacy texts (`'Unauthorized'`, `'Forbidden'`, …) are kept. Frontend reads them with `getErrorMessage` / `getErrorCode` (`src/lib/errors.ts`). `QueryErrorBoundary` catches query errors thrown during render.
- Signed in but no user row: queries return empty data, mutations throw `USER_NOT_FOUND`.

### Summary tables (Phase 3)
- `dailyTotals` (per user + `dayKey` in the user's bucket zone), `totalsState` (read gate: frozen `timeZone`, `totalsReady`, `categoryCountsReady`), `userTotals` (all-time sums + rebuild generation/cursor), `categoryStats` (per category `saleCount` + `totalAmount`).
- Gate and sums are split on purpose: `userTotals` is patched by every write, `totalsState` only when a rebuild starts/finishes or category counts flip. Range reads must read only `totalsState` (via `totalsGate` / `categoryStatsReady`), never `userTotals`, or they re-run on every write. Only all-time stats (`getAllTimeTotals`) read `userTotals`.
- `userTotals.timeZone/totalsReady/categoryCountsReady` are deprecated optional leftovers from the first dev deploy: ignored, cleared by the next rebuild. No `totalsState` row = not ready (scan path).
- Every write path calls the hooks in `convex/model/totals.ts` inside the same mutation (session/sale/expense change, category unlink), even before a user's backfill finishes. Sale edits only touch the parent session if it belongs to the same user.
- Reads (`getDailyTotals`, `getStats`, `getYearlyMonthlyTotals`, `getAvailableYears`, `getDayFeed`) use the tables only when `totalsGate` passes: `totalsReady`, request `timeZone` equals `totalsState.timeZone`, and `TOTALS_READS !== 'off'`. Otherwise they fall back to the bounded legacy scan. `getCountsByCategory` / `getCategorySummary` need `categoryCountsReady`; the `getCategorySummary` scan fallback stops at 5000 sales and then adds `capped: true`.
- Day starts come from `zonedStartOfDayMs` (`convex/lib/time.ts`): the first instant of the local day, which is 01:00 in zones where DST skips midnight.
- Backfill and repair are internal: migrations `cleanOrphanCategoryIds` → `backfillUserTotals` → `backfillCategoryStats`, plus `rebuildAllUserTotals` (forces every user), `totals:rebuildUserTotals`, `totals:verifyUserTotals`, `totals:status`, and the read-only `audit:run`. See `docs/convex-v2-rollout.md`.
- Deleting a category unlinks its sales in batches of 200, using the scheduled `categories:unlinkBatch` when there are more.

### Day feed
- Daily/Weekly/Monthly lists use `saleSessions.getDayFeed` (one entry per day with sessions, expenses and totals). It uses a custom day-key cursor, so read it with `usePaginatedQuery` from **`convex-helpers/react`** (not `convex/react`), wrapped in `src/hooks/useDayFeed.ts`. Keep feed args memoized, because new args reset pagination.
- A day is never split across pages. An unbound page ends after its last whole day. A re-bound (`endCursor`) page that outgrows the caps (1000 sessions/expenses or 200 days) returns `pageStatus: 'SplitRequired'` + `splitCursor`, and the hook re-queries it as two pages. A single day with more than 1000 rows comes back alone; above 2000 rows per table its entry has `truncated: true` (newest rows only).
- Category modal: `sales.listByCategoryIdPaginated` + `sales.getCategorySummary` (`src/hooks/useCategorySales.ts`).
- Old list queries (`getForDate`, `getSessionsForRange*`, `getSessionsPaginated`, `expenses.getForRange*`/`getPaginated`, `sales.listByCategoryId`) are `@deprecated`. They stay until 2026-12-17 for cached PWA clients.

### Theme system
- Three themes: `light` (default), `dark`, `midnight`
- Stored in `localStorage` as `roznaama-theme`
- Applied by toggling `.dark` class and `data-theme` attribute on `<html>`
- All colours are CSS custom properties defined in `src/styles/globals.css`
- Tailwind v4 `@theme inline` block maps them to utility classes

---

## Key Files

| Path | Purpose |
|---|---|
| `src/styles/globals.css` | All CSS variables, themes, custom utilities |
| `src/lib/utils.ts` | `formatCurrency`, `formatDate`, `getGreeting`, date helpers |
| `src/lib/constants.ts` | `THEMES`, `CATEGORY_COLORS`, `TOAST_DURATION` |
| `src/hooks/useTheme.ts` | Theme state management |
| `src/hooks/useSales.ts` | Convex queries for sales data |
| `src/hooks/useCategories.ts` | Convex queries for categories |
| `src/components/shared/Toast.tsx` | `ToastProvider` + `useToast()` hook |
| `src/components/shared/FAB.tsx` | Floating action button with fan menu |
| `src/hooks/useDayFeed.ts` | Paginated day feed (`convex-helpers/react` `usePaginatedQuery`) |
| `src/hooks/useCategorySales.ts` | Paginated category history + summary |
| `src/hooks/viewAsPatch.ts` | `useViewAsQueryPatch()` adds `viewAsUserId` to query args |
| `src/lib/errors.ts` | `getErrorMessage`, `getErrorCode`, `isViewAsInvalidError` |
| `src/lib/dayGroups.ts` | Day feed entries → `DayGroup` for `SalesList` |
| `src/components/shared/QueryErrorBoundary.tsx` | Error boundary for Convex query errors |
| `convex/schema.ts` | Full database schema |
| `convex/saleSessions.ts` | Session recording, stats, charts, `getDayFeed` |
| `convex/lib/functions.ts` | `authedQuery` / `authedMutation` / `adminQuery` wrappers |
| `convex/lib/errors.ts` | `ERROR_CODES` + error constructors |
| `convex/lib/{validation,limits,time,ownership,returnValidators,env}.ts` | Write validation, limits, time-zone math, ownership checks, `returns` validators, env access (`readEnv`) |
| `convex/model/users.ts` | Identity resolution, admin check, `resolveDataUser`, `upsertUserFromIdentity` |
| `convex/model/{sales,expenses,categories,stats}.ts` | Write logic (calls totals hooks) + bounded read helpers |
| `convex/model/totals.ts` | Summary-table hooks, `totalsGate`, rebuild/verify logic |
| `convex/model/idempotency.ts` + `convex/clientRequests.ts` | `clientRequests` ledger (`findApplied` / `recordApplied`) + internal `pruneClientRequests` |
| `convex/totals.ts` | Internal `rebuildUserTotals`, `rebuildMonth`, `verifyUserTotals`, `status` |
| `convex/migrations.ts` | `@convex-dev/migrations` runner + the 3 backfill migrations |
| `convex/audit.ts` | Read-only data audit (`audit:run`) |
| `docs/convex-v2-rollout.md` | Deploy / backfill / rollback runbook |

---

## UI/UX Rules (enforced)

- All icons from `lucide-react` — never emoji as icon substitutes
- Icon sizing: `size={16}` nav, `size={18}` buttons, `size={24}` cards, `size={48}` empty states
- Currency formatted as `PKR 1,234` via `formatCurrency()`
- Dates formatted as `"Today"`, `"Yesterday"`, or `"Mon, 12 Mar"` via `formatDate()`
- Loading states: skeleton shimmer divs, not plain "Loading..." text
- `Loader2` with `animate-[spin_1s_linear_infinite]` for button spinners
- All buttons: `active:scale-[0.97]` for tactile press feedback
- Toast for every user action (success = green `CheckCircle2`, error = red `AlertCircle`)

---

## TypeScript Rules

- `strict: true` throughout — no `any`, use `unknown` and narrow
- `erasableSyntaxOnly: true` — no `enum`, use `const` objects
- `noUnusedLocals` + `noUnusedParameters` — no dead code

---

## Convex Convention

All Convex functions (query/mutation) must:
1. Authenticate via the wrappers in `convex/lib/functions.ts` — `authedQuery` (optional `viewAsUserId`, `ctx.user: Doc<'users'> | null`), `authedMutation` (`ctx.user` required), `adminQuery`. They throw `ConvexError({ code, message })` (`UNAUTHORIZED | FORBIDDEN | USER_NOT_FOUND | NOT_FOUND | VALIDATION`, see `convex/lib/errors.ts`).
2. Resolve identity → user ONLY through `convex/model/users.ts` (never trust client-sent email/ids).
3. Scope all DB operations to that `userId`; check ownership of referenced docs with `convex/lib/ownership.ts`.
4. Validate NEW writes / CHANGED fields with `convex/lib/validation.ts` + `convex/lib/limits.ts`. Never validate on reads (prod has legacy rows).
5. Use table-first DB calls (`ctx.db.get('sales', id)`), add `returns` validators (`convex/lib/returnValidators.ts`), keep existing names/args/return shapes backward compatible (only add optional args).
6. Time-zone math lives in `convex/lib/time.ts`.
7. Idempotent creates: `saleSessions.record` / `expenses.record` take an optional `clientRequestId` (`CLIENT_REQUEST_ID_RE`, a `crypto.randomUUID()` fits). `convex/model/idempotency.ts` looks it up in the `clientRequests` ledger BEFORE any write; a hit returns the stored result and writes nothing (no totals hooks), a miss inserts + runs hooks + records the ledger row in the same mutation. Same id with the other kind → `VALIDATION`. No id → old behaviour, ledger untouched. Any new create that the offline outbox may replay must follow this pattern. Old ledger rows: internal `clientRequests:pruneClientRequests` (180 days, run by hand).

`convex/_generated/` is hand-maintained in codegen style until the next `npx convex dev`: when adding a module, add it to `convex/_generated/api.d.ts`.

## Testing

- `npm test` runs two Vitest projects (`vitest.config.ts`): `convex` (edge-runtime, `tests/convex/**/*.test.ts`, convex-test) and `frontend` (jsdom, `src/**/*.test.{ts,tsx}`, TZ=Asia/Karachi).
- Convex tests live in `tests/convex/` (never inside `convex/`). Use `makeT()`, `IDENTITIES`, `signIn`, `signInAndUpsert`, `freezeNow` from `tests/convex/setup.ts`.
- Totals changes need a "summary tables == recompute" check (see `tests/convex/totals.test.ts`, `totalsFixtures.ts`).
- `npm run typecheck:convex` type-checks `convex/` + `tests/`. `npm run lint` runs `@convex-dev/eslint-plugin` recommended rules as **errors** on `convex/`. Target is 0 errors and 0 warnings.
- Before a PR, run `npm test`, `npm run lint`, `npm run build` and `npm run typecheck:convex`.
- Migrations use `@convex-dev/migrations` (`convex/convex.config.ts`, `convex/migrations.ts`). Make them idempotent with `batchSize: 1` per user.
- Never run `npx convex` against prod from an agent. Deploys and migrations are done by the owner via the runbook.

---

## Adding New Features

- New Convex function → add to appropriate file in `convex/`, then run `npx convex dev` to regenerate types
- New UI component → follow folder structure (`shared/`, `dashboard/`, `modals/`, `landing/`)
- New page → add route in `src/App.tsx`, wrap with `<ProtectedRoute>` if auth required
