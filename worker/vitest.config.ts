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
    }),
  ],
});
