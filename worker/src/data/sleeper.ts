import { UserMap } from "../domain/types";

const BASE_URL = "https://api.sleeper.app/v1";

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
  metadata?: { team_name?: string } | null;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  co_owners?: string[] | null;
}

export interface NFLState {
  week: number;
  season: string;
  season_type: string;
}

export interface SleeperLeague {
  league_id: string;
  status: string;
  settings: {
    /**
     * The last week Sleeper has finished scoring, and the only authoritative
     * answer to "which weeks are done". NFLState.week cannot stand in for it:
     * Sleeper rolls that counter over on Wednesday, so on the Tuesday the
     * recap runs it still names the week that just finished as current.
     */
    last_scored_leg?: number;
    playoff_week_start?: number;
  };
}

export interface SleeperGame {
  game_id: string;
  week: number;
  /** "complete", "pre_game", "canceled", or an in-progress value while played. */
  status: string;
  /** Local game date, YYYY-MM-DD. */
  date: string;
  home: string;
  away: string;
}

export interface SleeperMatchup {
  matchup_id: number | null;
  roster_id: number;
  points: number;
}

async function getUrl<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Sleeper GET ${url} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

function get<T>(path: string): Promise<T> {
  return getUrl<T>(`${BASE_URL}${path}`);
}

/**
 * The season's games, each with its own status.
 *
 * This is what tells the recap that a week is actually over: the games
 * themselves say so, rather than a counter Sleeper advances on a schedule of
 * its own. It costs one request for the entire season.
 *
 * Note the path — this endpoint sits outside /v1 and outside Sleeper's
 * published docs, so it may move or change shape without warning. Callers
 * treat a failure as routine and fall back to the league's last_scored_leg.
 */
export function getNFLSchedule(season: string): Promise<SleeperGame[]> {
  return getUrl<SleeperGame[]>(
    `https://api.sleeper.app/schedule/nfl/regular/${encodeURIComponent(season)}`,
  );
}

export function getSleeperUser(userId: string): Promise<SleeperUser> {
  return get<SleeperUser>(`/user/${encodeURIComponent(userId)}`);
}

export function getRostersInLeague(leagueId: string): Promise<SleeperRoster[]> {
  return get<SleeperRoster[]>(`/league/${encodeURIComponent(leagueId)}/rosters`);
}

export function getLeague(leagueId: string): Promise<SleeperLeague> {
  return get<SleeperLeague>(`/league/${encodeURIComponent(leagueId)}`);
}

export function getNFLState(): Promise<NFLState> {
  return get<NFLState>("/state/nfl");
}

export function getMatchupsForWeek(leagueId: string, week: number): Promise<SleeperMatchup[]> {
  return get<SleeperMatchup[]>(`/league/${encodeURIComponent(leagueId)}/matchups/${week}`);
}

export function getUsersInLeague(leagueId: string): Promise<SleeperUser[]> {
  return get<SleeperUser[]>(`/league/${encodeURIComponent(leagueId)}/users`);
}

// Sleeper falls back to the display name when no team name is set.
export function teamName(user: SleeperUser): string {
  return user.metadata?.team_name || user.display_name;
}

/**
 * Returns the league's users with Sleeper team names in place of the names
 * stored in the database, so displays read "The Ducks" rather than the
 * owner's name. Costs one request for the whole league.
 *
 * Team names are cosmetic, so Sleeper being unreachable falls back to the
 * database names instead of failing the caller. Users who are no longer in
 * the league keep their stored name.
 */
export async function withTeamNames(users: UserMap, leagueId: string): Promise<UserMap> {
  const merged: UserMap = new Map(users);

  try {
    for (const sleeperUser of await getUsersInLeague(leagueId)) {
      const existing = merged.get(sleeperUser.user_id);
      merged.set(sleeperUser.user_id, {
        id: sleeperUser.user_id,
        name: teamName(sleeperUser),
        discord_id: existing?.discord_id ?? null,
        onboarding_complete: existing?.onboarding_complete ?? null,
        email: existing?.email ?? null,
      });
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "team_names_unavailable",
        leagueId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  return merged;
}
