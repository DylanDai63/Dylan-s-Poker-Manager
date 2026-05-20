// Preflop ranges for 8-max NLHE cash, 100bb effective.
//
// UTG: imported from GTO Wizard 8-max NL50 solver (per-combo "Copy Range"
//      output, parsed by scripts/parse_gto_wizard.py).
// Other positions: hand-tuned approximations pending GTO Wizard import.
//
// Format:
//   Each chart is a map: hand → [raiseFreq, callFreq]    (each 0..1)
//   fold = 1 - raise - call (implicit)
//   Hands not listed = pure fold.

export const RANKS = ["A","K","Q","J","T","9","8","7","6","5","4","3","2"];

export const POSITIONS_RFI    = ["UTG","UTG1","LJ","HJ","CO","BTN","SB"];
export const POSITIONS_VS_UTG = ["UTG1","LJ","HJ","CO","BTN","SB","BB"];

export const POSITION_LABEL = {
  UTG: "UTG", UTG1: "UTG+1", LJ: "LJ", HJ: "HJ",
  CO: "CO",   BTN: "BTN",    SB: "SB", BB: "BB",
};

export function handAt(row, col) {
  if (row === col) return RANKS[row] + RANKS[row];
  if (row < col)   return RANKS[row] + RANKS[col] + "s";
  return RANKS[col] + RANKS[row] + "o";
}

// Helper: builds a chart from 0-100 entries. Single number = raise %.
// [raise, call] = both percents. Anything else defaults to fold.
function build(map) {
  const out = {};
  for (const [hand, val] of Object.entries(map)) {
    if (Array.isArray(val)) out[hand] = [val[0] / 100, val[1] / 100];
    else out[hand] = [val / 100, 0];
  }
  return out;
}

// ─────────────────────────── RFI ───────────────────────────

// UTG — imported from GTO Wizard 8-max NL50, 13.8% RFI, 41 hands
const _UTG = build({
  "AA": 100, "KK": 100, "QQ": 100, "JJ": 100, "TT": 100, "99": 100, "88": 100, "77": 100,
  "66": 100, "55": 100, "44": 35.5,
  "AKs": 100, "AQs": 100, "AJs": 100, "ATs": 100,
  "A9s": 100, "A8s": 100, "A7s": 100, "A6s": 82.6,
  "A5s": 100, "A4s": 100, "A3s": 96.5,
  "KQs": 100, "KJs": 100, "KTs": 100, "K9s": 98.4,
  "QJs": 100, "QTs": 100,
  "JTs": 100, "J9s": 80.2,
  "T9s": 100, "T8s": 11.5,
  "98s": 11.8, "87s": 25.3, "76s": 24.3, "65s": 58.2, "54s": 31.1,
  "AKo": 100, "AQo": 100, "AJo": 34.3,
  "KQo": 69.4,
});

// UTG+1 — ~13%
const _UTG1 = build({
  "AA": 100, "KK": 100, "QQ": 100, "JJ": 100, "TT": 100, "99": 100, "88": 100, "77": 100,
  "66": 100, "55": 75, "44": 25,
  "AKs": 100, "AQs": 100, "AJs": 100, "ATs": 100,
  "A9s": 75, "A8s": 50,
  "A5s": 75, "A4s": 50,
  "KQs": 100, "KJs": 100, "KTs": 100,
  "K9s": 50,
  "QJs": 100, "QTs": 100, "Q9s": 50,
  "JTs": 100, "J9s": 50,
  "T9s": 75, "T8s": 25,
  "98s": 50,
  "AKo": 100, "AQo": 100, "AJo": 100, "ATo": 50,
  "KQo": 100, "KJo": 25,
});

