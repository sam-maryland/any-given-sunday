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

export interface SleeperMatchup {
  matchup_id: number | null;
  roster_id: number;
  points: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Sleeper GET ${path} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export function getSleeperUser(userId: string): Promise<SleeperUser> {
  return get<SleeperUser>(`/user/${encodeURIComponent(userId)}`);
}

export function getRostersInLeague(leagueId: string): Promise<SleeperRoster[]> {
  return get<SleeperRoster[]>(`/league/${encodeURIComponent(leagueId)}/rosters`);
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
