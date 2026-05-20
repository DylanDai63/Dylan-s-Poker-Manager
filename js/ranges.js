// Approximate preflop ranges for 9-max NLHE cash, 100bb, no ante.
// These are hand-tuned approximations — NOT solver output. Frequencies
// are rough. Easy to replace later by re-typing any chart below.
//
// Encoding:
//   RFI[pos]            → array of hands that open-raise from that position
//   VS_UTG[pos]         → { R, M, C } where:
//                           R = pure 3-bet, M = 50/50 3-bet/call, C = pure call
//                         anything not listed is fold

export const RANKS = ["A","K","Q","J","T","9","8","7","6","5","4","3","2"];

export const POSITIONS_RFI    = ["UTG","UTG1","MP","LJ","HJ","CO","BTN","SB"];
export const POSITIONS_VS_UTG = ["UTG1","MP","LJ","HJ","CO","BTN","SB","BB"];

export const POSITION_LABEL = {
  UTG: "UTG", UTG1: "UTG+1", MP: "MP", LJ: "LJ",
  HJ: "HJ",   CO: "CO",      BTN: "BTN", SB: "SB", BB: "BB",
};

// (row, col) → hand string in standard preflop matrix layout
// Diagonal: pocket pairs. Above diagonal: suited. Below diagonal: offsuit.
export function handAt(row, col) {
  if (row === col) return RANKS[row] + RANKS[row];
  if (row < col)   return RANKS[row] + RANKS[col] + "s";
  return RANKS[col] + RANKS[row] + "o";
}

// ───────────────────────── RFI ─────────────────────────

const _UTG = [
  "AA","KK","QQ","JJ","TT","99","88","77",
  "AKs","AQs","AJs","ATs",
  "KQs","KJs","KTs",
  "QJs","QTs",
  "JTs",
  "T9s",
  "AKo","AQo","AJo",
  "KQo",
];

const _UTG1 = [..._UTG,
  "66",
  "A9s",
  "K9s",
  "Q9s",
  "J9s",
  "T8s",
  "98s",
  "ATo",
  "KJo",
];

const _MP = [..._UTG1,
  "55",
  "A8s","A5s",
  "K8s",
  "Q8s",
  "J8s",
  "T7s",
  "97s",
  "87s",
  "A9o",
  "KTo","QJo",
];

const _LJ = [..._MP,
  "44",
  "A7s","A4s","A3s","A2s",
  "K7s",
  "Q7s",
  "J7s",
  "T6s",
  "96s",
  "86s",
  "76s",
  "A8o",
  "QTo","JTo",
];

const _HJ = [..._LJ,
  "33",
  "A6s",
  "K6s","K5s",
  "Q6s",
  "J6s",
  "95s",
  "85s",
  "75s",
  "65s",
  "54s",
  "A7o","A6o","A5o",
  "K9o",
];

const _CO = [..._HJ,
  "22",
  "K4s","K3s","K2s",
  "Q5s","Q4s",
  "J5s",
  "T5s",
  "94s",
  "84s",
  "74s",
  "64s",
  "53s",
  "43s",
  "A4o","A3o","A2o",
  "K8o","K7o",
  "Q9o","J9o","T9o","98o",
];

const _BTN = [..._CO,
  "Q3s","Q2s",
  "J4s","J3s",
  "T4s","T3s",
  "93s",
  "83s",
  "K6o","K5o","K4o",
  "Q8o","Q7o","Q6o",
  "J8o","J7o",
  "T8o",
  "97o","87o","76o","65o","54o",
];

// SB opens slightly tighter than BTN against blinds, more linear shape
const _SB = [
  "AA","KK","QQ","JJ","TT","99","88","77","66","55","44","33","22",
  "AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s",
  "KQs","KJs","KTs","K9s","K8s","K7s","K6s","K5s","K4s","K3s","K2s",
  "QJs","QTs","Q9s","Q8s","Q7s","Q6s","Q5s","Q4s",
  "JTs","J9s","J8s","J7s","J6s",
  "T9s","T8s","T7s","T6s",
  "98s","97s","96s",
  "87s","86s","85s",
  "76s","75s","74s",
  "65s","64s","54s","53s","43s",
  "AKo","AQo","AJo","ATo","A9o","A8o","A7o","A6o","A5o","A4o","A3o","A2o",
  "KQo","KJo","KTo","K9o","K8o","K7o",
  "QJo","QTo","Q9o","Q8o",
  "JTo","J9o","J8o",
  "T9o","T8o",
  "98o","87o",
];

