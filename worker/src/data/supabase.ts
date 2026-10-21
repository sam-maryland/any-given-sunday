import {
  CareerStatsRow,
  DraftPick,
  League,
  LeagueStatus,
  Matchup,
  NewMatchup,
  Player,
  Roster,
  Transaction,
  User,
  UserMap,
} from "../domain/types";

// PostgREST's default max-rows: a page never holds more than this.
const PAGE_SIZE = 1000;

// Minimal Supabase PostgREST client. The service role key bypasses RLS, so
// this must only ever run server-side (it lives in a Worker secret).
export class SupabaseClient {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceRoleKey: string,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.serviceRoleKey,
        Authorization: `Bearer ${this.serviceRoleKey}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase ${init?.method ?? "GET"} ${path} failed (${res.status}): ${body}`);
    }
    // A write sent with `Prefer: return=minimal` comes back as 201 with a
    // zero-byte body, not 204, so the status alone does not say whether there
    // is JSON to parse. Read the body and treat empty as no content — calling
    // res.json() on it throws "Unexpected end of JSON input", which took down
    // the whole weekly recap the first time it stored a matchup.
    const text = await res.text();
    if (text === "") {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }

  async getLeagueByYear(year: number): Promise<League | null> {
    const rows = await this.request<League[]>(`leagues?year=eq.${year}&limit=1`);
    return rows[0] ?? null;
  }

  // The latest league is the in-progress league, or the most recent completed
  // league if none is in progress (mirrors the Go GetLatestLeague query).
  async getLatestLeague(): Promise<League | null> {
    const inProgress = await this.request<League[]>(
      `leagues?status=eq.${LeagueStatus.InProgress}&order=year.desc&limit=1`,
    );
    if (inProgress[0]) {
      return inProgress[0];
    }
    const complete = await this.request<League[]>(
      `leagues?status=eq.${LeagueStatus.Complete}&order=year.desc&limit=1`,
    );
    return complete[0] ?? null;
  }

  // Years with standings to show, newest first. A pending league has none yet.
  async getSeasonYears(): Promise<number[]> {
    const rows = await this.request<Pick<League, "year">[]>(
      `leagues?status=neq.${LeagueStatus.Pending}&select=year&order=year.desc`,
    );
    return rows.map((r) => r.year);
  }

  // Every season that has started, oldest first.
  async getStartedLeagues(): Promise<League[]> {
    return this.request<League[]>(`leagues?status=neq.${LeagueStatus.Pending}&order=year.asc`);
  }

  // Every matchup ever played. About 80 rows a season, so this stays well
  // under PostgREST's default 1000-row page for another decade; past that it
  // would need paging.
  async getAllMatchups(): Promise<Matchup[]> {
    return this.request<Matchup[]>("matchups?order=year.asc,week.asc,id.asc");
  }

  // Every transaction ever made: trades, claims and pickups, about 200 a
  // season. That reaches PostgREST's default 1000-row page within a season
  // (809 rows after 2023–2026), so this reads page by page.
  async getAllTransactions(): Promise<Transaction[]> {
    return this.getAllPages<Transaction>("transactions?order=id.asc");
  }

  // Every pick of every league draft, about 160 a season.
  async getAllDraftPicks(): Promise<DraftPick[]> {
    return this.getAllPages<DraftPick>("draft_picks?order=draft_id.asc,pick_no.asc");
  }

  // Who held every roster in every league, a dozen rows a season.
  async getAllRosters(): Promise<Roster[]> {
    return this.request<Roster[]>("rosters?order=league_id.asc,roster_id.asc");
  }

  // Reads a GET past PostgREST's 1000-row default page. The path must carry
  // an order with a unique tiebreak, or rows could repeat or go missing
  // between pages.
  private async getAllPages<T>(path: string): Promise<T[]> {
    const rows: T[] = [];
    for (;;) {
      const page = await this.request<T[]>(`${path}&limit=${PAGE_SIZE}&offset=${rows.length}`);
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
  }

  async getMatchupsByYear(year: number): Promise<Matchup[]> {
    return this.request<Matchup[]>(`matchups?year=eq.${year}&order=week.asc,id.asc`);
  }

  async getUsers(): Promise<UserMap> {
    const rows = await this.request<User[]>("users?select=*");
    return new Map(rows.map((u) => [u.id, u]));
  }

  async getUserById(id: string): Promise<User | null> {
    const rows = await this.request<User[]>(`users?id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows[0] ?? null;
  }

  // Inserts matchups in a single request. PostgREST accepts an array body.
  async insertMatchups(rows: NewMatchup[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.request<void>("matchups", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(rows),
    });
  }

  // Inserts or replaces rows by their natural key in a single request, so a
  // re-run of the same weeks rewrites rows instead of failing on duplicates.
  private async upsert<T>(table: string, onConflict: string, rows: T[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.request<void>(`${table}?on_conflict=${onConflict}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
  }

  async upsertRosters(rows: Roster[]): Promise<void> {
    await this.upsert("rosters", "league_id,roster_id", rows);
  }

  async upsertTransactions(rows: Transaction[]): Promise<void> {
    await this.upsert("transactions", "id", rows);
  }

  async upsertDraftPicks(rows: DraftPick[]): Promise<void> {
    await this.upsert("draft_picks", "draft_id,pick_no", rows);
  }

  async upsertPlayers(rows: Player[]): Promise<void> {
    // Stamped here so a re-sync shows when each row was last refreshed; the
    // column default only covers the first insert.
    const updated_at = new Date().toISOString();
    await this.upsert("players", "id", rows.map((r) => ({ ...r, updated_at })));
  }

  // The latest week with a stored transaction for a league, or null if none.
  async getLatestTransactionWeek(leagueId: string): Promise<number | null> {
    const rows = await this.request<Pick<Transaction, "week">[]>(
      `transactions?league_id=eq.${encodeURIComponent(leagueId)}&select=week&order=week.desc&limit=1`,
    );
    return rows[0]?.week ?? null;
  }

  async hasDraftPicks(draftId: string): Promise<boolean> {
    const rows = await this.request<Pick<DraftPick, "pick_no">[]>(
      `draft_picks?draft_id=eq.${encodeURIComponent(draftId)}&select=pick_no&limit=1`,
    );
    return rows.length > 0;
  }

  async updateMatchupScores(
    id: string,
    scores: { home_score: number; away_score: number },
  ): Promise<void> {
    await this.request<void>(`matchups?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(scores),
    });
  }

  // Records the podium and closes out the season. Only an IN_PROGRESS league
  // is touched, so a re-run cannot overwrite a finish someone corrected by hand.
  async completeLeague(
    id: string,
    podium: { first: string; second: string; third: string },
  ): Promise<void> {
    await this.request<void>(
      `leagues?id=eq.${encodeURIComponent(id)}&status=eq.${LeagueStatus.InProgress}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          first_place: podium.first,
          second_place: podium.second,
          third_place: podium.third,
          status: LeagueStatus.Complete,
        }),
      },
    );
  }

  async getUsersWithoutDiscordId(): Promise<User[]> {
    return this.request<User[]>(
      "users?or=(discord_id.eq.,discord_id.is.null)&order=name.asc",
    );
  }

  async getCareerStatsByDiscordId(discordId: string): Promise<CareerStatsRow | null> {
    const rows = await this.request<CareerStatsRow[]>(
      `career_stats?discord_id=eq.${encodeURIComponent(discordId)}&limit=1`,
    );
    return rows[0] ?? null;
  }

  async isUserOnboarded(discordId: string): Promise<boolean> {
    const rows = await this.request<Pick<User, "id">[]>(
      `users?discord_id=eq.${encodeURIComponent(discordId)}&onboarding_complete=is.true&select=id&limit=1`,
    );
    return rows.length > 0;
  }

  async isSleeperUserClaimed(sleeperUserId: string): Promise<boolean> {
    const rows = await this.request<Pick<User, "id" | "discord_id">[]>(
      `users?id=eq.${encodeURIComponent(sleeperUserId)}&select=id,discord_id&limit=1`,
    );
    const user = rows[0];
    return !!user && !!user.discord_id && user.discord_id !== "";
  }

  // Links a Discord user to an unclaimed Sleeper account. Returns false when
  // no row matched (i.e. the account was already claimed).
  async linkDiscordToSleeperUser(sleeperUserId: string, discordId: string): Promise<boolean> {
    const updated = await this.request<Pick<User, "id">[]>(
      `users?id=eq.${encodeURIComponent(sleeperUserId)}&or=(discord_id.eq.,discord_id.is.null)&select=id`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ discord_id: discordId, onboarding_complete: true }),
      },
    );
    return updated.length > 0;
  }
}
