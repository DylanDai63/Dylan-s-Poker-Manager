// Bankroll logic with no DOM: unit conversion, per-session numbers, stats and
// the series the chart draws. Pure functions only, so node can test them:
//     node scripts/test_bankroll_core.mjs

// One fixed colour per venue, by the venue's index in the venues list (stable
// no matter which venues are selected). Brand mint first.
export const VENUE_COLORS = [
  "#aafbb2", "#5ac8fa", "#ffb347", "#c084fc", "#ff6b6b", "#facc15", "#34d399", "#f472b6",
];
export const TOTAL_COLOR = "#fdfdfd";

export function round2(x) { return Math.round(Number(x) * 100) / 100; }

// "" / null / undefined → NaN. (Number("") is 0, which would hide empty inputs.)
export function num(x) {
  if (x === "" || x == null) return NaN;
  return Number(x);
}

export function usdFromBb(bb, bbUsd) {
  const b = num(bb), u = num(bbUsd);
  if (!Number.isFinite(b) || !Number.isFinite(u)) return null;
  return round2(b * u);
}

export function sessionPnl(s) { return round2(num(s.cash_out) - num(s.buy_in)); }

export function sessionPnlBb(s) {
  const bi = num(s.buy_in_bb), co = num(s.cash_out_bb);
  if (!Number.isFinite(bi) || !Number.isFinite(co)) return null;
  return round2(co - bi);
}

export function bbPer100(pnlBb, hands) {
  const h = num(hands);
  if (pnlBb == null || !Number.isFinite(h) || h <= 0) return null;
  return (pnlBb / h) * 100;
}

// Net table time: wall clock minus breaks. Never negative.
export function netPlayMs(s) {
  const gross = new Date(s.ended_at) - new Date(s.started_at);
  const brk = (num(s.break_minutes) || 0) * 60000;
  return Math.max(0, gross - brk);
}

export function sortByStart(sessions) {
  return [...sessions].sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
}

export function venueColor(venues, venueId) {
  const i = venues.findIndex((v) => v.id === venueId);
  return VENUE_COLORS[(i < 0 ? 0 : i) % VENUE_COLORS.length];
}

// ───────────────────────── form → DB row ─────────────────────────

// form: { startedAt, endedAt (Date or parseable), buyIn, cashOut (USD, live),
//         buyInBb, cashOutBb, hands (online), breakMinutes, plannedMinutes, notes }
// Returns { row, errors }. row is only meaningful when errors is empty.
export function buildSessionRow(form, venue, stake) {
  const errors = [];
  const startedAt = form.startedAt instanceof Date ? form.startedAt : new Date(form.startedAt);
  const endedAt = form.endedAt instanceof Date ? form.endedAt : new Date(form.endedAt);
  if (!venue) errors.push("请选场地");
  if (isNaN(startedAt) || isNaN(endedAt)) errors.push("开始 / 结束时间不对");
  else if (endedAt <= startedAt) errors.push("结束时间要晚于开始时间");

  const brk = form.breakMinutes === "" || form.breakMinutes == null ? 0 : num(form.breakMinutes);
  if (!Number.isFinite(brk) || brk < 0) errors.push("休息分钟要是非负数");

  const row = {
    venue_id: venue ? venue.id : null,
    stakes_id: null,
    started_at: isNaN(startedAt) ? null : startedAt.toISOString(),
    ended_at: isNaN(endedAt) ? null : endedAt.toISOString(),
    buy_in: null,
    cash_out: null,
    buy_in_bb: null,
    cash_out_bb: null,
    hands: null,
    planned_duration_minutes: Number.isFinite(num(form.plannedMinutes)) && num(form.plannedMinutes) > 0
      ? Math.round(num(form.plannedMinutes)) : null,
    break_minutes: Number.isFinite(brk) && brk >= 0 ? Math.round(brk) : 0,
    notes: (form.notes || "").trim() || null,
  };

  if (venue && venue.kind === "online") {
    const bi = num(form.buyInBb), co = num(form.cashOutBb);
    if (!stake) errors.push("请选级别");
    if (!Number.isFinite(bi) || !Number.isFinite(co)) errors.push("请填 buy-in / cash-out(bb)");
    else if (bi < 0 || co < 0) errors.push("bb 数不能是负数");
    const hands = form.hands === "" || form.hands == null ? null : num(form.hands);
    if (hands != null && (!Number.isInteger(hands) || hands < 0)) errors.push("手数要是非负整数");
    row.stakes_id = stake ? stake.id : null;
    row.buy_in_bb = Number.isFinite(bi) ? bi : null;
    row.cash_out_bb = Number.isFinite(co) ? co : null;
    row.hands = hands;
    row.buy_in = stake ? usdFromBb(bi, stake.bb_usd) : null;
    row.cash_out = stake ? usdFromBb(co, stake.bb_usd) : null;
  } else {
    const bi = num(form.buyIn), co = num(form.cashOut);
    if (!Number.isFinite(bi) || !Number.isFinite(co)) errors.push("请填 buy-in / cash-out(USD)");
    else if (bi < 0 || co < 0) errors.push("金额不能是负数");
    row.buy_in = Number.isFinite(bi) ? round2(bi) : null;
    row.cash_out = Number.isFinite(co) ? round2(co) : null;
  }
  return { row, errors };
}

