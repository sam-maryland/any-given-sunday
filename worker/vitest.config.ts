import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Tests run inside workerd rather than Node, so they exercise the real
// runtime: a working Cache API, and per-request I/O scoping. Plain vitest
// hid a bug where a promise cached in module scope was awaited from a later
// request — valid in Node, rejected by Workers.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Reading wrangler.jsonc also picks up .dev.vars, which holds a real
      // Supabase service role key — a credential that bypasses RLS and can
      // write. Tests stub fetch, but a future one that forgets would then hit
      // the live project. Overriding the credentials with unroutable values
      // makes that mistake fail loudly instead of silently succeeding.
      miniflare: {
        bindings: {
          SUPABASE_URL: "https://supabase.invalid",
          SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
          DISCORD_TOKEN: "test-discord-token",
          DISCORD_PUBLIC_KEY: "test-public-key",
          RESEND_API_KEY: "test-resend-key",
        },
      },
    }),
  ],
});
