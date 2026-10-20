import { matchupsToStandingsMap, sortStandingsMap } from "./standings";
import { NewMatchup } from "./types";

/**
 * Playoff odds by simulation: play out the rest of the regular season many
 * times with plausible scores, rank each finished season with the real
 * tiebreakers, and count where every team lands.
 *
 * Pure and I/O-free so it can run in the browser. The dashboard bundles this
 * module (see the build script in package.json) instead of asking the Worker
 * to run it: thousands of simulated seasons take far more CPU than a Worker
 * request is allowed, while a browser does them in well under a second. It
 * also means a viewer's what-if picks never cost a request.
 */

/** A regular season game that has not been played yet. */
export interface Pairing {
  week: number;
  homeId: string;
  awayId: string;
}

/** What scores each team is likely to put up in the games still to play. */
export interface ScoreModel {
  /** Expected score per game, by user id. */
  mean: Map<string, number>;
  /** Spread of a single game's score around a team's mean, league-wide. */
  sd: number;
}

// How many league-average games each team's own average is blended with.
// Early in the season a team's average is mostly noise — one 180-point week
// would otherwise make it a juggernaut — and this pulls it toward the middle
// until enough games have been played to trust it.
const SHRINK_GAMES = 3;

// Used when there are too few games to measure spread at all.
const FALLBACK_SD = 25;

/**
 * Fits each team's expected score from its regular season games so far,
 * pulled toward the league average, with one league-wide spread.
 */
export function fitScoreModel(played: NewMatchup[]): ScoreModel {
  const scores = new Map<string, number[]>();
  const add = (userId: string, score: number) => {
    const list = scores.get(userId);
    if (list) list.push(score);
    else scores.set(userId, [score]);
  };
  for (const m of played) {
    if (m.is_playoff) continue;
    add(m.home_user_id, m.home_score);
    add(m.away_user_id, m.away_score);
  }

  const all = [...scores.values()].flat();
  const leagueMean = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;

  const mean = new Map<string, number>();
  let squares = 0;
  let residuals = 0;
  for (const [userId, list] of scores) {
    const own = list.reduce((a, b) => a + b, 0) / list.length;
    mean.set(userId, (list.length * own + SHRINK_GAMES * leagueMean) / (list.length + SHRINK_GAMES));
    for (const s of list) squares += (s - own) ** 2;
    // Each team's own mean uses up one degree of freedom.
    residuals += list.length - 1;
  }

  return {
    mean,
    sd: residuals > 1 ? Math.sqrt(squares / residuals) : FALLBACK_SD,
  };
}

/** A viewer's pick for one unplayed game: the user id they say wins it. */
export type Picks = Map<string, string>;

/** Identifies a pairing for picks, independent of home and away order. */
export function pairingKey(p: Pairing): string {
  return `${p.week}:${[p.homeId, p.awayId].sort().join("|")}`;
}

export interface TeamOdds {
  userId: string;
  /** Share of simulations finishing in each seed, index 0 being the 1 seed. */
  seeds: number[];
  playoffs: number;
  bye: number;
  topSeed: number;
  /**
   * Playoff odds given this team's result in its next unpicked game, or null
   * when it has none left (or it is already picked).
   */
  nextGame: { week: number; ifWin: number; ifLose: number } | null;
}

export interface SimulationInput {
  played: NewMatchup[];
  remaining: Pairing[];
  picks?: Picks;
  playoffTeams: number;
  byeTeams: number;
  runs: number;
  model?: ScoreModel;
  /** Uniform [0, 1) source, injectable so tests can be deterministic. */
  random?: () => number;
}

