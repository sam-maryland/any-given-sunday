// Helpers shared by every page. Plain ES module, served as is; the league
// itself is loaded by app.js, which the build bundles from src/client.

import { historyFor, leagueInfo, loadLeague } from "/app.js";

// Team and owner names are user-supplied, so every string goes in as a text
// node; nothing is ever parsed as markup.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.setAttribute("style", v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (id) => document.getElementById(id);

/** Season totals and averages, to one decimal. */
export const pts = (n) => n.toFixed(1);

/** A single game's score, to the hundredth Sleeper scores in. */
export const score = (n) => n.toFixed(2);

export const record = (r) => (r.ties ? `${r.wins}–${r.losses}–${r.ties}` : `${r.wins}–${r.losses}`);

export const games = (r) => r.wins + r.losses + r.ties;

/** Win share with a tie as half a win, as ".643". */
export function winPct(r) {
  const n = games(r);
  if (!n) return "—";
  const p = (r.wins + r.ties / 2) / n;
  return p === 1 ? "1.000" : p.toFixed(3).replace(/^0/, "");
}

export function money(n) {
  if (n === 0) return "$0";
  return `${n > 0 ? "+" : "−"}$${Math.abs(n).toLocaleString()}`;
}

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const FINISH_LABEL = {
  champion: "Champion",
  runnerUp: "Runner-up",
  thirdPlace: "Third place",
  fourthPlace: "Fourth place",
  semifinal: "Semifinal exit",
  quarterfinal: "Quarterfinal exit",
  firstRound: "First round exit",
  missedPlayoffs: "Missed playoffs",
};

export const ownerHref = (o) => `/owner?o=${encodeURIComponent(o.slug)}`;

// ---------- The league ----------
//
// Every page shows one Sleeper league, named by ?league=<id>: the id of its
// current season. A page opened without one falls back to the league this
// browser last opened, so a bookmark of /history still works.

const RECENT_KEY = "recentLeagues";
const RECENT_MAX = 6;

/** Leagues this browser has opened, most recent first: [{ id, name }]. */
export function recentLeagues() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((l) => l && typeof l.id === "string") : [];
  } catch {
    return [];
  }
}

function remember(id, name) {
  try {
    const list = [{ id, name }, ...recentLeagues().filter((l) => l.id !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Storage blocked: the league just isn't remembered.
  }
}

export function forgetLeague(id) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentLeagues().filter((l) => l.id !== id)));
  } catch {
    // Nothing to forget.
  }
}

/** The league this page is for: the one in the address, else the last one opened. */
export function leagueId({ fallback = true } = {}) {
  const id = new URLSearchParams(location.search).get("league");
  if (id && /^\d{6,24}$/.test(id)) return id;
  return fallback ? (recentLeagues()[0]?.id ?? null) : null;
}

/** A site path with this page's league kept on it. */
export function withLeague(path, id = leagueId()) {
  if (!id) return path;
  const url = new URL(path, location.origin);
  url.searchParams.set("league", id);
  return url.pathname + url.search + url.hash;
}

// Links in the markup and in what the pages render are written as plain
// site paths; carry the league on every one of them, now and as they appear.
function keepLeagueOnLinks(id) {
  const fix = (a) => {
    const href = a.getAttribute("href");
    if (!href || !href.startsWith("/") || href.startsWith("//") || /[?&]league=/.test(href)) return;
    a.setAttribute("href", withLeague(href, id));
  };
  document.querySelectorAll("a[href]").forEach(fix);
  new MutationObserver((changes) => {
    for (const c of changes) {
      for (const node of c.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches("a[href]")) fix(node);
        node.querySelectorAll?.("a[href]").forEach(fix);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

/** Up to two letters for the badge beside the league's name. */
function initials(name) {
  const words = name.match(/[A-Za-z0-9]+/g) ?? [];
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "ff").slice(0, 2)).toLowerCase();
}

function brand(info) {
  document.querySelectorAll(".eyebrow").forEach((el) => {
    const mark = h("span", { class: "mark", "aria-hidden": "true" }, initials(info.name));
    el.replaceChildren(mark, info.name);
  });
}

let pending = null;

/**
 * The league, every season of it, loaded from Sleeper once per page. With no
 * league to show, sends the visitor to the front page to pick one. `onProgress`
 * hears ({ done, total }) seasons as they arrive.
 */
export function currentLeague(onProgress = showProgress) {
  if (!pending) {
    const id = leagueId();
    if (!id) {
      location.replace("/");
      return new Promise(() => {});
    }
    keepLeagueOnLinks(id);
    pending = loadLeague(id, onProgress).then((data) => {
      const info = leagueInfo(data);
      remember(id, info.name);
      brand(info);
      return { data, info };
    });
  }
  return pending;
}

// Until the league arrives, the page's meta line says how far along it is:
// a first visit to a long-running league reads a few hundred things from
// Sleeper.
function showProgress({ done, total }) {
  const meta = document.getElementById("meta");
  if (meta && done < total) meta.replaceChildren(h("span", null, `Loading ${done} of ${plural(total, "season")} from Sleeper…`));
}

/** The suffix for each page's title. */
export const titleSuffix = (info) => ` — ${info.name}`;

export async function loadHistory() {
  const { data, info } = await currentLeague();
  return { ...historyFor(data), league: info };
}
