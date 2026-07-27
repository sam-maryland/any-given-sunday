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
