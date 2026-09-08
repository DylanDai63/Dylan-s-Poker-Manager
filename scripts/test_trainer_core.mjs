// Assertions for the trainer's pure logic. No deps, no browser:
//     node scripts/test_trainer_core.mjs
// Exits 1 on any failure and prints every check so the output can be pasted
// as evidence.

import {
  SUITS, SEAT_ORDER, RANDOM_POSITION, SCENARIOS, ACTION_KEYS,
  cardFromIndex, classify, dealCombo, strategyFor, topActions, nonZeroActions,
  judge, actionsFor, normalizeChoice, pickPosition, potBefore, situationText,
  seatStates, TABLE_GEOMETRY, tableLayout, emptyStats, addResult, accuracy, formatPct,
} from "../js/trainer-core.js";
import { rangeGridHTML } from "../js/range-grid.js";
import { RANKS } from "../js/ranges.js";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else      { fail++; console.log(`  FAIL  ${name}${detail ? "  — " + detail : ""}`); }
}
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  check(name, g === w, `got ${g}, want ${w}`);
}
function approx(name, got, want, tol) {
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want} ±${tol}`);
}

// ───────── classify ─────────
console.log("classify");
eq("AsKs → AKs", classify({ rank: "A", suit: "s" }, { rank: "K", suit: "s" }), "AKs");
eq("KhAs → AKo (order independent)", classify({ rank: "K", suit: "h" }, { rank: "A", suit: "s" }), "AKo");
eq("QdQc → QQ", classify({ rank: "Q", suit: "d" }, { rank: "Q", suit: "c" }), "QQ");
eq("2s7s → 72s", classify({ rank: "2", suit: "s" }, { rank: "7", suit: "s" }), "72s");
eq("cardFromIndex(0) = As", cardFromIndex(0), { rank: "A", suit: "s" });
eq("cardFromIndex(51) = 2c", cardFromIndex(51), { rank: "2", suit: "c" });

// ───────── dealCombo: uniform over 1326 combos ─────────
console.log("dealCombo");
{
  const N = 1326 * 200;
  const counts = new Map();
  let pairs = 0, suited = 0, offsuit = 0, ordered = true;
  const rankIdx = Object.fromEntries(RANKS.map((r, i) => [r, i]));
  for (let i = 0; i < N; i++) {
    const d = dealCombo();
    const [a, b] = d.cards;
    if (rankIdx[a.rank] > rankIdx[b.rank]) ordered = false;
    const key = [a.rank + a.suit, b.rank + b.suit].sort().join("");
    counts.set(key, (counts.get(key) || 0) + 1);
    if (d.hand.length === 2) pairs++;
    else if (d.hand.endsWith("s")) suited++;
    else offsuit++;
    if (classify(a, b) !== d.hand) { ordered = false; }
  }
  eq("all 1326 distinct combos appear", counts.size, 1326);
  const vals = [...counts.values()];
  const min = Math.min(...vals), max = Math.max(...vals);
  check("no combo far from expected 200 (min ≥ 120)", min >= 120, `min ${min}`);
  check("no combo far from expected 200 (max ≤ 290)", max <= 290, `max ${max}`);
  approx("pairs ≈ 78/1326 = 5.88%", pairs / N, 78 / 1326, 0.005);
  approx("suited ≈ 312/1326 = 23.5%", suited / N, 312 / 1326, 0.01);
  approx("offsuit ≈ 936/1326 = 70.6%", offsuit / N, 936 / 1326, 0.01);
  check("cards ordered high rank first & hand matches classify", ordered);
  const bad = [...counts.keys()].filter((k) => k.slice(0, 2) === k.slice(2, 4));
  eq("never deals the same card twice", bad.length, 0);
}
{
  // deterministic rng: a=0 (As), b picks index 0 → bumps to 1 (Ah) ⇒ AA
  const seq = [0, 0];
  const rng = () => seq.shift() ?? 0;
  eq("second card never equals first (index bump)", dealCombo(rng).hand, "AA");
}
{
  // upper edge: a=51 (2c), b draws 50 → stays 50 (2d) ⇒ 22
  const seq = [51 / 52 + 1e-9, 50 / 51 + 1e-9];
  const rng = () => seq.shift() ?? 0;
  eq("index bump upper edge (a=51, b=50) → 22", dealCombo(rng).hand, "22");
}

// ───────── strategyFor (spot checks against ranges.js) ─────────
console.log("strategyFor");
eq("RFI UTG AA = pure open", strategyFor("RFI", "UTG", "AA"), { raise: 1, call: 0, fold: 0 });
eq("RFI UTG 44 = 35.5% open / 64.5% fold", strategyFor("RFI", "UTG", "44"), { raise: 0.355, call: 0, fold: 0.645 });
eq("RFI SB KK = 46.2% raise / 53.8% limp / fold 0 (no float noise)", strategyFor("RFI", "SB", "KK"), { raise: 0.462, call: 0.538, fold: 0 });
eq("RFI SB AA fold exactly 0", strategyFor("RFI", "SB", "AA").fold, 0);
eq("RFI BTN 72o = pure fold (unlisted)", strategyFor("RFI", "BTN", "72o"), { raise: 0, call: 0, fold: 1 });
eq("VS_UTG BB QQ = pure call", strategyFor("VS_UTG", "BB", "QQ"), { raise: 0, call: 1, fold: 0 });
eq("VS_UTG UTG1 AKo = 46.4% 3-bet / 53.6% call", strategyFor("VS_UTG", "UTG1", "AKo"), { raise: 0.464, call: 0.536, fold: 0 });
eq("VS_UTG BB KK over-100 sum clamps fold to 0", strategyFor("VS_UTG", "BB", "KK").fold, 0);
{
  let threw = false;
  try { strategyFor("VS_UTG", "UTG", "AA"); } catch { threw = true; }
  check("VS_UTG/UTG has no chart → throws", threw);
}
{
  // every listed hand in every chart yields a valid distribution
  let bad = 0, n = 0;
  for (const scenario of Object.keys(SCENARIOS)) {
    for (const pos of SCENARIOS[scenario].positions) {
      for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) {
        const hand = r === c ? RANKS[r] + RANKS[r] : r < c ? RANKS[r] + RANKS[c] + "s" : RANKS[c] + RANKS[r] + "o";
        const s = strategyFor(scenario, pos, hand);
        n++;
        const sum = s.raise + s.call + s.fold;
        // The parse scripts snap ≥99.5% to 100 while keeping the other action's
        // remainder (e.g. SB K3s = [0.3%, 100%]), so a few charts sum to ≤100.5%.
        if (s.raise < 0 || s.call < 0 || s.fold < 0 || sum < 0.999 || sum > 1.005) bad++;
      }
    }
  }
  eq(`all ${n} (scenario,position,hand) strategies are valid distributions (sum within 99.9%..100.5%)`, bad, 0);
}
{
  // UI invariant: an action that actionsFor() disables must have 0 frequency
  // for every hand at that position, otherwise the right answer is unclickable.
  let violations = [];
  for (const scenario of Object.keys(SCENARIOS)) {
    for (const pos of SCENARIOS[scenario].positions) {
      const disabled = actionsFor(scenario, pos).filter((a) => a.disabled).map((a) => a.key);
      if (!disabled.length) continue;
      for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) {
        const hand = r === c ? RANKS[r] + RANKS[r] : r < c ? RANKS[r] + RANKS[c] + "s" : RANKS[c] + RANKS[r] + "o";
        const s = strategyFor(scenario, pos, hand);
        for (const k of disabled) if (s[k] > 0) violations.push(`${scenario}/${pos}/${hand}:${k}=${s[k]}`);
      }
    }
  }
  eq("disabled buttons never hide a non-zero action (RFI non-SB call === 0 everywhere)", violations, []);
  const rfiNonSb = SCENARIOS.RFI.positions.filter((p) => p !== "SB");
  eq("RFI non-SB positions are exactly the ones with call disabled", rfiNonSb.filter((p) => !actionsFor("RFI", p)[1].disabled), []);
}

// ───────── judge ─────────
console.log("judge");
const pure = { raise: 1, call: 0, fold: 0 };
eq("pure open: raise = best", judge(pure, "raise"), "best");
eq("pure open: fold = wrong", judge(pure, "fold"), "wrong");
eq("pure open: call = wrong", judge(pure, "call"), "wrong");
const mixed = { raise: 0.355, call: 0, fold: 0.645 };
eq("35.5/64.5: fold = best", judge(mixed, "fold"), "best");
eq("35.5/64.5: raise = ok (right but low-frequency)", judge(mixed, "raise"), "ok");
eq("35.5/64.5: call = wrong", judge(mixed, "call"), "wrong");
const tie = { raise: 0.5, call: 0.5, fold: 0 };
eq("50/50 tie: raise = best", judge(tie, "raise"), "best");
eq("50/50 tie: call = best", judge(tie, "call"), "best");
eq("50/50 tie: fold = wrong", judge(tie, "fold"), "wrong");
eq("0.5% action counts as ok, not wrong", judge({ raise: 0.005, call: 0, fold: 0.995 }, "raise"), "ok");
eq("exactly 0.05% (the threshold) still counts as ok", judge({ raise: 0.0005, call: 0, fold: 0.9995 }, "raise"), "ok");
eq("float-noise 1e-16 counts as wrong", judge({ raise: 1e-16, call: 0, fold: 1 }, "raise"), "wrong");
eq("unknown action = wrong", judge(pure, "shove"), "wrong");
eq("topActions picks the max", topActions(mixed), ["fold"]);
eq("topActions lists every tied max", topActions(tie), ["raise", "call"]);
eq("nonZeroActions lists only taken actions", nonZeroActions(mixed), ["raise", "fold"]);

// ───────── actionsFor ─────────
console.log("actionsFor");
{
  const utg = actionsFor("RFI", "UTG");
  eq("RFI UTG keys in fold/call/raise order", utg.map((a) => a.key), ["fold", "call", "raise"]);
  eq("RFI UTG call disabled", utg[1].disabled, true);
  eq("RFI UTG labels", utg.map((a) => a.label), ["Fold", "Call", "Open"]);
  const sb = actionsFor("RFI", "SB");
  eq("RFI SB call enabled and labelled Limp", [sb[1].disabled, sb[1].label], [false, "Limp"]);
  const bb = actionsFor("VS_UTG", "BB");
  eq("VS_UTG labels Fold/Call/3-Bet", bb.map((a) => a.label), ["Fold", "Call", "3-Bet"]);
  eq("VS_UTG nothing disabled", bb.some((a) => a.disabled), false);
}

// ───────── positions ─────────
console.log("positions");
eq("normalizeChoice keeps valid", normalizeChoice("RFI", "CO"), "CO");
eq("normalizeChoice invalid → last (SB for RFI)", normalizeChoice("RFI", "BB"), "SB");
eq("normalizeChoice invalid → last (BB for VS_UTG)", normalizeChoice("VS_UTG", "UTG"), "BB");
eq("normalizeChoice keeps RANDOM", normalizeChoice("VS_UTG", RANDOM_POSITION), RANDOM_POSITION);
eq("pickPosition fixed", pickPosition("RFI", "HJ"), "HJ");
{
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(pickPosition("VS_UTG", RANDOM_POSITION));
  eq("pickPosition RANDOM covers all 7 VS_UTG positions", [...seen].sort(), [...SCENARIOS.VS_UTG.positions].sort());
  check("pickPosition RANDOM never returns UTG in VS_UTG", !seen.has("UTG"));
}

// ───────── table description ─────────
console.log("table");
eq("pot before RFI = 1.5bb", potBefore("RFI"), 1.5);
eq("pot before VS_UTG = 3.5bb", potBefore("VS_UTG"), 3.5);
eq("SEAT_ORDER is 8-max action order", SEAT_ORDER, ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"]);
eq("RFI hero CO: UTG..HJ folded, BTN/SB/BB pending",
  seatStates("RFI", "CO").map((s) => s.role),
  ["folded", "folded", "folded", "folded", "hero", "pending", "pending", "pending"]);
eq("VS_UTG hero BB: UTG raiser, rest folded",
  seatStates("VS_UTG", "BB").map((s) => s.role),
  ["raiser", "folded", "folded", "folded", "folded", "folded", "folded", "hero"]);
eq("VS_UTG hero UTG1: UTG raiser, rest pending",
  seatStates("VS_UTG", "UTG1").map((s) => s.role),
  ["raiser", "hero", "pending", "pending", "pending", "pending", "pending", "pending"]);
check("situationText RFI mentions position", situationText("RFI", "BTN").includes("BTN"));
check("situationText SB mentions limp", situationText("RFI", "SB").includes("limp"));
check("situationText VS_UTG mentions UTG open", situationText("VS_UTG", "CO").includes("UTG") && situationText("VS_UTG", "CO").includes("CO"));

// ───────── table layout: nothing may overlap, on either geometry, for any hero seat ─────────
console.log("table layout");
{
  // signed clearance helpers (≥ 0 = no overlap), all in viewBox units
  const circleRect = (c, r) => {
    const dx = Math.max(r.x - c.x, 0, c.x - (r.x + r.w));
    const dy = Math.max(r.y - c.y, 0, c.y - (r.y + r.h));
    return Math.hypot(dx, dy) - c.r;
  };
  const circles = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
  const rects = (a, b) => Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), a.y - (b.y + b.h), b.y - (a.y + a.h));
  // text boxes: "2bb" ≈ 1.9em wide, 1em tall (dominant-baseline central);
  // "Pot 3.5bb" ≈ 4.4em wide, baseline-anchored (0.8em above, 0.25em below)
  const chipLabelBox = (chip, font) => {
    const w = font * 1.9, cx = chip.x + chip.label.dx, cy = chip.y + chip.label.dy;
    const x = chip.label.anchor === "start" ? cx : chip.label.anchor === "end" ? cx - w : cx - w / 2;
    return { x, y: cy - font / 2, w, h: font };
  };
  const potBox = (pot, font) => ({ x: pot.x - font * 2.2, y: pot.y - font * 0.8, w: font * 4.4, h: font * 1.05 });

  const bad = [];
  let spots = 0;
  for (const [name, g] of Object.entries(TABLE_GEOMETRY)) {
    for (const scenario of Object.keys(SCENARIOS)) {
      for (const hero of SCENARIOS[scenario].positions) {
        spots++;
        const L = tableLayout(scenario, hero, g);
        const tag = `${name}/${scenario}/${hero}`;
        const pb = potBox(L.pot, g.potFont);
        if (rects(pb, L.cards) < 0) bad.push(`${tag}: pot text overlaps cards`);
        for (const s of L.seats) {
          if (circleRect(s, L.cards) < 0) bad.push(`${tag}: seat ${s.pos} overlaps cards`);
          if (circleRect(s, pb) < 0) bad.push(`${tag}: pot text overlaps seat ${s.pos}`);
        }
        if (scenario === "VS_UTG") {
          check(`${tag}: has a raiser chip`, !!L.chip);
          const lb = chipLabelBox(L.chip, g.chipFont);
          if (circleRect(L.chip, L.cards) < 0) bad.push(`${tag}: chip overlaps cards`);
          if (rects(lb, L.cards) < 0) bad.push(`${tag}: chip label overlaps cards`);
          if (rects(lb, pb) < 0) bad.push(`${tag}: chip label overlaps pot text`);
          for (const s of L.seats) {
            if (circles(s, L.chip) < 0) bad.push(`${tag}: chip overlaps seat ${s.pos}`);
            if (circleRect(s, lb) < 0) bad.push(`${tag}: chip label overlaps seat ${s.pos}`);
          }
        } else if (L.chip) bad.push(`${tag}: RFI must not draw a raiser chip`);
        check(`${tag}: has a dealer button`, !!L.dealer);
        if (circleRect(L.dealer, L.cards) < 0) bad.push(`${tag}: dealer overlaps cards`);
        if (circleRect(L.dealer, pb) < 0) bad.push(`${tag}: dealer overlaps pot text`);
        for (const s of L.seats) if (circles(s, L.dealer) < 0) bad.push(`${tag}: dealer overlaps seat ${s.pos}`);
        if (L.chip) {
          if (circles(L.chip, L.dealer) < 0) bad.push(`${tag}: dealer overlaps chip`);
          if (circleRect(L.dealer, chipLabelBox(L.chip, g.chipFont)) < 0) bad.push(`${tag}: dealer overlaps chip label`);
        }
        // hero sits at the bottom centre, every seat inside the viewBox
        const heroSeat = L.seats.find((s) => s.role === "hero");
        if (Math.abs(heroSeat.x - g.cx) > 0.01 || heroSeat.y <= g.cy) bad.push(`${tag}: hero not at bottom centre`);
        for (const s of L.seats) if (s.x - s.r < 0 || s.x + s.r > g.vb[0] || s.y - s.r < 0 || s.y + s.r > g.vb[1]) bad.push(`${tag}: seat ${s.pos} outside viewBox`);
      }
    }
  }
  eq(`no overlaps across ${spots} spots (2 geometries × 2 scenarios × 7 hero seats)`, bad, []);
  const sbPhone = tableLayout("VS_UTG", "SB", TABLE_GEOMETRY.phone);
  eq("phone VS_UTG hero SB: UTG is straight left → chip label goes under the chip", sbPhone.chip.label.anchor, "middle");
  const bbPhone = tableLayout("VS_UTG", "BB", TABLE_GEOMETRY.phone);
  eq("phone VS_UTG hero BB: UTG bottom-left → chip label on the left", bbPhone.chip.label.anchor, "end");
  const sbDesk = tableLayout("VS_UTG", "SB", TABLE_GEOMETRY.desktop);
  eq("desktop VS_UTG hero SB: label stays beside the chip (desktop layout unchanged)", sbDesk.chip.label.anchor, "end");
  eq("desktop viewBox 640×320, phone 640×400", [TABLE_GEOMETRY.desktop.vb, TABLE_GEOMETRY.phone.vb], [[640, 320], [640, 400]]);
}

// ───────── styles.css: the phone media block must come after every base rule it overrides ─────────
console.log("styles.css source order");
{
  const css = readFileSync(new URL("../css/styles.css", import.meta.url), "utf8");
  const phoneBlock = css.lastIndexOf("@media (max-width: 600px)");
  check("phone media block exists exactly once", css.split("@media (max-width: 600px)").length === 2);
  // base rules (top-level) that the phone block overrides at equal specificity
  const overridden = [".tr-dock {", ".tr-actions {", ".tr-btn {", ".tr-mark {", ".tr-bar {", ".tr-bar .pct {", ".tr-result {", ".tr-stat .n {", ".tr-stat .l {", ".tr-accuracy {", ".tr-side {", ".tr-table {", ".tr-card {", ".tr-situation {"];
  // top-level (unindented) occurrences only — the phone block's own indented copies don't count
  const late = overridden.filter((sel) => css.lastIndexOf("\n" + sel) > phoneBlock);
  check("guard sees the base rules it protects", overridden.every((sel) => css.indexOf("\n" + sel) >= 0));
  eq("every base rule the phone block overrides is defined before it (equal specificity → source order wins)", late, []);
  check("phone block is the last @media block in the file", css.indexOf("@media", phoneBlock + 1) === -1);
  check("no top-level rule follows the phone block", !/\n[a-zA-Z.#][^\n{]*\{/.test(css.slice(phoneBlock)));
}

// ───────── stats ─────────
console.log("stats");
{
  let st = emptyStats();
  eq("accuracy empty = null", accuracy(st), null);
  st = addResult(st, "best"); st = addResult(st, "ok"); st = addResult(st, "wrong"); st = addResult(st, "best");
  eq("counts", st, { hands: 4, best: 2, ok: 1, wrong: 1 });
  eq("accuracy = (best+ok)/hands", accuracy(st), 0.75);
  eq("addResult does not mutate", emptyStats(), { hands: 0, best: 0, ok: 0, wrong: 0 });
}
eq("formatPct 1 → 100%", formatPct(1), "100%");
eq("formatPct 0.355 → 35.5%", formatPct(0.355), "35.5%");
eq("formatPct 0.5 → 50%", formatPct(0.5), "50%");
eq("formatPct 0 → 0%", formatPct(0), "0%");
eq("formatPct 0.9995 → 100%", formatPct(0.9995), "100%");
eq("formatPct 0.003 → 0.3%", formatPct(0.003), "0.3%");

// ───────── range grid ─────────
console.log("rangeGridHTML");
{
  const html = rangeGridHTML("RFI", "UTG");
  eq("169 cells", (html.match(/class="range-cell/g) || []).length, 169);
  eq("no highlight by default", (html.match(/range-cell hl/g) || []).length, 0);
  const hl = rangeGridHTML("RFI", "UTG", { highlight: "AKs" });
  eq("exactly one highlighted cell", (hl.match(/range-cell hl/g) || []).length, 1);
  check("highlighted cell carries the hand label", /range-cell hl"><div class="bars">.*?<span class="label">AKs<\/span>/.test(hl));
  // Golden cells: byte-for-byte what the original inline renderer in app.js
  // produced (same template, same raw cellAction() floats), so the range
  // reference view cannot drift without this failing.
  const cell = (h, html) => html.split("</div><div class=\"range-cell").map((s, i) => (i ? "<div class=\"range-cell" : "") + s + "</div>").find((s) => s.includes(`<span class="label">${h}</span>`));
  eq("golden RFI/UTG AA (pure raise → one bar)", cell("AA", html),
    '<div class="range-cell"><div class="bars"><div class="bar-r" style="flex-grow:1"></div></div><span class="label">AA</span></div>');
  eq("golden RFI/BTN 72o (pure fold → one blue bar)", cell("72o", rangeGridHTML("RFI", "BTN")),
    '<div class="range-cell"><div class="bars"><div class="bar-f" style="flex-grow:1"></div></div><span class="label">72o</span></div>');
  eq("golden RFI/SB K3s (0.3% raise + 100% limp, fold clamped → two bars)", cell("K3s", rangeGridHTML("RFI", "SB")),
    '<div class="range-cell"><div class="bars"><div class="bar-r" style="flex-grow:0.003"></div><div class="bar-c" style="flex-grow:1"></div></div><span class="label">K3s</span></div>');
  eq("golden RFI/UTG 44 (35.5% raise, raw float fold)", cell("44", html),
    `<div class="range-cell"><div class="bars"><div class="bar-r" style="flex-grow:0.355"></div><div class="bar-f" style="flex-grow:${1 - 0.355}"></div></div><span class="label">44</span></div>`);
  eq("no highlight → no hl class anywhere", (rangeGridHTML("VS_UTG", "BB").match(/ hl/g) || []).length, 0);
  eq("suits constant has 4 entries", SUITS.length, 4);
  eq("ACTION_KEYS", ACTION_KEYS, ["raise", "call", "fold"]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