export const RFI = {
  UTG:  _UTG,
  UTG1: _UTG1,
  MP:   _MP,
  LJ:   _LJ,
  HJ:   _HJ,
  CO:   _CO,
  BTN:  _BTN,
  SB:   _SB,
};

// ───────────────────────── vs UTG open ─────────────────────────

export const VS_UTG = {
  UTG1: {
    R: ["AA","KK","QQ","AKs","AKo"],
    M: ["JJ","AQs"],
    C: ["TT","99","88","77","AQo","AJs","ATs","KQs","JTs"],
  },
  MP: {
    R: ["AA","KK","QQ","AKs","AKo"],
    M: ["JJ","AQs"],
    C: ["TT","99","88","77","66","AQo","AJs","ATs","KQs","KJs","QJs","JTs","T9s"],
  },
  LJ: {
    R: ["AA","KK","QQ","AKs","AKo"],
    M: ["JJ","AQs"],
    C: ["TT","99","88","77","66","55","AQo","AJs","ATs","KQs","KJs","KTs","QJs","QTs","JTs","T9s","98s"],
  },
  HJ: {
    R: ["AA","KK","QQ","AKs","AKo"],
    M: ["JJ","AQs","A5s"],
    C: ["TT","99","88","77","66","55","44","AQo","AJs","ATs","A4s","KQs","KJs","KTs","QJs","QTs","JTs","T9s","98s","87s"],
  },
  CO: {
    R: ["AA","KK","QQ","AKs","AKo"],
    M: ["JJ","TT","AQs","AJs","A5s","A4s"],
    C: ["99","88","77","66","55","44","33","AQo","ATs","A9s","KQs","KJs","KTs","K9s","QJs","QTs","Q9s","JTs","J9s","T9s","T8s","98s","87s","76s","65s","KQo"],
  },
  BTN: {
    R: ["AA","KK","QQ","AKs","AKo"],
    M: ["JJ","TT","AQs","AJs","A5s","A4s","KQs","K9s"],
    C: ["99","88","77","66","55","44","33","22","ATs","A9s","A8s","A7s","A6s","A3s","A2s","KJs","KTs","K8s","QJs","QTs","Q9s","Q8s","JTs","J9s","J8s","T9s","T8s","98s","87s","76s","65s","54s","AQo","AJo","KQo"],
  },
  SB: {
    R: ["AA","KK","QQ","JJ","AKs","AKo","AQs"],
    M: ["TT","AQo"],
    C: ["99","88","77","AJs","ATs","KQs","KJs","QJs","JTs"],
  },
  BB: {
    R: ["AA","KK","QQ","AKs","AKo","A5s","A4s"],
    M: ["JJ","AQs"],
    C: [
      "TT","99","88","77","66","55","44","33","22",
      "AJs","ATs","A9s","A8s","A7s","A6s","A3s","A2s",
      "KQs","KJs","KTs","K9s","K8s",
      "QJs","QTs","Q9s",
      "JTs","J9s",
      "T9s","T8s",
      "98s","97s","87s","86s","76s","65s","54s",
      "AQo","AJo","ATo","KQo","KJo","QJo","JTo",
    ],
  },
};

// ───────────────────────── lookup ─────────────────────────

// returns { r, c } where r+c <= 1, fold = 1 - r - c
export function cellAction(row, col, scenario, position) {
  const hand = handAt(row, col);
  if (scenario === "RFI") {
    const set = RFI[position];
    if (!set) return { r: 0, c: 0 };
    return set.includes(hand) ? { r: 1, c: 0 } : { r: 0, c: 0 };
  }
  if (scenario === "VS_UTG") {
    const chart = VS_UTG[position];
    if (!chart) return { r: 0, c: 0 };
    if (chart.R && chart.R.includes(hand)) return { r: 1, c: 0 };
    if (chart.M && chart.M.includes(hand)) return { r: 0.5, c: 0.5 };
    if (chart.C && chart.C.includes(hand)) return { r: 0, c: 1 };
    return { r: 0, c: 0 };
  }
  return { r: 0, c: 0 };
}
