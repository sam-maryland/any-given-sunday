import {
  CareerStatsRow,
  League,
  LeagueStatus,
  Matchup,
  NewMatchup,
  User,
  UserMap,
} from "../domain/types";

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
    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
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