// LJ — ~18% (pending GTO Wizard import)
const _LJ = build({
  "AA": 100, "KK": 100, "QQ": 100, "JJ": 100, "TT": 100, "99": 100, "88": 100, "77": 100,
  "66": 100, "55": 100, "44": 100, "33": 50, "22": 25,
  "AKs": 100, "AQs": 100, "AJs": 100, "ATs": 100,
  "A9s": 100, "A8s": 100, "A7s": 75,
  "A5s": 100, "A4s": 100, "A3s": 50,
  "KQs": 100, "KJs": 100, "KTs": 100,
  "K9s": 100, "K8s": 50,
  "QJs": 100, "QTs": 100, "Q9s": 100, "Q8s": 25,
  "JTs": 100, "J9s": 100, "J8s": 25,
  "T9s": 100, "T8s": 75,
  "98s": 100, "87s": 50, "76s": 25,
  "AKo": 100, "AQo": 100, "AJo": 100, "ATo": 100,
  "KQo": 100, "KJo": 100, "KTo": 50,
  "QJo": 75, "QTo": 25,
});

// HJ — ~21%
const _HJ = build({
  "AA": 100, "KK": 100, "QQ": 100, "JJ": 100, "TT": 100, "99": 100, "88": 100, "77": 100,
  "66": 100, "55": 100, "44": 100, "33": 75, "22": 50,
  "AKs": 100, "AQs": 100, "AJs": 100, "ATs": 100,
  "A9s": 100, "A8s": 100, "A7s": 100,
  "A5s": 100, "A4s": 100, "A3s": 75, "A2s": 50,
  "KQs": 100, "KJs": 100, "KTs": 100, "K9s": 100, "K8s": 75,
  "QJs": 100, "QTs": 100, "Q9s": 100, "Q8s": 75,
  "JTs": 100, "J9s": 100, "J8s": 50,
  "T9s": 100, "T8s": 100,
  "98s": 100, "87s": 75, "76s": 50, "65s": 25,
  "AKo": 100, "AQo": 100, "AJo": 100, "ATo": 100, "A9o": 50,
  "KQo": 100, "KJo": 100, "KTo": 75,
  "QJo": 100, "QTo": 50,
  "JTo": 50,
});

// CO — ~27%
const _CO = build({
  "AA": 100, "KK": 100, "QQ": 100, "JJ": 100, "TT": 100, "99": 100, "88": 100, "77": 100,
  "66": 100, "55": 100, "44": 100, "33": 100, "22": 75,
  "AKs": 100, "AQs": 100, "AJs": 100, "ATs": 100,
  "A9s": 100, "A8s": 100, "A7s": 100, "A6s": 100, "A5s": 100, "A4s": 100, "A3s": 100, "A2s": 75,
  "KQs": 100, "KJs": 100, "KTs": 100, "K9s": 100, "K8s": 100, "K7s": 50,
  "QJs": 100, "QTs": 100, "Q9s": 100, "Q8s": 100,
  "JTs": 100, "J9s": 100, "J8s": 75,
  "T9s": 100, "T8s": 100,
  "98s": 100, "87s": 100, "86s": 50, "76s": 75, "65s": 75, "54s": 50,
  "AKo": 100, "AQo": 100, "AJo": 100, "ATo": 100, "A9o": 100, "A8o": 50,
  "KQo": 100, "KJo": 100, "KTo": 100, "K9o": 50,
  "QJo": 100, "QTo": 75,
  "JTo": 75,
});

// BTN — ~45% (6-max BTN as-is)
const _BTN = build({
  "AA": 100, "KK": 100, "QQ": 100, "JJ": 100, "TT": 100, "99": 100, "88": 100, "77": 100,
  "66": 100, "55": 100, "44": 100, "33": 100, "22": 100,
  "AKs": 100, "AQs": 100, "AJs": 100, "ATs": 100,
  "A9s": 100, "A8s": 100, "A7s": 100, "A6s": 100, "A5s": 100, "A4s": 100, "A3s": 100, "A2s": 100,
  "KQs": 100, "KJs": 100, "KTs": 100, "K9s": 100, "K8s": 100, "K7s": 100, "K6s": 100, "K5s": 100,
  "K4s": 75, "K3s": 75, "K2s": 50,
  "QJs": 100, "QTs": 100, "Q9s": 100, "Q8s": 100, "Q7s": 75, "Q6s": 75, "Q5s": 50, "Q4s": 50,
  "JTs": 100, "J9s": 100, "J8s": 100, "J7s": 75, "J6s": 50,
  "T9s": 100, "T8s": 100, "T7s": 75,
  "98s": 100, "97s": 100, "96s": 75,
  "87s": 100, "86s": 100, "85s": 50,
  "76s": 100, "75s": 100, "74s": 50,
  "65s": 100, "64s": 75, "54s": 100, "53s": 75, "43s": 75, "32s": 50,
  "AKo": 100, "AQo": 100, "AJo": 100, "ATo": 100, "A9o": 100, "A8o": 100, "A7o": 100, "A6o": 100,
  "A5o": 100, "A4o": 100, "A3o": 75, "A2o": 75,
  "KQo": 100, "KJo": 100, "KTo": 100, "K9o": 100, "K8o": 75, "K7o": 50,
  "QJo": 100, "QTo": 100, "Q9o": 100, "Q8o": 50,
  "JTo": 100, "J9o": 100, "J8o": 50,
  "T9o": 100, "T8o": 75,
  "98o": 100, "97o": 50, "87o": 100, "76o": 75, "65o": 50,
});

