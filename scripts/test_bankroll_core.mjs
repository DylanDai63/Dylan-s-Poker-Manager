// Assertions for the bankroll's pure logic. No deps, no browser:
//     node scripts/test_bankroll_core.mjs
// Exits 1 on any failure and prints every check so the output can be pasted
// as evidence.

import {
  VENUE_COLORS, TOTAL_COLOR, round2, num, usdFromBb, sessionPnl, sessionPnlBb, bbPer100,
  netPlayMs, sortByStart, venueColor, buildSessionRow, buildSeries, computeStats,
  fmtUsd, fmtBb, fmtBb100, pnlClass,
} from "../js/bankroll-core.js";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else      { fail++; console.log(`  FAIL  ${name}${detail ? "  — " + detail : ""}`); }
}
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  check(name, g === w, `got ${g}, want ${w}`);
}
function approx(name, got, want, tol = 1e-9) {
  check(name, got != null && Math.abs(got - want) <= tol, `got ${got}, want ${want} ±${tol}`);
}

const V = [
  { id: "wc", name: "Wind Creek", kind: "live", sort_order: 1 },
  { id: "hg", name: "Home game", kind: "live", sort_order: 2 },
  { id: "on", name: "Online poker", kind: "online", sort_order: 3 },
];
const ST = [
  { id: "z2", code: "z2", bb_usd: 0.02 },
  { id: "nl2", code: "NL2", bb_usd: 0.02 },
  { id: "nl10", code: "NL10", bb_usd: 0.10 },
];

// ───────── numbers ─────────
console.log("num / round2 / conversions");
check("num('') is NaN", Number.isNaN(num("")));
check("num(null) is NaN", Number.isNaN(num(null)));
eq("num('12.5')", num("12.5"), 12.5);
eq("round2", round2(1.005 * 100), 100.5);
eq("usdFromBb 100bb @ 0.02", usdFromBb(100, 0.02), 2);
eq("usdFromBb 137.5bb @ 0.02", usdFromBb("137.5", "0.02"), 2.75);
eq("usdFromBb 250bb @ 0.10", usdFromBb(250, 0.1), 25);
eq("usdFromBb empty → null", usdFromBb("", 0.02), null);
eq("sessionPnl", sessionPnl({ buy_in: "100.00", cash_out: "245.50" }), 145.5);
eq("sessionPnlBb", sessionPnlBb({ buy_in_bb: 100, cash_out_bb: 137.5 }), 37.5);
eq("sessionPnlBb live → null", sessionPnlBb({ buy_in_bb: null, cash_out_bb: null }), null);
approx("bbPer100 +37.5bb / 300 hands", bbPer100(37.5, 300), 12.5);
approx("bbPer100 −20bb / 800 hands", bbPer100(-20, 800), -2.5);
eq("bbPer100 no hands → null", bbPer100(10, 0), null);
eq("bbPer100 null pnl → null", bbPer100(null, 100), null);
eq("netPlayMs 3h − 20min break", netPlayMs({ started_at: "2026-10-01T19:00:00Z", ended_at: "2026-10-01T22:00:00Z", break_minutes: 20 }), 160 * 60000);
eq("netPlayMs never negative", netPlayMs({ started_at: "2026-10-01T19:00:00Z", ended_at: "2026-10-01T19:10:00Z", break_minutes: 30 }), 0);
eq("venueColor by venue index", [venueColor(V, "wc"), venueColor(V, "hg"), venueColor(V, "on")], [VENUE_COLORS[0], VENUE_COLORS[1], VENUE_COLORS[2]]);
eq("venueColor unknown id → first", venueColor(V, "nope"), VENUE_COLORS[0]);

