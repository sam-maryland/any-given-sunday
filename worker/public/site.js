// Helpers shared by the history and owner pages. Plain ES module, served as
// is: no build step.

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
  quarterfinal: "Quarterfinal exit",
  missedPlayoffs: "Missed playoffs",
};

export const ownerHref = (o) => `/owner?o=${encodeURIComponent(o.slug)}`;

// v matches PAYLOAD_VERSION in src/api/history.ts, so a browser never reuses
// a payload cached for an older page.
export async function loadHistory() {
  const res = await fetch("/api/history?v=1");
  if (!res.ok) throw new Error(`request failed (${res.status})`);
  return res.json();
}