// SB — ~38% (6-max SB lightly trimmed)
const _SB = build({
  "AA": 100, "KK": 100, "QQ": 100, "JJ": 100, "TT": 100, "99": 100, "88": 100, "77": 100,
  "66": 100, "55": 100, "44": 100, "33": 100, "22": 100,
  "AKs": 100, "AQs": 100, "AJs": 100, "ATs": 100,
  "A9s": 100, "A8s": 100, "A7s": 100, "A6s": 100, "A5s": 100, "A4s": 100, "A3s": 100, "A2s": 100,
  "KQs": 100, "KJs": 100, "KTs": 100, "K9s": 100, "K8s": 100, "K7s": 100, "K6s": 100, "K5s": 75,
  "K4s": 75, "K3s": 50, "K2s": 50,
  "QJs": 100, "QTs": 100, "Q9s": 100, "Q8s": 100, "Q7s": 75, "Q6s": 50, "Q5s": 25,
  "JTs": 100, "J9s": 100, "J8s": 100, "J7s": 50, "J6s": 25,
  "T9s": 100, "T8s": 100, "T7s": 75,
  "98s": 100, "97s": 75,
  "87s": 100, "86s": 50,
  "76s": 100, "75s": 75, "65s": 100, "54s": 100, "43s": 50,
  "AKo": 100, "AQo": 100, "AJo": 100, "ATo": 100, "A9o": 100, "A8o": 100, "A7o": 75,
  "A6o": 75, "A5o": 75, "A4o": 50, "A3o": 50, "A2o": 50,
  "KQo": 100, "KJo": 100, "KTo": 100, "K9o": 75, "K8o": 50,
  "QJo": 100, "QTo": 75, "Q9o": 50,
  "JTo": 100, "J9o": 50,
  "T9o": 75,
  "98o": 50,
});

export const RFI = {
  UTG: _UTG, UTG1: _UTG1, LJ: _LJ,
  HJ: _HJ,   CO: _CO,    BTN: _BTN, SB: _SB,
};

// ─────────────────────────── vs UTG open ───────────────────────────
// UTG opens ~10.5% (tight). In live $1/$2 against typical UTG openers
// (tight regs, "old men"), 3-bet bluffs underperform — they don't fold
// enough postflop and 4-bet too rarely. So defenses are VALUE-HEAVY:
// 3-bet pure for AA/KK/QQ/AKs/AKo, occasional mix on JJ/AQs/AKo from
// some positions, and calls with implied-odds hands (pairs, suited
// broadway, suited connectors in late position / BB).

const _UTG1_VS_UTG = build({
  "AA": [100, 0], "KK": [100, 0], "QQ": [100, 0],
  "JJ": [50, 50],
  "TT": [0, 100], "99": [0, 100], "88": [0, 100], "77": [0, 100], "66": [0, 50],
  "AKs": [100, 0], "AQs": [0, 100], "AJs": [0, 100], "ATs": [0, 75],
  "KQs": [0, 100], "KJs": [0, 50],
  "QJs": [0, 75], "JTs": [0, 75],
  "AKo": [100, 0], "AQo": [0, 75],
});

