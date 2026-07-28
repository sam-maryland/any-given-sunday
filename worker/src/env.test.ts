import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * Loading wrangler.jsonc also loads .dev.vars, which holds a real Supabase
 * service role key — a credential that bypasses RLS and can write. Every test
 * that reaches the network stubs fetch, but that is a convention, and one
 * forgetful test would otherwise reach the live project.
 *
 * vitest.config.ts overrides those bindings with unroutable values. This
 * asserts the override is still in force, so the protection cannot quietly
 * disappear.
 */
describe("test environment", () => {
  it("never holds credentials that could reach the real Supabase project", () => {
    expect(env.SUPABASE_URL).toBe("https://supabase.invalid");
    expect(env.SUPABASE_URL).not.toContain("supabase.co");
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("test-service-role-key");
  });

  it("never holds a usable Discord or Resend credential", () => {
    expect(env.DISCORD_TOKEN).toBe("test-discord-token");
    expect(env.RESEND_API_KEY).toBe("test-resend-key");
  });
});
