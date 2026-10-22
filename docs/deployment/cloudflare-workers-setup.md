# Cloudflare Workers Deployment

The interactive Discord bot runs as a Cloudflare Worker at the Discord
**HTTP interactions endpoint** — Discord POSTs each slash command to the
Worker, which verifies the Ed25519 signature and responds. There is no
persistent gateway connection and nothing to keep alive, so the free plan
covers it entirely.

The Worker lives in [`worker/`](../../worker). It serves two things: the
Discord slash commands, and the **weekly recap** on a cron trigger
(Tuesdays 8am Eastern) that syncs Sleeper data, posts the recap to Discord,
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
https://ags-hq.org/
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

### Player names (GitHub Action)

Transactions and draft picks name players by Sleeper id. Their names come
from Sleeper's full player list, about 15 MB of JSON: parsing it alone takes
roughly 20 ms of CPU, twice the free plan's 10 ms limit, so the Worker
cannot do it. `.github/workflows/sync-players.yml` runs
`npm run sync-players` instead, Tuesdays at 13:00 UTC (two hours after the
recap), and can be run by hand from the Actions tab. It writes the
`players` table for everyone who has been drafted, traded, claimed or
dropped in the league, and needs two GitHub secrets: `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`, the same values the Worker uses. Locally,
`npm run sync-players` reads them from `.dev.vars`.

#### Every NFL player, for any league

The same run also trims Sleeper's whole list to every NFL player as
`{ [id]: [name, position, team] }` — about 430 KB, 140 KB gzipped — and
writes it to the Worker's `PLAYERS` KV namespace under the key
`nfl-players` with the Cloudflare REST API. `GET /api/nfl-players` streams
it back unparsed (so it stays inside 10 ms of CPU) with a one-day browser
cache, which lets the site name the players in any Sleeper league's
transactions. Until the first sync writes it, the endpoint answers 404.

One-time setup (the namespace already exists; these steps are for
recreating it, e.g. on a new account):

1. Create the namespace from `worker/`:

   ```bash
   npx wrangler kv namespace create PLAYERS
   ```

2. Paste the `id` it prints into the `PLAYERS` entry of `kv_namespaces` in
   `worker/wrangler.jsonc`.
3. Add two GitHub secrets: `CLOUDFLARE_ACCOUNT_ID` (the `account_id` in
   `wrangler.jsonc`) and `PLAYERS_KV_NAMESPACE_ID` (the same id as step 2).
   The Action reuses the deploy's `CLOUDFLARE_API_TOKEN`; the "Edit
   Cloudflare Workers" template already grants Workers KV Storage edit.
4. Run **Sync Players** from the Actions tab once to fill it rather than
   waiting for Tuesday. Its log ends with a `nflPlayers` line giving the
   player count and byte size.

Without the three Cloudflare values the script logs that it skipped the KV
write and carries on, so a local `npm run sync-players` needs only the
Supabase ones.

Player photos need none of this: the site loads them straight from
Sleeper's CDN by player id.

## The weekly recap (cron trigger)

Runs **Tuesdays at 8am Eastern, every week, year-round**. Discord posting and
email each require their own secrets and are skipped (not failed) when unset,
so you can enable them independently:

```bash
wrangler secret put DISCORD_TOKEN
wrangler secret put DISCORD_WEEKLY_RECAP_CHANNEL_ID
wrangler secret put RESEND_API_KEY
wrangler secret put FROM_EMAIL
```

The Go implementation of the recap and its GitHub Actions workflow have
been removed; the Worker is the only thing that runs it. The previous
version is in git history if it is ever needed.

### Why the cron never needs disabling in the offseason

The run always starts by reading the league from the database. That read is
also the **Supabase keepalive**: a free project pauses after ~7 days of
inactivity, and a weekly read keeps it awake through the offseason.

What does *not* happen year-round is notifying anyone. The recap posts and
emails only when all three hold:

