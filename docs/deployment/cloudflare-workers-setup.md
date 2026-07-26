# Cloudflare Workers Deployment

The interactive Discord bot runs as a Cloudflare Worker at the Discord
**HTTP interactions endpoint** — Discord POSTs each slash command to the
Worker, which verifies the Ed25519 signature and responds. There is no
persistent gateway connection and nothing to keep alive, so the free plan
covers it entirely.

The Worker lives in [`worker/`](../../worker). It serves two things: the
Discord slash commands, and the **weekly recap** on a cron trigger
(Tuesdays 12:00 UTC) that syncs Sleeper data, posts the recap to Discord,
and emails it to the league.

## Architecture

- `worker/src/index.ts` — request routing, signature verification, and the `scheduled` (cron) handler
- `worker/src/handlers.ts` — `/standings`, `/career-stats`, `/weekly-summary`, `/onboard`, and the Sleeper-account select menu
- `worker/src/domain/` — standings math, career stats, weekly summary (ported from the Go `internal`/`pkg/types` packages)
- `worker/src/data/` — Supabase (PostgREST) and Sleeper API clients
- `worker/src/recap/` — the weekly recap: Sleeper sync, Discord channel post, Resend email

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

## The weekly recap (cron trigger)

Runs Tuesdays at 12:00 UTC — the same schedule the GitHub Actions job used.
It only acts on an `IN_PROGRESS` league; other statuses are logged and
skipped. Discord posting and email each require their own secrets and are
skipped (not failed) when unset, so you can enable them independently:

```bash
wrangler secret put DISCORD_BOT_TOKEN
wrangler secret put DISCORD_WEEKLY_RECAP_CHANNEL_ID
wrangler secret put RESEND_API_KEY
wrangler secret put FROM_EMAIL
```

The GitHub Actions workflow (`weekly-recap.yml`) is now **manual-only** —
its schedule was removed so the recap cannot run twice. Once the Worker
has completed a live recap, the Go job and its workflow can be deleted.

### Worker limits this design works around

On the Workers free plan each invocation gets **50 subrequests** and
**10ms CPU**. The Go job re-fetched all 17 weeks from Sleeper every run and
issued two database queries per matchup (~180 requests), which does not
fit. The port instead:

- reads existing matchups once and diffs in memory, writing new rows in a
  single bulk insert
- fetches rosters once rather than once per week
- only fetches weeks that are missing, plus the two most recent (so stat
  corrections are still picked up)
- sends all recap emails in one Resend batch request instead of one
  request per recipient

A full season sync costs 19 subrequests; a typical in-season run is under
15. There is a test asserting this budget in `src/recap/sync.test.ts`.

### Verifying without sending anything

Set `RECAP_DRY_RUN=true` in `.dev.vars` and the recap runs end to end
locally but never posts to Discord or emails the league:

```bash
npx wrangler dev --test-scheduled
```

```bash
curl "http://localhost:8787/__scheduled?cron=0+12+*+*+2"
```

The outcome is logged as a single structured `weekly_recap` JSON line
(weeks fetched, rows inserted/updated, and what happened with Discord and
email). Never set `RECAP_DRY_RUN` in production.

## Local development

```bash
cd worker
cp .dev.vars.example .dev.vars   # fill in real values
npm run dev                      # wrangler dev on http://localhost:8787
npm run check                    # tsc --noEmit
```
