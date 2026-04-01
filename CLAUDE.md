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

Required for auth: without it, `ctx.auth.getUserIdentity()` is null and Convex functions throw `Unauthorized`.

**Admin “Access” (view other users):** Convex checks `public_metadata.role === "Admin"` on the JWT (`convex/authHelpers.ts`). Ensure the [Clerk JWT template for Convex](https://clerk.com/docs/backend-requests/jwt-templates) includes **`public_metadata`** (or **`publicMetadata`**) so server-side admin checks match `user.publicMetadata` in the app.

---

## Architecture

### Auth flow
1. `main.tsx` — wraps app in `ClerkProvider` → `ConvexProviderWithClerk` → `BrowserRouter`
2. `/dashboard` is wrapped in `ProtectedRoute` which checks `useAuth().isSignedIn`
3. On mount, `ProtectedRoute` calls `upsertUser` mutation to sync Clerk user → Convex `users` table

### Data flow
- Every Convex query/mutation calls `ctx.auth.getUserIdentity()` first
- User identity is resolved from Clerk JWT → email → `users` table lookup
- All data (sales, categories, sessions) is scoped by `userId`

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
| `convex/schema.ts` | Full database schema |
| `convex/saleSessions.ts` | Session recording + stats queries |

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
1. Call `ctx.auth.getUserIdentity()` → throw `ConvexError('Unauthorized')` if null
2. Look up user in `users` table by email
3. Scope all DB operations to that `userId`

---

## Adding New Features

- New Convex function → add to appropriate file in `convex/`, then run `npx convex dev` to regenerate types
- New UI component → follow folder structure (`shared/`, `dashboard/`, `modals/`, `landing/`)
- New page → add route in `src/App.tsx`, wrap with `<ProtectedRoute>` if auth required