// ───────── buildSessionRow ─────────
console.log("buildSessionRow");
const t0 = new Date("2026-10-18T19:00:00Z"), t1 = new Date("2026-10-18T22:30:00Z");
{
  const { row, errors } = buildSessionRow({ startedAt: t0, endedAt: t1, buyIn: "300", cashOut: "412.25", breakMinutes: "15", notes: "  loose table " }, V[0], null);
  eq("live: no errors", errors, []);
  eq("live: USD rounded", [row.buy_in, row.cash_out], [300, 412.25]);
  eq("live: bb fields null", [row.buy_in_bb, row.cash_out_bb, row.hands, row.stakes_id], [null, null, null, null]);
  eq("live: break + notes", [row.break_minutes, row.notes], [15, "loose table"]);
  eq("live: ISO times", [row.started_at, row.ended_at], [t0.toISOString(), t1.toISOString()]);
  eq("live: planned null when absent", row.planned_duration_minutes, null);
}
{
  const { row, errors } = buildSessionRow({ startedAt: t0, endedAt: t1, buyInBb: "100", cashOutBb: "137.5", hands: "320", plannedMinutes: 180 }, V[2], ST[0]);
  eq("online: no errors", errors, []);
  eq("online: bb kept as entered", [row.buy_in_bb, row.cash_out_bb, row.hands], [100, 137.5, 320]);
  eq("online: USD converted", [row.buy_in, row.cash_out], [2, 2.75]);
  eq("online: stakes id", row.stakes_id, "z2");
  eq("online: planned minutes", row.planned_duration_minutes, 180);
  eq("online: break defaults 0", row.break_minutes, 0);
}
{
  const { errors } = buildSessionRow({ startedAt: t0, endedAt: t1, buyInBb: "100", cashOutBb: "90", hands: "" }, V[2], ST[1]);
  eq("online: hands may be empty", errors, []);
}
{
  const { errors } = buildSessionRow({ startedAt: t1, endedAt: t0, buyIn: "1", cashOut: "2" }, V[0], null);
  check("ended before started → error", errors.some((e) => e.includes("晚于")), JSON.stringify(errors));
}
{
  const { errors } = buildSessionRow({ startedAt: t0, endedAt: t1, buyIn: "", cashOut: "5" }, V[0], null);
  check("empty buy-in → error", errors.some((e) => e.includes("buy-in")), JSON.stringify(errors));
}
{
  const { errors } = buildSessionRow({ startedAt: t0, endedAt: t1, buyInBb: "100", cashOutBb: "120", hands: "12.5" }, V[2], ST[0]);
  check("fractional hands → error", errors.some((e) => e.includes("手数")), JSON.stringify(errors));
}
{
  const { errors } = buildSessionRow({ startedAt: t0, endedAt: t1, buyInBb: "100", cashOutBb: "120" }, V[2], null);
  check("online without stakes → error", errors.some((e) => e.includes("级别")), JSON.stringify(errors));
}
{
  const { errors } = buildSessionRow({ startedAt: t0, endedAt: t1, buyIn: "1", cashOut: "2" }, null, null);
  check("no venue → error", errors.some((e) => e.includes("场地")), JSON.stringify(errors));
}
{
  const { errors } = buildSessionRow({ startedAt: "garbage", endedAt: t1, buyIn: "1", cashOut: "2" }, V[0], null);
  check("unparseable time → error", errors.some((e) => e.includes("时间")), JSON.stringify(errors));
}

// ───────── series ─────────
console.log("buildSeries");
const S = [
  { id: "a", venue_id: "wc", started_at: "2026-10-01T19:00:00Z", ended_at: "2026-10-01T22:00:00Z", buy_in: 300, cash_out: 450, break_minutes: 0 },
  { id: "b", venue_id: "on", started_at: "2026-10-02T19:00:00Z", ended_at: "2026-10-02T20:00:00Z", buy_in: 2, cash_out: 2.75, buy_in_bb: 100, cash_out_bb: 137.5, hands: 300, break_minutes: 0 },
  { id: "c", venue_id: "hg", started_at: "2026-10-03T19:00:00Z", ended_at: "2026-10-03T23:00:00Z", buy_in: 100, cash_out: 40, break_minutes: 30 },
  { id: "d", venue_id: "wc", started_at: "2026-10-04T19:00:00Z", ended_at: "2026-10-04T21:00:00Z", buy_in: 300, cash_out: 220, break_minutes: 0 },
  { id: "e", venue_id: "on", started_at: "2026-10-05T19:00:00Z", ended_at: "2026-10-05T20:30:00Z", buy_in: 2, cash_out: 1.5, buy_in_bb: 100, cash_out_bb: 75, hands: 500, break_minutes: 0 },
];
const shuffled = [S[3], S[0], S[4], S[2], S[1]];
eq("sortByStart", sortByStart(shuffled).map((s) => s.id), ["a", "b", "c", "d", "e"]);
{
  const r = buildSeries(shuffled, V, ["wc", "hg", "on"]);
  eq("all venues: 5 sessions + anchor", r.labels.length, 6);
  eq("all venues: sessions chronological", r.sessions.map((s) => s.id), ["a", "b", "c", "d", "e"]);
  eq("all venues: 3 lines + total", r.datasets.map((d) => d.label), ["Wind Creek", "Home game", "Online poker", "合计"]);
  const wc = r.datasets[0], hg = r.datasets[1], on = r.datasets[2], tot = r.datasets[3];
  eq("wc carries across others", wc.data, [0, 150, 150, 150, 70, 70]);
  eq("wc own flags", wc.own, [false, true, false, false, true, false]);
  eq("hg line", hg.data, [0, 0, 0, -60, -60, -60]);
  eq("online line (USD)", on.data, [0, 0, 0.75, 0.75, 0.75, 0.25]);
  eq("total = sum of lines", tot.data, [0, 150, 150.75, 90.75, 10.75, 10.25]);
  eq("total colour", tot.color, TOTAL_COLOR);
  eq("venue colours stable", [wc.color, hg.color, on.color], [VENUE_COLORS[0], VENUE_COLORS[1], VENUE_COLORS[2]]);
}
{
  const r = buildSeries(S, V, ["on", "hg"]);
  eq("subset: only their sessions", r.sessions.map((s) => s.id), ["b", "c", "e"]);
  eq("subset: lines keep venue order + total", r.datasets.map((d) => d.label), ["Home game", "Online poker", "合计"]);
  eq("subset: online colour unchanged", r.datasets[1].color, VENUE_COLORS[2]);
  eq("subset: total", r.datasets[2].data, [0, 0.75, -59.25, -59.75]);
}
{
  const r = buildSeries(S, V, ["wc"]);
  eq("single venue: no total line", r.datasets.map((d) => d.label), ["Wind Creek"]);
  eq("single venue: data", r.datasets[0].data, [0, 150, 70]);
}
{
  const r = buildSeries(S, V, ["wc", "on"], { includeTotal: false });
  eq("includeTotal=false", r.datasets.map((d) => d.label), ["Wind Creek", "Online poker"]);
}
{
  const r = buildSeries(S, V, []);
  eq("nothing selected: anchor only", [r.labels.length, r.datasets.length, r.sessions.length], [1, 0, 0]);
}

