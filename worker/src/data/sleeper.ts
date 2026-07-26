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
