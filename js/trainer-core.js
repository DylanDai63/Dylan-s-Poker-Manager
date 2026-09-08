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
  RANKS, RFI, VS_UTG, POSITIONS_RFI, POSITIONS_VS_UTG, POSITION_LABEL, handAt,
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

// ─────────────────────────── deal range (which hands to practise) ───────────────────────────

// The 169 hand classes in matrix order (row-major, same as the 13×13 grid).
export const ALL_HANDS = (() => {
  const out = [];
  for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) out.push(handAt(r, c));
  return out;
})();
const HAND_SET = new Set(ALL_HANDS);

export function comboCount(hand) {
  return hand.length === 2 ? 6 : hand.endsWith("s") ? 4 : 12;
}

// Keep only real hand classes, de-duplicated, in matrix order.
export function normalizeHands(list) {
  const set = new Set((Array.isArray(list) ? list : []).filter((h) => typeof h === "string" && HAND_SET.has(h)));
  return ALL_HANDS.filter((h) => set.has(h));
}

// Random concrete cards for a hand class (uniform over that class's combos).
export function cardsForHand(hand, rng = Math.random) {
  const [r1, r2] = [hand[0], hand[1]];
  const a = Math.floor(rng() * 4);
  if (hand.length === 3 && hand[2] === "s") {
    return [{ rank: r1, suit: SUITS[a] }, { rank: r2, suit: SUITS[a] }];
  }
  let b = Math.floor(rng() * 3);           // a different suit: pairs need it, offsuit by definition
  if (b >= a) b += 1;
  return [{ rank: r1, suit: SUITS[a] }, { rank: r2, suit: SUITS[b] }];
}

// Deal uniformly over the combos of the selected classes (a pair weighs 6,
// suited 4, offsuit 12), so a filtered drill keeps real-life proportions
// inside the filter. Empty / all-invalid selection → full deck.
export function dealFromHands(hands, rng = Math.random) {
  const list = normalizeHands(hands);
  if (!list.length) return dealCombo(rng);
  const total = list.reduce((s, h) => s + comboCount(h), 0);
  let t = rng() * total;
  let pick = list[list.length - 1];
  for (const h of list) {
    t -= comboCount(h);
    if (t < 0) { pick = h; break; }
  }
  return { cards: cardsForHand(pick, rng), hand: pick };
}

export function rangeSummary(hands) {
  const list = normalizeHands(hands);
  const combos = list.reduce((s, h) => s + comboCount(h), 0);
  return { hands: list.length, combos, pct: combos / 1326 };
}

// Quick selections for the picker. "playable"/"mixed" depend on the spot
// (scenario + position must be a valid chart): playable = the chart takes
// raise or call at all; mixed = no action is (near-)pure, i.e. the spot has
// a real frequency decision. Unknown kinds throw rather than silently
// meaning "all".
export function presetHands(kind, scenario, position) {
  switch (kind) {
    case "all":     return [...ALL_HANDS];
    case "pairs":   return ALL_HANDS.filter((h) => h.length === 2);
    case "suited":  return ALL_HANDS.filter((h) => h.endsWith("s"));
    case "offsuit": return ALL_HANDS.filter((h) => h.endsWith("o"));
    case "playable": return ALL_HANDS.filter((h) => {
      const s = strategyFor(scenario, position, h);
      return s.raise + s.call >= NEVER_EPS;
    });
    case "mixed": return ALL_HANDS.filter((h) => {
      const s = strategyFor(scenario, position, h);
      return Math.max(s.raise, s.call, s.fold) < 0.995;
    });
    default: throw new Error(`unknown preset ${kind}`);
  }
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

// ─────────────────────────── table geometry (viewBox units) ───────────────────────────

// Two geometries: desktop 640×320 (2:1) and phone 640×400 (8:5 — a taller
// felt so the 8 seats spread out and stay legible at ~370px wide).
// chipFont/potFont mirror the SVG font sizes in styles.css. cardsBox is the
// HTML card overlay (centred on the felt) in viewBox units, sized for the
// worst case each layout can reach, and the collision test uses it as the
// keep-out: desktop = 960px window → 534px table with 76×106 cards; phone =
// cards scale with the viewport below 390px (min(64px, 16.4vw), see
// styles.css), which keeps the overlay ≤ 248×164 units for any width ≥ 320.
export const TABLE_GEOMETRY = {
  desktop: {
    vb: [640, 320], cx: 320, cy: 160, rail: [250, 106], felt: [236, 92], rx: 262, ry: 118,
    seatR: 24, chipR: 9, dealerR: 10, potDy: 86, chipFx: 0.62, chipFy: 0.68, chipTx: 13,
    dealerF: 0.84, chipFont: 13, potFont: 14, cardsBox: [194, 127], compact: false,
  },
  phone: {
    vb: [640, 400], cx: 320, cy: 200, rail: [250, 138], felt: [236, 124], rx: 262, ry: 156,
    seatR: 31, chipR: 12, dealerR: 13, potDy: 108, chipFx: 0.74, chipFy: 0.62, chipTx: 16,
    dealerF: 0.82, chipFont: 17, potFont: 19, cardsBox: [248, 164], compact: true,
  },
};

// Where everything sits on the table for a spot: seats on an ellipse rotated
// so hero is at the bottom, the raiser's 2bb chip pulled towards the centre
// with its label on the outer side, the dealer button offset sideways from
// BTN, the pot label under the cards. Pure, so the collision test can sweep
// every hero seat.
export function tableLayout(scenario, hero, g) {
  const seats = seatStates(scenario, hero);
  const heroIdx = seats.findIndex((s) => s.role === "hero");
  const out = {
    seats: [], chip: null, dealer: null,
    pot: { x: g.cx, y: g.cy + g.potDy },
    cards: { x: g.cx - g.cardsBox[0] / 2, y: g.cy - g.cardsBox[1] / 2, w: g.cardsBox[0], h: g.cardsBox[1] },
  };
  seats.forEach((s, i) => {
    const ang = Math.PI / 2 + (i - heroIdx) * (Math.PI / 4);
    const cos = Math.cos(ang), sin = Math.sin(ang);
    out.seats.push({ pos: s.pos, role: s.role, x: g.cx + g.rx * cos, y: g.cy + g.ry * sin, r: g.seatR });
    if (s.role === "raiser") {
      const x = g.cx + g.rx * g.chipFx * cos, y = g.cy + g.ry * g.chipFy * sin;
      // Label on the outer side of the chip. On the phone geometry a seat on
      // the horizontal axis is right there on that side (bigger seats), so
      // drop the label under the chip instead; desktop has room either way.
      let label;
      if (g.compact && Math.abs(cos) > 0.9) label = { dx: 0, dy: g.chipR + g.chipFont, anchor: "middle" };
      else if (cos < -0.3)                  label = { dx: -g.chipTx, dy: 0, anchor: "end" };
      else                                  label = { dx: g.chipTx, dy: 0, anchor: "start" };
      out.chip = { x, y, r: g.chipR, label };
    }
    if (s.pos === "BTN") {
      const a2 = ang + 0.38;   // sideways from the seat so it never sits under a chip or the cards
      out.dealer = { x: g.cx + g.rx * g.dealerF * Math.cos(a2), y: g.cy + g.ry * g.dealerF * Math.sin(a2), r: g.dealerR };
    }
  });
  return out;
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
