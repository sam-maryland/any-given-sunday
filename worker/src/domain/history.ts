import {
  PAY_IN_BUY_IN,
  PAY_OUT_FIRST_PLACE,
  PAY_OUT_SECOND_PLACE,
  PAY_OUT_THIRD_PLACE,
  PAY_OUT_WEEKLY_HIGH_SCORE,
} from "./careerStats";
import { Finish, standingsForLeague } from "./standings";
import { TradeStats, buildTradeStats, emptyTradeStats } from "./trades";
import { League, LeagueStatus, NewMatchup, Roster, Transaction, UserMap } from "./types";

/**
 * The league's whole history, per owner and league-wide, for the website's
 * owner and history pages.
 *
 * Built from the same rows and the same standings code as everything else,
 * so a season's seed and finish here always match that season's standings
 * page. Pure and I/O-free; the API handler does the loading.
 */

export interface Record3 {
  wins: number;
  losses: number;
  ties: number;
}

export interface SeasonLine {
  year: number;
  /** Still being played: the seed is today's rank and there is no finish. */
  inProgress: boolean;
  record: Record3;
  pointsFor: number;
  pointsAgainst: number;
  /** Regular season rank: the playoff seed for the top six. */
  seed: number;
  finish: Finish | null;
  highScoreWeeks: number;
  earnings: number;
}

export interface HeadToHead {
  opponentId: string;
  /** Every meeting, regular season and playoffs. */
  record: Record3;
  playoffRecord: Record3;
  pointsFor: number;
  pointsAgainst: number;
}

/** One game, told from the side that set the record. */
export interface GameRef {
  year: number;
  week: number;
  userId: string;
  opponentId: string;
  score: number;
  opponentScore: number;
}

export interface OwnerHistory {
  userId: string;
  /** The owner's name, which unlike a team name stays put across seasons. */
  name: string;
  /** For the page address: /owner?o=<slug>. */
  slug: string;
  /**
   * What the site calls the owner: their current Sleeper team name, else
   * Sleeper username, else their own name. Changes when a team is renamed,
   * which is why pages and slugs key on the owner's name instead.
   */
  label: string;
  seasons: number;
  /** Regular season only, as the standings count it. */
  record: Record3;
  pointsFor: number;
  pointsAgainst: number;
  playoffAppearances: number;
  playoffRecord: Record3;
  titles: number;
  runnerUps: number;
  thirdPlaces: number;
  highScoreWeeks: number;
  /** Best regular season score. */
  bestWeek: GameRef | null;
  earnings: number;
  /** Oldest first. */
  seasonLines: SeasonLine[];
  /** Most-played opponents first. */
  headToHead: HeadToHead[];
  trades: TradeStats;
}

export interface Podium {
  year: number;
  first: string;
  second: string;
  third: string;
}

export interface LeagueRecords {
  highestScore: GameRef | null;
  lowestScore: GameRef | null;
  biggestBlowout: GameRef | null;
  closestGame: GameRef | null;
  highestInLoss: GameRef | null;
  lowestInWin: GameRef | null;
}