// ───────── stats ─────────
console.log("computeStats");
{
  const st = computeStats(S);
  eq("total", st.total, 10.25);
  eq("count / wins", [st.count, st.wins], [5, 2]);
  approx("winrate", st.winrate, 0.4);
  approx("hours (net of 30 min break)", st.hours, 3 + 1 + 3.5 + 2 + 1.5);
  approx("hourly", st.hourly, 10.25 / 11);
  eq("online count / hands", [st.online.count, st.online.hands], [2, 800]);
  eq("online pnl bb", st.online.pnlBb, 12.5);
  approx("online bb/100", st.online.bbPer100, 12.5 / 800 * 100);
}
{
  // An online session without a hand count must not leak into bb/100
  // (numerator and denominator cover the same sessions); it still counts
  // toward the plain bb total.
  const noHands = { id: "f", venue_id: "on", started_at: "2026-10-06T19:00:00Z", ended_at: "2026-10-06T20:00:00Z", buy_in: 2, cash_out: 3, buy_in_bb: 100, cash_out_bb: 150, hands: null, break_minutes: 0 };
  const st = computeStats([...S, noHands]);
  eq("online count includes no-hands session", st.online.count, 3);
  eq("online pnl bb includes no-hands session", st.online.pnlBb, 62.5);
  eq("hands unchanged", st.online.hands, 800);
  approx("bb/100 excludes no-hands session", st.online.bbPer100, 12.5 / 800 * 100);
}
{
  const onlyNoHands = { id: "g", venue_id: "on", started_at: "2026-10-06T19:00:00Z", ended_at: "2026-10-06T20:00:00Z", buy_in: 2, cash_out: 3, buy_in_bb: 100, cash_out_bb: 150, hands: "", break_minutes: 0 };
  const st = computeStats([onlyNoHands]);
  eq("only no-hands sessions → bb/100 null", [st.online.pnlBb, st.online.hands, st.online.bbPer100], [50, 0, null]);
}
{
  const st = computeStats([]);
  eq("empty stats", [st.total, st.count, st.winrate, st.hourly, st.online.bbPer100], [0, 0, null, null, null]);
}

// ───────── formatting ─────────
console.log("formatting");
eq("fmtUsd +", fmtUsd(12.5), "+$12.50");
eq("fmtUsd −", fmtUsd(-3), "−$3.00");
eq("fmtUsd 0", fmtUsd(0), "$0.00");
eq("fmtUsd no sign", fmtUsd(12.5, { sign: false }), "$12.50");
eq("fmtBb integer", fmtBb(100), "+100 bb");
eq("fmtBb fraction", fmtBb(-37.5), "−37.5 bb");
eq("fmtBb100", fmtBb100(12.5), "+12.5 bb/100");
eq("fmtBb100 null", fmtBb100(null), "—");
eq("pnlClass", [pnlClass(1), pnlClass(-1), pnlClass(0)], ["pos", "neg", "zero"]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