export function simulatePlayoffRace(input: SimulationInput): TeamOdds[] {
  const { played, remaining, playoffTeams, byeTeams, runs } = input;
  const picks = input.picks ?? new Map();
  const model = input.model ?? fitScoreModel(played);
  const random = input.random ?? Math.random;
  const regular = played.filter((m) => !m.is_playoff);

  const teams = [...matchupsToStandingsMap([...regular, ...remaining.map(toMatchup)]).keys()];
  const index = new Map(teams.map((id, i) => [id, i]));
  const seedCounts = teams.map(() => new Array<number>(teams.length).fill(0));

  // The week each team's next game falls in, among games nobody has picked.
  // Those are the games where "what if I win?" is still an open question.
  const nextWeek = new Map<string, number>();
  for (const p of [...remaining].sort((a, b) => a.week - b.week)) {
    if (picks.has(pairingKey(p))) continue;
    for (const id of [p.homeId, p.awayId]) {
      if (!nextWeek.has(id)) nextWeek.set(id, p.week);
    }
  }
  const split = teams.map(() => ({ wins: 0, winsIn: 0, losses: 0, lossesIn: 0 }));

  const normal = () => {
    // Box-Muller. 1 - random() keeps the log argument off zero.
    const u = 1 - random();
    const v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const score = (userId: string) =>
    Math.max(0, (model.mean.get(userId) ?? 0) + model.sd * normal());

  for (let run = 0; run < runs; run++) {
    const outcomes: { userId: string; won: boolean }[] = [];
    const simulated = remaining.map((p): NewMatchup => {
      let home = score(p.homeId);
      let away = score(p.awayId);
      // A pick decides the winner but not the margin: draw both scores as
      // usual and swap them if they came out the wrong way round, so points
      // for still moves the way it would in a real win.
      const pick = picks.get(pairingKey(p));
      if ((pick === p.homeId && home < away) || (pick === p.awayId && away < home)) {
        [home, away] = [away, home];
      }
      if (nextWeek.get(p.homeId) === p.week) outcomes.push({ userId: p.homeId, won: home > away });
      if (nextWeek.get(p.awayId) === p.week) outcomes.push({ userId: p.awayId, won: away > home });
      return { ...toMatchup(p), home_score: home, away_score: away };
    });

    const order = sortStandingsMap(matchupsToStandingsMap([...regular, ...simulated]));
    const seedOf = new Map<string, number>();
    order.forEach((s, seed) => {
      seedCounts[index.get(s.userId)!]![seed]!++;
      seedOf.set(s.userId, seed);
    });

    for (const { userId, won } of outcomes) {
      const tally = split[index.get(userId)!]!;
      const made = seedOf.get(userId)! < playoffTeams ? 1 : 0;
      if (won) {
        tally.wins++;
        tally.winsIn += made;
      } else {
        tally.losses++;
        tally.lossesIn += made;
      }
    }
  }

  const share = (n: number, of: number) => (of ? n / of : 0);
  return teams.map((userId, i) => {
    const seeds = seedCounts[i]!.map((n) => share(n, runs));
    const sum = (upTo: number) => seeds.slice(0, upTo).reduce((a, b) => a + b, 0);
    const week = nextWeek.get(userId);
    const tally = split[i]!;
    return {
      userId,
      seeds,
      playoffs: sum(playoffTeams),
      bye: sum(byeTeams),
      topSeed: seeds[0] ?? 0,
      nextGame:
        week === undefined
          ? null
          : { week, ifWin: share(tally.winsIn, tally.wins), ifLose: share(tally.lossesIn, tally.losses) },
    };
  });
}

export type Clinch = "clinched" | "eliminated" | null;

export interface ClinchStatus {
  userId: string;
  playoffs: Clinch;
  bye: Clinch;
}

/**
 * Which teams are mathematically in or out, whatever happens.
 *
 * Simulations can only say "every run we tried"; this says "every possible
 * result". It counts wins alone and assumes every tiebreak goes against the
 * team in question, which makes it conservative: it may call a race open a
 * week after it is really settled, but it never marks a team clinched or
 * eliminated wrongly.
 *
 *   clinched   — fewer than `spots` other teams can even reach this team's
 *                current win total, so at most spots - 1 can finish above it.
 *   eliminated — at least `spots` other teams already have more wins than
 *                this team can reach.
 */
export function clinchStatus(
  played: NewMatchup[],
  remaining: Pairing[],
  playoffTeams: number,
  byeTeams: number,
): ClinchStatus[] {
  const standings = matchupsToStandingsMap([...played.filter((m) => !m.is_playoff), ...remaining.map(toMatchup)]);
  // matchupsToStandingsMap counted the unplayed 0-0 games as ties; take them
  // back out and count them as games left instead.
  const left = new Map<string, number>();
  for (const p of remaining) {
    left.set(p.homeId, (left.get(p.homeId) ?? 0) + 1);
    left.set(p.awayId, (left.get(p.awayId) ?? 0) + 1);
  }
  const teams = [...standings.values()].map((s) => ({
    userId: s.userId,
    wins: s.wins,
    max: s.wins + (left.get(s.userId) ?? 0),
  }));

  const status = (team: (typeof teams)[number], spots: number): Clinch => {
    const others = teams.filter((t) => t.userId !== team.userId);
    if (others.filter((t) => t.max >= team.wins).length < spots) return "clinched";
    if (others.filter((t) => t.wins > team.max).length >= spots) return "eliminated";
    return null;
  };

  return teams.map((t) => ({
    userId: t.userId,
    playoffs: status(t, playoffTeams),
    bye: status(t, byeTeams),
  }));
}

function toMatchup(p: Pairing): NewMatchup {
  return {
    year: 0,
    week: p.week,
    is_playoff: false,
    playoff_round: null,
    home_user_id: p.homeId,
    away_user_id: p.awayId,
    home_seed: null,
    away_seed: null,
    home_score: 0,
    away_score: 0,
  };
}