const _LJ_VS_UTG = build({
  "AA": [100, 0], "KK": [100, 0], "QQ": [100, 0],
  "JJ": [50, 50], "TT": [0, 100], "99": [0, 100], "88": [0, 100], "77": [0, 100], "66": [0, 100], "55": [0, 75],
  "AKs": [100, 0], "AQs": [25, 75], "AJs": [0, 100], "ATs": [0, 100],
  "KQs": [0, 100], "KJs": [0, 100], "KTs": [0, 75],
  "QJs": [0, 100], "QTs": [0, 75],
  "JTs": [0, 100], "T9s": [0, 75], "98s": [0, 50],
  "AKo": [100, 0], "AQo": [25, 75], "AJo": [0, 75], "KQo": [0, 50],
});

const _HJ_VS_UTG = build({
  "AA": [100, 0], "KK": [100, 0], "QQ": [100, 0],
  "JJ": [50, 50], "TT": [25, 75], "99": [0, 100], "88": [0, 100], "77": [0, 100], "66": [0, 100], "55": [0, 100], "44": [0, 75],
  "AKs": [100, 0], "AQs": [25, 75], "AJs": [0, 100], "ATs": [0, 100], "A9s": [0, 75],
  "A5s": [25, 0],
  "KQs": [0, 100], "KJs": [0, 100], "KTs": [0, 100], "K9s": [0, 50],
  "QJs": [0, 100], "QTs": [0, 100], "JTs": [0, 100], "T9s": [0, 100], "98s": [0, 75], "87s": [0, 50],
  "AKo": [100, 0], "AQo": [25, 75], "AJo": [0, 100], "KQo": [0, 75],
});

const _CO_VS_UTG = build({
  "AA": [100, 0], "KK": [100, 0], "QQ": [100, 0],
  "JJ": [50, 50], "TT": [25, 75], "99": [0, 100], "88": [0, 100], "77": [0, 100], "66": [0, 100], "55": [0, 100], "44": [0, 100], "33": [0, 75], "22": [0, 50],
  "AKs": [100, 0], "AQs": [50, 50], "AJs": [0, 100], "ATs": [0, 100], "A9s": [0, 100],
  "A5s": [25, 50], "A4s": [25, 50],
  "KQs": [25, 75], "KJs": [0, 100], "KTs": [0, 100], "K9s": [0, 75],
  "QJs": [0, 100], "QTs": [0, 100], "Q9s": [0, 75],
  "JTs": [0, 100], "J9s": [0, 100],
  "T9s": [0, 100], "T8s": [0, 75],
  "98s": [0, 100], "87s": [0, 100], "76s": [0, 75], "65s": [0, 50],
  "AKo": [100, 0], "AQo": [50, 50], "AJo": [0, 100], "ATo": [0, 75],
  "KQo": [25, 75], "KJo": [0, 75],
});

// BTN vs UTG — IP, can call wide for implied odds. 3-bet is VALUE only
// (AA-QQ, AKs/AKo) plus tiny suited-Ace blocker mixes. NO bluff 3-bets
// with KJs/KTs/QJs/JTs etc — these are pure calls in live cash.
const _BTN_VS_UTG = build({
  "AA": [100, 0], "KK": [100, 0], "QQ": [100, 0],
  "JJ": [25, 75], "TT": [0, 100], "99": [0, 100], "88": [0, 100], "77": [0, 100], "66": [0, 100], "55": [0, 100], "44": [0, 100], "33": [0, 100], "22": [0, 100],
  "AKs": [100, 0], "AQs": [25, 75], "AJs": [0, 100], "ATs": [0, 100], "A9s": [0, 100], "A8s": [0, 100], "A7s": [0, 100], "A6s": [0, 75],
  "A5s": [25, 75], "A4s": [25, 75], "A3s": [0, 75], "A2s": [0, 50],
  "KQs": [0, 100], "KJs": [0, 100], "KTs": [0, 100], "K9s": [0, 100], "K8s": [0, 75], "K7s": [0, 25],
  "QJs": [0, 100], "QTs": [0, 100], "Q9s": [0, 100], "Q8s": [0, 75],
  "JTs": [0, 100], "J9s": [0, 100], "J8s": [0, 75],
  "T9s": [0, 100], "T8s": [0, 100], "T7s": [0, 25],
  "98s": [0, 100], "97s": [0, 50],
  "87s": [0, 100], "86s": [0, 50],
  "76s": [0, 100], "65s": [0, 100], "54s": [0, 75], "43s": [0, 25],
  "AKo": [100, 0], "AQo": [25, 75], "AJo": [0, 100], "ATo": [0, 75],
  "KQo": [0, 100], "KJo": [0, 75], "KTo": [0, 25],
  "QJo": [0, 50],
});

