/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as audit from "../audit.js";
import type * as categories from "../categories.js";
import type * as clientRequests from "../clientRequests.js";
import type * as devSeed from "../devSeed.js";
import type * as expenses from "../expenses.js";
import type * as khata from "../khata.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_limits from "../lib/limits.js";
import type * as lib_ownership from "../lib/ownership.js";
import type * as lib_returnValidators from "../lib/returnValidators.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_validation from "../lib/validation.js";
import type * as migrations from "../migrations.js";
import type * as model_adminStats from "../model/adminStats.js";
import type * as model_categories from "../model/categories.js";
import type * as model_expenses from "../model/expenses.js";
import type * as model_idempotency from "../model/idempotency.js";
import type * as model_khata from "../model/khata.js";
import type * as model_khataBalance from "../model/khataBalance.js";
import type * as model_khataLinks from "../model/khataLinks.js";
import type * as model_sales from "../model/sales.js";
import type * as model_settings from "../model/settings.js";
import type * as model_stats from "../model/stats.js";
import type * as model_totals from "../model/totals.js";
import type * as model_users from "../model/users.js";
import type * as saleSessions from "../saleSessions.js";
import type * as sales from "../sales.js";
import type * as settings from "../settings.js";
import type * as totals from "../totals.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  audit: typeof audit;
  categories: typeof categories;
  clientRequests: typeof clientRequests;
  devSeed: typeof devSeed;
  expenses: typeof expenses;
  khata: typeof khata;
  "lib/env": typeof lib_env;
  "lib/errors": typeof lib_errors;
  "lib/functions": typeof lib_functions;
  "lib/limits": typeof lib_limits;
  "lib/ownership": typeof lib_ownership;
  "lib/returnValidators": typeof lib_returnValidators;
  "lib/time": typeof lib_time;
  "lib/validation": typeof lib_validation;
  migrations: typeof migrations;
  "model/adminStats": typeof model_adminStats;
  "model/categories": typeof model_categories;
  "model/expenses": typeof model_expenses;
  "model/idempotency": typeof model_idempotency;
  "model/khata": typeof model_khata;
  "model/khataBalance": typeof model_khataBalance;
  "model/khataLinks": typeof model_khataLinks;
  "model/sales": typeof model_sales;
  "model/settings": typeof model_settings;
  "model/stats": typeof model_stats;
  "model/totals": typeof model_totals;
  "model/users": typeof model_users;
  saleSessions: typeof saleSessions;
  sales: typeof sales;
  settings: typeof settings;
  totals: typeof totals;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
};