// ───────────────────────── chart series ─────────────────────────

// One x step per session of the selected venues (chronological), plus a zero
// anchor at index 0. Every venue line is cumulative P/L and CARRIES its last
// value across other venues' sessions, so each line is defined at every x and
// the "合计" line is a plain sum. `own[i]` marks the x where this venue
// actually played (the view draws a dot there, nothing on carried steps).
export function buildSeries(sessions, venues, selectedIds, { includeTotal = true } = {}) {
  const selected = venues.filter((v) => selectedIds.includes(v.id));
  const selSet = new Set(selected.map((v) => v.id));
  const rows = sortByStart(sessions).filter((s) => selSet.has(s.venue_id));

  const cum = new Map(selected.map((v) => [v.id, 0]));
  const lines = new Map(selected.map((v) => [v.id, { data: [0], own: [false] }]));
  const total = [0];
  for (const s of rows) {
    cum.set(s.venue_id, round2(cum.get(s.venue_id) + sessionPnl(s)));
    let sum = 0;
    for (const v of selected) {
      const c = cum.get(v.id);
      sum += c;
      const line = lines.get(v.id);
      line.data.push(c);
      line.own.push(s.venue_id === v.id);
    }
    total.push(round2(sum));
  }

  const datasets = selected.map((v) => ({
    venueId: v.id,
    label: v.name,
    color: venueColor(venues, v.id),
    data: lines.get(v.id).data,
    own: lines.get(v.id).own,
  }));
  // With one venue the total would overlap it exactly, so it is only added
  // when there is something to sum.
  if (includeTotal && selected.length > 1) {
    datasets.push({ venueId: null, label: "合计", color: TOTAL_COLOR, data: total, own: total.map(() => true) });
  }
  return { labels: ["", ...rows.map((s) => s.started_at)], sessions: rows, datasets };
}

// ───────────────────────── stats ─────────────────────────

export function computeStats(sessions) {
  let total = 0, wins = 0, ms = 0, hands = 0, pnlBb = 0, pnlBbWithHands = 0, onlineCount = 0;
  for (const s of sessions) {
    const p = sessionPnl(s);
    total += p;
    if (p > 0) wins++;
    ms += netPlayMs(s);
    const pb = sessionPnlBb(s);
    if (pb != null) {
      onlineCount++;
      pnlBb += pb;
      // bb/100 only over sessions whose hand count is known: numerator and
      // denominator must cover the same sessions.
      if (num(s.hands) > 0) {
        hands += num(s.hands);
        pnlBbWithHands += pb;
      }
    }
  }
  const n = sessions.length;
  const hours = ms / 3600000;
  return {
    total: round2(total),
    count: n,
    wins,
    winrate: n ? wins / n : null,
    hours,
    hourly: hours > 0 ? total / hours : null,
    online: { count: onlineCount, hands, pnlBb: round2(pnlBb), bbPer100: bbPer100(round2(pnlBbWithHands), hands) },
  };
}

// ───────────────────────── formatting ─────────────────────────

const SIGN = (v) => (v > 0 ? "+" : v < 0 ? "−" : "");

export function fmtUsd(x, { sign = true } = {}) {
  const v = Number(x) || 0;
  return `${sign ? SIGN(v) : v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;
}

export function fmtBb(x) {
  const v = Number(x) || 0;
  const abs = Math.abs(v);
  return `${SIGN(v)}${Number.isInteger(abs) ? abs : abs.toFixed(1)} bb`;
}

export function fmtBb100(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${SIGN(x)}${Math.abs(x).toFixed(1)} bb/100`;
}

export function pnlClass(v) { return v > 0 ? "pos" : v < 0 ? "neg" : "zero"; }