// SB OOP vs UTG — pure 3-bet or fold (no flat from SB OOP, multiway is
// a disaster here). Value-heavy; small Ax blocker mixes for balance.
const _SB_VS_UTG = build({
  "AA": [100, 0], "KK": [100, 0], "QQ": [100, 0], "JJ": [100, 0],
  "TT": [50, 0], "99": [25, 0],
  "AKs": [100, 0], "AQs": [75, 0], "AJs": [25, 0],
  "A5s": [25, 0], "A4s": [25, 0],
  "KQs": [25, 0],
  "AKo": [100, 0], "AQo": [25, 0],
});

// BB w/ blind discount vs UTG — wide flat, polarized 3-bets only with
// premiums + small suited-Ace blockers. No light 3-bets with KQs/KJs/
// QJs/JTs — those are pure calls (postflop OOP, but the discount and
// BTW IP-postflop-ish situations make calling clearly +EV).
const _BB_VS_UTG = build({
  "AA": [100, 0], "KK": [100, 0], "QQ": [100, 0],
  "JJ": [25, 75], "TT": [0, 100], "99": [0, 100], "88": [0, 100], "77": [0, 100], "66": [0, 100], "55": [0, 100], "44": [0, 100], "33": [0, 100], "22": [0, 100],
  "AKs": [100, 0], "AQs": [25, 75], "AJs": [0, 100], "ATs": [0, 100], "A9s": [0, 100], "A8s": [0, 100], "A7s": [0, 100], "A6s": [0, 75],
  "A5s": [25, 75], "A4s": [25, 75], "A3s": [0, 75], "A2s": [0, 75],
  "KQs": [0, 100], "KJs": [0, 100], "KTs": [0, 100], "K9s": [0, 100], "K8s": [0, 75], "K7s": [0, 50], "K6s": [0, 25],
  "QJs": [0, 100], "QTs": [0, 100], "Q9s": [0, 75], "Q8s": [0, 50],
  "JTs": [0, 100], "J9s": [0, 100], "J8s": [0, 75],
  "T9s": [0, 100], "T8s": [0, 75], "T7s": [0, 25],
  "98s": [0, 100], "97s": [0, 75],
  "87s": [0, 100], "86s": [0, 50], "76s": [0, 100], "75s": [0, 50],
  "65s": [0, 100], "54s": [0, 75], "43s": [0, 25],
  "AKo": [75, 25], "AQo": [0, 100], "AJo": [0, 100], "ATo": [0, 100], "A9o": [0, 50],
  "KQo": [0, 100], "KJo": [0, 100], "KTo": [0, 75],
  "QJo": [0, 100], "QTo": [0, 50],
  "JTo": [0, 75],
});

export const VS_UTG = {
  UTG1: _UTG1_VS_UTG,
  LJ:   _LJ_VS_UTG,
  HJ:   _HJ_VS_UTG,
  CO:   _CO_VS_UTG,
  BTN:  _BTN_VS_UTG,
  SB:   _SB_VS_UTG,
  BB:   _BB_VS_UTG,
};

// ─────────────────────────── lookup ───────────────────────────

export function cellAction(row, col, scenario, position) {
  const hand = handAt(row, col);
  const chart = scenario === "RFI" ? RFI[position] : VS_UTG[position];
  if (!chart) return { r: 0, c: 0 };
  const v = chart[hand];
  if (!v) return { r: 0, c: 0 };
  return { r: v[0], c: v[1] };
}
