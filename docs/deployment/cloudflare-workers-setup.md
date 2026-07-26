# Cloudflare Workers Deployment

The interactive Discord bot runs as a Cloudflare Worker at the Discord
**HTTP interactions endpoint** — Discord POSTs each slash command to the
Worker, which verifies the Ed25519 signature and responds. There is no
persistent gateway connection and nothing to keep alive, so the free plan
covers it entirely.

The Worker lives in [`worker/`](../../worker). The scheduled weekly recap
(and its email sending) is unchanged: it still runs the Go binary via the
`weekly-recap.yml` GitHub Actions cron.

## Architecture

- `worker/src/index.ts` — request routing + signature verification
- `worker/src/handlers.ts` — `/standings`, `/career-stats`, `/weekly-summary`, `/onboard`, and the Sleeper-account select menu
- `worker/src/domain/` — standings math, career stats, weekly summary (ported from the Go `internal`/`pkg/types` packages)
- `worker/src/data/` — Supabase (PostgREST) and Sleeper API clients

Every command is acknowledged with a deferred response within Discord's
3-second window; the real work happens in `ctx.waitUntil` and edits the
response when done.

**Onboarding change:** the old bot welcomed new members via the
`GuildMemberAdd` gateway event, which HTTP-only bots do not receive. New
members now run `/onboard` themselves to get the same Sleeper-account
dropdown. The account-linking logic is identical.

## One-time setup

### 1. Secrets

From `worker/`, set the four runtime secrets (values are in the Discord
Developer Portal → your app → General Information, and Supabase → Project
Settings → API):

```bash
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_APP_ID
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

No Discord bot token is stored in the Worker — interaction responses use
the per-interaction token, and request authentication uses the public key.

### 2. Deploy

```bash
cd worker && npm ci && npm run deploy
```

### 3. Register the `/onboard` command

The three existing commands keep working, but `/onboard` is new. Copy
`worker/.dev.vars.example` to `worker/.dev.vars`, fill in `DISCORD_TOKEN`,
`DISCORD_APP_ID`, and `DISCORD_GUILD_ID`, then:

```bash
cd worker && npm run register-commands
```

### 4. Cut over Discord to the Worker

In the [Discord Developer Portal](https://discord.com/developers/applications),
open your application → **General Information** → set
**Interactions Endpoint URL** to the Worker URL:

```
https://any-given-sunday.wattsio.workers.dev/
```

Discord immediately sends a signed PING; the save only succeeds if the
Worker verifies and answers it (i.e. `DISCORD_PUBLIC_KEY` must be set
first). From that moment Discord delivers all slash commands to the
Worker instead of the gateway connection.

### 5. Decommission Google Cloud Run

Once the endpoint URL is saved and commands work in Discord:

```bash
gcloud run services delete commish-bot --region <region>
```

Then delete `.github/workflows/deploy-commish-bot.yml` and the
GitHub secrets that only Cloud Run used (`GCP_*`). The
`DISCORD_TOKEN` secret is still used by the weekly recap job and the
command registration script — keep it.

## Continuous deployment

`.github/workflows/deploy-worker.yml` type-checks and deploys the Worker
on every push to `main` that touches `worker/`. It needs one GitHub
secret: `CLOUDFLARE_API_TOKEN` (create at Cloudflare dashboard → My
Profile → API Tokens → "Edit Cloudflare Workers" template).

## Local development

```bash
cd worker
cp .dev.vars.example .dev.vars   # fill in real values
npm run dev                      # wrangler dev on http://localhost:8787
npm run check                    # tsc --noEmit
```
