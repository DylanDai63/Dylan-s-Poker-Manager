// Preflop trainer — pure logic (no DOM).
//
// Everything the trainer needs to decide is here: dealing a random combo,
// looking up the strategy for a hand, judging an answer, and describing the
// table situation. Kept DOM-free so scripts/test_trainer_core.mjs can run it
// under node without a browser.
//
// Strategy shape used throughout: { raise, call, fold } — each 0..1, sum 1.
//   RFI:    raise = open, call = limp (SB only), fold
//   VS_UTG: raise = 3-bet, call = flat, fold

import {
  RANKS, RFI, VS_UTG, POSITIONS_RFI, POSITIONS_VS_UTG, POSITION_LABEL,
} from "./ranges.js";

export const SUITS = ["s", "h", "d", "c"];
export const SUIT_GLYPH = { s: "♠", h: "♥", d: "♦", c: "♣" };

export const SCENARIOS = {
  RFI:    { label: "开池 RFI",     positions: POSITIONS_RFI },
  VS_UTG: { label: "vs UTG 开池", positions: POSITIONS_VS_UTG },
};
export const RANDOM_POSITION = "RANDOM";

// 8-max seating in preflop action order (UTG acts first, BB last).
export const SEAT_ORDER = ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"];

export const ACTION_KEYS = ["raise", "call", "fold"];

// Frequencies below this are treated as "never". Chart resolution is 0.1%
// (entries like 0.3% exist and count as real actions), so this only absorbs
// float noise such as 1e-16 left over from 1 - raise - call.
const NEVER_EPS = 0.0005;

const RANK_IDX = Object.fromEntries(RANKS.map((r, i) => [r, i])); // A=0 … 2=12

// ─────────────────────────── dealing ───────────────────────────

export function cardFromIndex(i) {
  return { rank: RANKS[Math.floor(i / 4)], suit: SUITS[i % 4] };
}

// Two cards → hand class ("AA", "AKs", "AKo"). Order-independent.
export function classify(c1, c2) {
  if (c1.rank === c2.rank) return c1.rank + c2.rank;
  const [hi, lo] = RANK_IDX[c1.rank] < RANK_IDX[c2.rank] ? [c1, c2] : [c2, c1];
  return hi.rank + lo.rank + (hi.suit === lo.suit ? "s" : "o");
}

// Uniform over the 1326 distinct two-card combos (not over the 169 classes),
// so pairs/suited/offsuit show up at their real-life frequencies.
export function dealCombo(rng = Math.random) {
  const a = Math.floor(rng() * 52);
  let b = Math.floor(rng() * 51);
  if (b >= a) b += 1;                      // second card ≠ first, still uniform
  const cards = [cardFromIndex(a), cardFromIndex(b)];
  cards.sort((x, y) => RANK_IDX[x.rank] - RANK_IDX[y.rank]);   // high card first
  return { cards, hand: classify(cards[0], cards[1]) };
}

// ─────────────────────────── strategy lookup ───────────────────────────

function round4(x) { return Math.round(x * 10000) / 10000; }

export function strategyFor(scenario, position, hand) {
  const chart = scenario === "RFI" ? RFI[position] : VS_UTG[position];
  if (!chart) throw new Error(`no chart for ${scenario}/${position}`);
  const v = chart[hand];
  const raise = v ? round4(v[0]) : 0;
  const call  = v ? round4(v[1]) : 0;
  const fold  = round4(Math.max(0, 1 - raise - call));
  return { raise, call, fold };
}

// All actions sharing the highest frequency (usually one; two on a 50/50).
export function topActions(strategy) {
  const max = Math.max(strategy.raise, strategy.call, strategy.fold);
  return ACTION_KEYS.filter((k) => strategy[k] >= max - 1e-9);
}

export function nonZeroActions(strategy) {
  return ACTION_KEYS.filter((k) => strategy[k] >= NEVER_EPS);
}

// ─────────────────────────── judging ───────────────────────────

// "best"  = the action with the highest frequency (ties: all of them)
// "ok"    = a non-zero action that is not the highest
// "wrong" = an action the chart never takes
export function judge(strategy, action) {
  const f = strategy[action] ?? 0;
  if (f < NEVER_EPS) return "wrong";
  const max = Math.max(strategy.raise, strategy.call, strategy.fold);
  return f >= max - 1e-9 ? "best" : "ok";
}

export const MARK = { best: "✓✓", ok: "✓", wrong: "✗" };

// ─────────────────────────── actions / positions ───────────────────────────

// The three buttons for a spot. RFI has no "call" except SB's limp, so the
// button is disabled there rather than being a trap that is always wrong.
export function actionsFor(scenario, position) {
  if (scenario === "RFI") {
    const sb = position === "SB";
    return [
      { key: "fold",  label: "Fold",                 disabled: false },
      { key: "call",  label: sb ? "Limp" : "Call",   disabled: !sb },
      { key: "raise", label: "Open",                 disabled: false },
    ];
  }
  return [
    { key: "fold",  label: "Fold",  disabled: false },
    { key: "call",  label: "Call",  disabled: false },
    { key: "raise", label: "3-Bet", disabled: false },
  ];
}

export function normalizeChoice(scenario, choice) {
  if (choice === RANDOM_POSITION) return choice;
  const list = SCENARIOS[scenario].positions;
  return list.includes(choice) ? choice : list[list.length - 1];   // default BTN / BB
}

export function pickPosition(scenario, choice, rng = Math.random) {
  const list = SCENARIOS[scenario].positions;
  if (choice === RANDOM_POSITION) return list[Math.floor(rng() * list.length)];
  return normalizeChoice(scenario, choice);
}

// ─────────────────────────── table description ───────────────────────────

// Pot before hero acts: blinds 1.5bb; after a 2bb UTG open 3.5bb.
export function potBefore(scenario) {
  return scenario === "RFI" ? 1.5 : 3.5;
}

export function situationText(scenario, position) {
  const p = POSITION_LABEL[position];
  if (scenario === "RFI") {
    return position === "SB"
      ? `前面全弃,轮到你(${p})· 加注 3bb 或 limp`
      : `前面全弃,轮到你(${p})· 开池 2bb?`;
  }
  return `UTG 开池 2bb,轮到你(${p})`;
}

// Per-seat role for drawing the table.
//   hero / raiser (UTG in VS_UTG) / folded (acted before hero) / pending
export function seatStates(scenario, hero) {
  const hi = SEAT_ORDER.indexOf(hero);
  return SEAT_ORDER.map((pos, i) => {
    let role;
    if (i === hi) role = "hero";
    else if (scenario === "VS_UTG" && i === 0) role = "raiser";
    else if (i < hi) role = "folded";
    else role = "pending";
    return { pos, role };
  });
}

// ─────────────────────────── session stats ───────────────────────────

export function emptyStats() {
  return { hands: 0, best: 0, ok: 0, wrong: 0 };
}

export function addResult(stats, verdict) {
  return { ...stats, hands: stats.hands + 1, [verdict]: stats[verdict] + 1 };
}

// Share of hands that were at least acceptable (best or ok). null when empty.
export function accuracy(stats) {
  return stats.hands ? (stats.best + stats.ok) / stats.hands : null;
}

export function formatPct(f) {
  const v = Math.round(f * 1000) / 10;
  return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + "%";
}
