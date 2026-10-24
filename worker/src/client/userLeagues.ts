// Every NFL league a Sleeper user has played in, found from their username,
// so nobody has to dig out a league ID. Sleeper lists a user's leagues one
// season at a time and gives each season of a league its own id, so every
// season is asked for and the seasons are joined back into leagues by
// previous_league_id, each named by its newest season: the id the site opens.

import type { NFLState, SleeperLeague, SleeperUser } from "../data/sleeper";
import { get } from "./league";

/** Sleeper's first fantasy football season. */
const FIRST_SEASON = 2017;

export class UserNotFoundError extends Error {}

/** One league the user is in, as the front page lists it. */
export interface UserLeague {
  /** The newest season's league id: what ?league= takes. */
  id: string;
  name: string;
  /** Sleeper avatar URL, if the league has one. */
  avatar: string | null;
  /** Sleeper's status for the newest season. */
  status: string;
  /** Seasons the user played in it, newest first. */
  seasons: number[];
}

/** A username as typed: Sleeper's own @handle form works too. */
export function parseUsername(input: string): string | null {
  const name = input.trim().replace(/^@/, "");
  return /^\S{2,40}$/.test(name) ? name : null;
}

/**
 * Every season Sleeper could have a league for: from its first through the
 * one leagues are being made for now, which runs a year ahead once Sleeper
 * rolls over to next season.
 */
function seasonsToAsk(state: NFLState): number[] {
  const last = Math.max(Number(state.season), Number(state.league_create_season ?? state.season));
  const years: number[] = [];
  for (let y = last; y >= FIRST_SEASON; y--) years.push(y);
  return years;
}

const STATUS_ORDER: Record<string, number> = { in_season: 0, drafting: 1, pre_draft: 2, complete: 3 };

/** Joins each league's seasons together, newest season first within each. */
export function groupLeagues(seasons: SleeperLeague[]): UserLeague[] {
  const byId = new Map(seasons.map((l) => [l.league_id, l]));
  const continued = new Set(seasons.map((l) => l.previous_league_id).filter((id): id is string => !!id));
  const leagues: UserLeague[] = [];
  for (const head of byId.values()) {
    if (continued.has(head.league_id)) continue;
    const years: number[] = [];
    const seen = new Set<string>();
    for (let l: SleeperLeague | undefined = head; l && !seen.has(l.league_id); l = byId.get(l.previous_league_id ?? "")) {
      seen.add(l.league_id);
      years.push(Number(l.season));
    }
    leagues.push({
      id: head.league_id,
      name: head.name || "Unnamed league",
      avatar: head.avatar ? `https://sleepercdn.com/avatars/thumbs/${head.avatar}` : null,
      status: head.status,
      seasons: years,
    });
  }
  // Leagues still going first, then those that ended most recently.
  return leagues.sort(
    (a, b) =>
      b.seasons[0]! - a.seasons[0]! ||
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      a.name.localeCompare(b.name),
  );
}

/** The user's display name and every league they have played in. */
export async function findUserLeagues(username: string): Promise<{ user: { id: string; name: string }; leagues: UserLeague[] }> {
  const [user, state] = await Promise.all([
    get<SleeperUser | null>(`/v1/user/${encodeURIComponent(username)}`),
    get<NFLState>("/v1/state/nfl"),
  ]);
  if (!user?.user_id) throw new UserNotFoundError(`no Sleeper user ${username}`);
  // One season failing to load costs only that season's leagues.
  const perSeason = await Promise.all(
    seasonsToAsk(state).map((year) =>
      get<SleeperLeague[] | null>(`/v1/user/${encodeURIComponent(user.user_id)}/leagues/nfl/${year}`).catch(() => null),
    ),
  );
  return {
    user: { id: user.user_id, name: user.display_name || user.username },
    leagues: groupLeagues(perSeason.flatMap((l) => l ?? [])),
  };
}