export interface LeagueHistory {
  owners: OwnerHistory[];
  /** Completed seasons with a recorded podium, newest first. */
  podiums: Podium[];
  /** Regular season games only: two-week playoff finals would skew them. */
  records: LeagueRecords;
  /** The season in progress, if any. */
  currentYear: number | null;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const blank = (): Record3 => ({ wins: 0, losses: 0, ties: 0 });

function tally(r: Record3, mine: number, theirs: number) {
  if (mine > theirs) r.wins++;
  else if (mine < theirs) r.losses++;
  else r.ties++;
}

/** Each matchup from both sides, so every per-owner stat is one pass. */
function sides(m: NewMatchup): GameRef[] {
  return [
    { year: m.year, week: m.week, userId: m.home_user_id, opponentId: m.away_user_id, score: m.home_score, opponentScore: m.away_score },
    { year: m.year, week: m.week, userId: m.away_user_id, opponentId: m.home_user_id, score: m.away_score, opponentScore: m.home_score },
  ];
}

/**
 * Who took each week's high score bonus, as user id → number of weeks. A
 * tie credits every tied owner, as the career_stats view does; there has
 * not been one yet.
 */
function highScoreWeeks(regular: NewMatchup[]): Map<string, Map<number, number>> {
  const best = new Map<string, number>();
  for (const m of regular) {
    const key = `${m.year}:${m.week}`;
    best.set(key, Math.max(best.get(key) ?? -Infinity, m.home_score, m.away_score));
  }
  const byOwner = new Map<string, Map<number, number>>();
  for (const m of regular) {
    for (const s of sides(m)) {
      if (s.score !== best.get(`${m.year}:${m.week}`)) continue;
      const years = byOwner.get(s.userId) ?? new Map<number, number>();
      years.set(m.year, (years.get(m.year) ?? 0) + 1);
      byOwner.set(s.userId, years);
    }
  }
  return byOwner;
}

function payout(league: League, userId: string): number {
  if (league.status !== LeagueStatus.Complete) return 0;
  if (league.first_place === userId) return PAY_OUT_FIRST_PLACE;
  if (league.second_place === userId) return PAY_OUT_SECOND_PLACE;
  if (league.third_place === userId) return PAY_OUT_THIRD_PLACE;
  return 0;
}

export function buildLeagueHistory(
  leagues: League[],
  matchups: NewMatchup[],
  users: UserMap,
  /** user id → label, for owners Sleeper could name; the rest use their name. */
  labels: Map<string, string>,
  transactions: Transaction[] = [],
  rosters: Roster[] = [],
): LeagueHistory {
  const started = leagues.filter((l) => l.status !== LeagueStatus.Pending).sort((a, b) => a.year - b.year);
  const regular = matchups.filter((m) => !m.is_playoff);
  const highScores = highScoreWeeks(regular);
  const trades = buildTradeStats(transactions, rosters);

  // Seed and finish per owner per season, from the standings themselves.
  const placed = new Map<string, { seed: number; finish: Finish | null }>();
  const seasonsByOwner = new Map<string, Set<number>>();
  for (const league of started) {
    const games = matchups.filter((m) => m.year === league.year);
    if (games.length === 0) continue;
    const result = standingsForLeague(league, games);
    result.standings.forEach((s, i) => {
      const why = result.explanations[i]!;
      placed.set(`${league.year}:${s.userId}`, { seed: why.seed, finish: why.finish });
      const years = seasonsByOwner.get(s.userId) ?? new Set();
      years.add(league.year);
      seasonsByOwner.set(s.userId, years);
    });
  }

  const owners: OwnerHistory[] = [];
  const slugs = new Set<string>();
  for (const [userId, years] of seasonsByOwner) {
    const name = users.get(userId)?.name || userId;
    // Owners with the same name would share a page; the second gets its id.
    let slug = slugify(name) || userId;
    if (slugs.has(slug)) slug = `${slug}-${userId}`;
    slugs.add(slug);

    const mine = (m: NewMatchup) => m.home_user_id === userId || m.away_user_id === userId;
    const mySides = (list: NewMatchup[]) => list.filter(mine).flatMap(sides).filter((s) => s.userId === userId);
    const regularSides = mySides(regular);
    const playoffSides = mySides(matchups.filter((m) => m.is_playoff));

    const record = blank();
    let pointsFor = 0;
    let pointsAgainst = 0;
    let bestWeek: GameRef | null = null;
    for (const s of regularSides) {
      tally(record, s.score, s.opponentScore);
      pointsFor += s.score;
      pointsAgainst += s.opponentScore;
      if (!bestWeek || s.score > bestWeek.score) bestWeek = s;
    }
    const playoffRecord = blank();
    for (const s of playoffSides) tally(playoffRecord, s.score, s.opponentScore);

    const h2h = new Map<string, HeadToHead>();
    for (const s of [...regularSides, ...playoffSides]) {
      const row = h2h.get(s.opponentId) ?? { opponentId: s.opponentId, record: blank(), playoffRecord: blank(), pointsFor: 0, pointsAgainst: 0 };
      tally(row.record, s.score, s.opponentScore);
      row.pointsFor += s.score;
      row.pointsAgainst += s.opponentScore;
      h2h.set(s.opponentId, row);
    }
    for (const s of playoffSides) tally(h2h.get(s.opponentId)!.playoffRecord, s.score, s.opponentScore);

    const seasonLines: SeasonLine[] = [];
    for (const league of started) {
      if (!years.has(league.year)) continue;
      const inSeason = regularSides.filter((s) => s.year === league.year);
      const r = blank();
      for (const s of inSeason) tally(r, s.score, s.opponentScore);
      const hs = highScores.get(userId)?.get(league.year) ?? 0;
      const place = placed.get(`${league.year}:${userId}`)!;
      seasonLines.push({
        year: league.year,
        inProgress: league.status !== LeagueStatus.Complete,
        record: r,
        pointsFor: round2(inSeason.reduce((sum, s) => sum + s.score, 0)),
        pointsAgainst: round2(inSeason.reduce((sum, s) => sum + s.opponentScore, 0)),
        seed: place.seed,
        finish: place.finish,
        highScoreWeeks: hs,
        // The buy-in is paid at the start of a season and weekly bonuses as
        // they happen, so a season in progress already counts both.
        earnings: -PAY_IN_BUY_IN + hs * PAY_OUT_WEEKLY_HIGH_SCORE + payout(league, userId),
      });
    }

    const finished = started.filter((l) => l.status === LeagueStatus.Complete && years.has(l.year));
    owners.push({
      userId,
      name,
      slug,
      label: labels.get(userId) ?? name,
      seasons: years.size,
      record,
      pointsFor: round2(pointsFor),
      pointsAgainst: round2(pointsAgainst),
      playoffAppearances: seasonLines.filter((l) => l.finish && l.finish !== "missedPlayoffs").length,
      playoffRecord,
      titles: finished.filter((l) => l.first_place === userId).length,
      runnerUps: finished.filter((l) => l.second_place === userId).length,
      thirdPlaces: finished.filter((l) => l.third_place === userId).length,
      highScoreWeeks: seasonLines.reduce((sum, l) => sum + l.highScoreWeeks, 0),
      bestWeek,
      earnings: seasonLines.reduce((sum, l) => sum + l.earnings, 0),
      seasonLines,
      headToHead: [...h2h.values()]
        .map((row) => ({ ...row, pointsFor: round2(row.pointsFor), pointsAgainst: round2(row.pointsAgainst) }))
        .sort((a, b) => games(b.record) - games(a.record) || (users.get(a.opponentId)?.name ?? "").localeCompare(users.get(b.opponentId)?.name ?? "")),
      trades: trades.get(userId) ?? emptyTradeStats(),
    });
  }

  owners.sort((a, b) => b.titles - a.titles || b.earnings - a.earnings || a.name.localeCompare(b.name));

  return {
    owners,
    podiums: started
      .filter((l) => l.status === LeagueStatus.Complete && l.first_place)
      .map((l) => ({ year: l.year, first: l.first_place, second: l.second_place, third: l.third_place }))
      .reverse(),
    records: leagueRecords(regular),
    currentYear: started.find((l) => l.status === LeagueStatus.InProgress)?.year ?? null,
  };
}

function leagueRecords(regular: NewMatchup[]): LeagueRecords {
  const all = regular.flatMap(sides);
  // Winners' sides only for the margin records, so each game counts once.
  const winners = all.filter((s) => s.score > s.opponentScore);
  const losers = all.filter((s) => s.score < s.opponentScore);
  const top = (list: GameRef[], by: (s: GameRef) => number): GameRef | null =>
    list.reduce<GameRef | null>((best, s) => (!best || by(s) > by(best) ? s : best), null);

  return {
    highestScore: top(all, (s) => s.score),
    lowestScore: top(all, (s) => -s.score),
    biggestBlowout: top(winners, (s) => s.score - s.opponentScore),
    closestGame: top(winners, (s) => -(s.score - s.opponentScore)),
    highestInLoss: top(losers, (s) => s.score),
    lowestInWin: top(winners, (s) => -s.score),
  };
}

const games = (r: Record3) => r.wins + r.losses + r.ties;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
