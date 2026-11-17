import type { AuthConfig } from 'convex/server'

/**
 * Convex auth config for Clerk.
 * Set CLERK_JWT_ISSUER_DOMAIN in the Convex Dashboard (Settings → Environment Variables)
 * to your Clerk Frontend API URL (e.g. https://your-app.clerk.accounts.dev).
 * Get it from Clerk Dashboard → Configure → Convex integration.
 */
export default {
  providers: [
    {
      // Convex evaluates auth.config.ts at push time and the documented Clerk
      // setup reads the issuer from process.env; the typed `env` export needs
      // codegen we don't run here, so keep the conventional form.
      // eslint-disable-next-line @convex-dev/no-process-env
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: 'convex',
    },
  ],
} satisfies AuthConfig