| Condition | Why |
|---|---|
| League status is `IN_PROGRESS` | Nothing to report on a finished season |
| Sleeper `season_type` is `regular` or `post` | Between seasons it reports `off` (and `pre` in preseason) |
| The sync recorded new matchups | Nothing new happened, so there is nothing to say |

The second rule is what makes this automatic: it comes from the live NFL
calendar, so the recap goes quiet in February and starts again in September
with no one touching the schedule — and it holds even if the league is left
marked `IN_PROGRESS` by mistake. Without it, the recap would happily re-send
the final week's summary every Tuesday all winter.

The third rule also stops a manual re-run from sending the same recap twice.
Its trade-off: it depends on Sleeper having advanced `week` by the time the
cron fires at 11:00 UTC (6-7am Eastern). Monday Night Football ends around
11:30pm Eastern, so there is a wide margin, but if a week ever goes quiet
unexpectedly, move the cron later in `wrangler.jsonc` — anything up to 8am
Eastern still leaves the email delivery time untouched.

Every run logs one `weekly_recap` JSON line including `seasonType` and, when
nothing was sent, `notificationsHeld` with the reason — so a quiet week is
always distinguishable from a broken one.

### Delivering the email at 8am Eastern year-round

Owners expect the recap email at 8am Eastern on Tuesday, but cron triggers
are UTC-only and Eastern shifts by an hour in early November — mid-season. A
single `0 12 * * 2` trigger is 8am in September and **7am** from November
onward, which is what the GitHub Actions job did for years.

Rather than juggle cron entries, the job runs early and lets Resend hold the
message:

1. The cron fires at 11:00 UTC — 6-7am Eastern depending on the season.
2. The sync runs and the recap posts to Discord straight away.
3. The email batch is sent with `scheduled_at` set to exactly 8am Eastern
   that morning, computed in `src/recap/schedule.ts`, and Resend delivers it
   then.

So the Discord post lands an hour or two before the email, which is fine —
the email is the one with a promised time. If the job runs after 8am Eastern
(a manual trigger, or a delayed invocation) the email is sent immediately
rather than scheduled into the past.

`recapEmailTime` resolves the zone offset at the target instant, so it stays
correct across the November changeover; a test walks every Tuesday of a
season asserting the delivery time is 8am local each week.

### Worker limits this design works around

On the Workers free plan each invocation gets **50 subrequests** and
**10ms CPU**. Note that this counts binding calls too — Cloudflare defines
a subrequest as any request "using the Fetch API or to Cloudflare services
like R2, KV, or D1" — so moving off Supabase to D1 would not by itself buy
any headroom.

The Go job re-fetched all 17 weeks from Sleeper every run, re-fetched
rosters inside the per-week loop, and issued two database queries per
matchup (~180 requests), which does not fit. The recap instead:

- reads existing matchups once, diffs in memory, and writes new rows in a
  single bulk insert
- fetches rosters once rather than once per week
- only fetches weeks that are missing, plus the two most recent (so stat
  corrections are still picked up)
- returns the post-sync state in memory rather than reading the table back
- derives email recipients from the users it already loaded
- sends all recap emails in one Resend batch request instead of one
  request per recipient

A typical in-season run is 10–13 requests. Rather than assert a total,
`src/recap/sync.test.ts` asserts the properties that keep it low: rosters
are fetched once regardless of week count, writes happen once per sync
rather than once per matchup, nothing is read back after writing, and only
the weeks that can still change are fetched.

### Verifying without sending anything

Set `RECAP_DRY_RUN=true` in `.dev.vars` and the recap runs end to end
locally but never posts to Discord or emails the league:

```bash
npx wrangler dev --test-scheduled
```

```bash
curl "http://localhost:8787/__scheduled?cron=0+11+*+*+2"
```

A run that reaches the email step logs `email.deliverAt` with the instant
Resend will deliver at, so you can confirm the 8am Eastern target without
waiting for it.
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
