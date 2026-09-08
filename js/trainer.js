// Preflop trainer — view layer (DOM). All rules live in trainer-core.js.
//
// Flow: pick scenario + position → a random combo is dealt → tap Fold / Call /
// Raise → verdict (✓✓ best, ✓ acceptable, ✗ never) and the frequency of every
// action shown as a battery bar under its button → Next hand.

import { POSITION_LABEL } from "./ranges.js";
import {
  SCENARIOS, RANDOM_POSITION, SUIT_GLYPH, MARK,
  dealCombo, strategyFor, judge, topActions, nonZeroActions, actionsFor,
  normalizeChoice, pickPosition, potBefore, situationText,
  TABLE_GEOMETRY, tableLayout,
  ALL_HANDS, dealFromHands, normalizeHands, rangeSummary, presetHands,
  emptyStats, addResult, accuracy, formatPct,
} from "./trainer-core.js";
import { rangeGridHTML } from "./range-grid.js";

const LS_PREFS = "poker.trainer.prefs";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  scenario: "RFI",
  positionChoice: "BTN",     // a position key, or RANDOM_POSITION
  position: "BTN",           // resolved position of the current hand
  deal: null,                // { cards: [{rank, suit}, …], hand: "AKs" }
  strategy: null,            // { raise, call, fold }
  answer: null,              // { action, verdict }
  stats: emptyStats(),
  showRange: false,
  // deal range per scenario: null = every hand, else a Set of hand classes
  ranges: { RFI: null, VS_UTG: null },
  showPick: false,
};

let showView = () => {};
let onClose = () => {};

// Phone layout (≤600px): taller felt, bigger seats, action dock pinned to
// the bottom. Must agree with the @media block in styles.css.
const compactMQ = window.matchMedia("(max-width: 600px)");

// ───────────────────────── prefs ─────────────────────────

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(LS_PREFS) || "{}");
    if (Object.hasOwn(SCENARIOS, p.scenario)) state.scenario = p.scenario;
    if (typeof p.positionChoice === "string") state.positionChoice = p.positionChoice;
    if (typeof p.showRange === "boolean") state.showRange = p.showRange;
    if (p.ranges && typeof p.ranges === "object") {
      for (const sc of Object.keys(SCENARIOS)) {
        const v = Object.hasOwn(p.ranges, sc) ? p.ranges[sc] : null;
        const set = Array.isArray(v) ? new Set(normalizeHands(v)) : null;
        state.ranges[sc] = set && set.size < ALL_HANDS.length ? set : null;   // a full set is "no filter"
      }
    }
    // showPick is deliberately not restored: the editor always starts collapsed.
  } catch { /* corrupt prefs: fall back to defaults */ }
  state.positionChoice = normalizeChoice(state.scenario, state.positionChoice);
}

function savePrefs() {
  try {
    localStorage.setItem(LS_PREFS, JSON.stringify({
      scenario: state.scenario,
      positionChoice: state.positionChoice,
      showRange: state.showRange,
      ranges: Object.fromEntries(Object.keys(SCENARIOS).map((sc) => [sc, state.ranges[sc] ? [...state.ranges[sc]] : null])),
    }));
  } catch { /* prefs are a convenience only */ }
}

// ───────────────────────── public API ─────────────────────────

export function setupTrainer(opts = {}) {
  showView = opts.showView || showView;
  onClose = opts.onClose || onClose;
  loadPrefs();

  $("#trainer-close").addEventListener("click", () => onClose());

  $("#trainer-scenario-chips").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn || !SCENARIOS[btn.dataset.scenario]) return;
    state.scenario = btn.dataset.scenario;
    state.positionChoice = normalizeChoice(state.scenario, state.positionChoice);
    savePrefs();
    renderChips();
    deal();
  });

  $("#trainer-position-chips").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    state.positionChoice = normalizeChoice(state.scenario, btn.dataset.pos);
    savePrefs();
    renderChips();
    deal();
  });

  $("#trainer-actions").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn || btn.disabled) return;
    answer(btn.dataset.action);
  });

  $("#trainer-next").addEventListener("click", deal);

  $("#trainer-range-toggle").addEventListener("click", () => {
    state.showRange = !state.showRange;
    savePrefs();
    renderRange();
  });

  $("#trainer-stats-reset").addEventListener("click", () => {
    state.stats = emptyStats();
    renderStats();
  });

  setupPicker();

  document.addEventListener("keydown", onKey);

  // Table geometry and the chip row differ between phone and desktop; redraw when crossing.
  compactMQ.addEventListener("change", () => { if (state.deal) { renderTable(); renderChips(); } });

  // On phones the dock is position:fixed; publish its height so the page
  // can pad its bottom and nothing hides behind the dock.
  const dock = $("#trainer-dock");
  const view = $("#view-trainer");
  if (window.ResizeObserver && dock && view) {
    new ResizeObserver(() => {
      view.style.setProperty("--dock-h", `${Math.ceil(dock.getBoundingClientRect().height)}px`);
    }).observe(dock);
  }
}

export function enterTrainer() {
  showView("view-trainer");
  renderChips(true);
  if (!state.deal) deal();
  else renderAll();
}

// ───────────────────────── hand flow ─────────────────────────

function deal({ keepScroll = false } = {}) {
  state.position = pickPosition(state.scenario, state.positionChoice);
  const hands = activeHands();
  state.deal = hands ? dealFromHands([...hands]) : dealCombo();
  state.strategy = strategyFor(state.scenario, state.position, state.deal.hand);
  state.answer = null;
  renderAll();
  // Phone: "next hand" lives in the bottom dock; if the page was scrolled
  // down (reading the range), bring the new cards back into view — unless
  // the caller is the range editor, where the user is busy further down.
  if (!keepScroll && compactMQ.matches && window.scrollY > 0) window.scrollTo({ top: 0, behavior: "smooth" });
}

function answer(action) {
  if (!state.deal || state.answer) return;
  const act = actionsFor(state.scenario, state.position).find((a) => a.key === action);
  if (!act || act.disabled) return;
  const verdict = judge(state.strategy, action);
  state.answer = { action, verdict };
  state.stats = addResult(state.stats, verdict);
  renderAll();
  $("#trainer-next").focus();
}

// Desktop shortcuts: F / C / R (or 1 / 2 / 3) answer, Space / Enter deals.
const KEY_TO_ACTION = { f: "fold", "1": "fold", c: "call", "2": "call", r: "raise", "3": "raise" };

function onKey(e) {
  if ($("#view-trainer").classList.contains("hidden")) return;
  if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
  const tag = e.target && e.target.tagName;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
  const k = (e.key || "").toLowerCase();
  const isActivate = k === " " || k === "enter";
  // A focused <button> handles Space/Enter natively (→ its click handler);
  // stepping aside here keeps "next hand" from firing twice.
  if (tag === "BUTTON" && isActivate) return;
  if (!state.answer && KEY_TO_ACTION[k]) {
    e.preventDefault();
    answer(KEY_TO_ACTION[k]);
    return;
  }
  if (state.answer && isActivate) {
    e.preventDefault();
    deal();
  }
}

// ───────────────────────── rendering ─────────────────────────

function renderAll() {
  renderSituation();
  renderTable();
  renderCards();
  renderActions();
  renderResult();
  renderStats();
  renderRange();
  renderPick();
  renderBadge();
}

let chipsBuiltFor = null;   // scenario whose position chips are in the DOM

function renderChips(instant = false) {
  $$("#trainer-scenario-chips .chip").forEach((c) => {
    c.classList.toggle("selected", c.dataset.scenario === state.scenario);
  });
  const root = $("#trainer-position-chips");
  if (chipsBuiltFor !== state.scenario) {
    // Rebuild only when the position set changes; otherwise just toggle the
    // selection so a keyboard user does not lose focus on every click.
    const items = SCENARIOS[state.scenario].positions.map((p) => [p, POSITION_LABEL[p]]);
    items.push([RANDOM_POSITION, "随机"]);
    root.innerHTML = items.map(([key, label]) =>
      `<button type="button" class="chip" data-pos="${key}">${label}</button>`
    ).join("");
    chipsBuiltFor = state.scenario;
  }
  $$("#trainer-position-chips .chip").forEach((c) => {
    c.classList.toggle("selected", c.dataset.pos === state.positionChoice);
  });
  // Phone: the row scrolls horizontally — keep the selected chip centred.
  // Measured relative to the row itself (not offsetParent), so it holds
  // whatever the page margins are.
  if (root.scrollWidth > root.clientWidth + 1) {
    const sel = root.querySelector(".chip.selected");
    if (sel) {
      const rowBox = root.getBoundingClientRect(), selBox = sel.getBoundingClientRect();
      const left = root.scrollLeft + (selBox.left - rowBox.left) - (rowBox.width - selBox.width) / 2;
      root.scrollTo({ left: Math.max(0, left), behavior: instant ? "auto" : "smooth" });
    }
  }
}

function renderSituation() {
  $("#trainer-situation").textContent = situationText(state.scenario, state.position);
}

// Table drawn as SVG: 8 seats on an ellipse, rotated so hero sits at the
// bottom (GTO Wizard convention). Folded seats are dimmed, the UTG raiser
// gets a 2bb chip, BTN gets the dealer button.
// Draws whatever tableLayout() (trainer-core.js) computed for this spot; the
// geometry table and the collision test live there.
function renderTable() {
  const g = compactMQ.matches ? TABLE_GEOMETRY.phone : TABLE_GEOMETRY.desktop;
  const L = tableLayout(state.scenario, state.position, g);
  const f = (n) => n.toFixed(1);
  const parts = [
    `<ellipse class="tr-rail" cx="${g.cx}" cy="${g.cy}" rx="${g.rail[0]}" ry="${g.rail[1]}"/>`,
    `<ellipse class="tr-felt" cx="${g.cx}" cy="${g.cy}" rx="${g.felt[0]}" ry="${g.felt[1]}"/>`,
    `<text class="tr-pot" x="${f(L.pot.x)}" y="${f(L.pot.y)}">Pot ${potBefore(state.scenario)}bb</text>`,
  ];
  for (const s of L.seats) {
    const label = POSITION_LABEL[s.pos];
    const small = label.length > 3 ? ' class="small"' : "";
    parts.push(`<g class="tr-seat ${s.role}" transform="translate(${f(s.x)},${f(s.y)})"><circle r="${s.r}"/><text${small}>${label}</text></g>`);
  }
  if (L.chip) {
    const { x, y, r, label } = L.chip;
    parts.push(`<g class="tr-chip" transform="translate(${f(x)},${f(y)})"><circle r="${r}"/><text x="${label.dx}" y="${label.dy}" text-anchor="${label.anchor}">2bb</text></g>`);
  }
  if (L.dealer) {
    parts.push(`<g class="tr-dealer" transform="translate(${f(L.dealer.x)},${f(L.dealer.y)})"><circle r="${L.dealer.r}"/><text>D</text></g>`);
  }
  const svg = $("#trainer-table-svg");
  svg.setAttribute("viewBox", `0 0 ${g.vb[0]} ${g.vb[1]}`);
  svg.classList.toggle("compact", g.compact);
  svg.innerHTML = parts.join("");
}

function renderCards() {
  $("#trainer-cards").innerHTML = state.deal.cards.map((c) =>
    `<div class="tr-card ${c.suit}">
      <span class="rank">${c.rank}</span>
      <span class="suit-sm">${SUIT_GLYPH[c.suit]}</span>
      <span class="suit-big">${SUIT_GLYPH[c.suit]}</span>
    </div>`
  ).join("");
  $("#trainer-hand-label").textContent = state.deal.hand;
}

function renderActions() {
  const acts = actionsFor(state.scenario, state.position);
  const answered = !!state.answer;
  const s = state.strategy;
  const maxF = Math.max(s.raise, s.call, s.fold);
  const root = $("#trainer-actions");
  root.classList.toggle("answered", answered);
  root.innerHTML = acts.map((a) => {
    const f = s[a.key];
    const chosen = answered && state.answer.action === a.key;
    const mark = chosen ? `<span class="tr-mark ${state.answer.verdict}">${MARK[state.answer.verdict]}</span>` : "";
    const isMax = answered && f > 0 && f >= maxF - 1e-9;
    return `<div class="tr-act">
      <button type="button" class="tr-btn ${a.key}${chosen ? " chosen" : ""}" data-action="${a.key}"${a.disabled ? " disabled" : ""}>${a.label}${mark}</button>
      <div class="tr-bar ${a.key}${isMax ? " max" : ""}">
        <div class="fill" data-w="${answered ? (f * 100).toFixed(1) : 0}"></div>
        <div class="pct">${answered ? formatPct(f) : ""}</div>
      </div>
    </div>`;
  }).join("");
  // Force one layout with width 0, then set the real width so the CSS
  // transition plays (battery filling up) instead of snapping.
  void root.offsetWidth;
  $$("#trainer-actions .fill").forEach((el) => { el.style.width = el.dataset.w + "%"; });
}

function renderResult() {
  const el = $("#trainer-result");
  const next = $("#trainer-next");
  if (!state.answer) {
    el.textContent = "";
    el.className = "tr-result";
    next.classList.add("hidden");
    return;
  }
  const { action, verdict } = state.answer;
  const acts = actionsFor(state.scenario, state.position);
  const label = (k) => acts.find((a) => a.key === k).label;
  const s = state.strategy;
  const top = topActions(s).map((k) => `${label(k)} ${formatPct(s[k])}`).join(" / ");
  let text;
  if (verdict === "best") {
    text = `${MARK.best} 最优 · ${label(action)} 是最高频动作(${formatPct(s[action])})`;
  } else if (verdict === "ok") {
    text = `${MARK.ok} 可以,但不是最高频 · ${label(action)} ${formatPct(s[action])} · 最高频:${top}`;
  } else {
    const should = nonZeroActions(s).map((k) => `${label(k)} ${formatPct(s[k])}`).join(" / ");
    text = `${MARK.wrong} 错 · ${label(action)} 频率 0% · 应该:${should}`;
  }
  el.textContent = text;
  el.className = `tr-result ${verdict}`;
  next.classList.remove("hidden");
}

function renderStats() {
  const st = state.stats;
  const cells = [["手数", st.hands], [MARK.best, st.best], [MARK.ok, st.ok], [MARK.wrong, st.wrong]];
  $("#trainer-stats").innerHTML = cells.map(([l, n]) =>
    `<div class="tr-stat"><div class="n">${n}</div><div class="l">${l}</div></div>`
  ).join("");
  const acc = accuracy(st);
  $("#trainer-accuracy").textContent = acc == null
    ? "还没作答"
    : `正确率 ${Math.round(acc * 100)}% · 最优率 ${Math.round((st.best / st.hands) * 100)}%`;
}

// ───────────────────────── deal-range picker ─────────────────────────

function activeHands() {
  return state.ranges[state.scenario];   // null = every hand
}

function setHands(set) {
  state.ranges[state.scenario] = set.size === ALL_HANDS.length ? null : set;
  savePrefs();
  // The hand on the table was dealt under the old range; if it has not been
  // answered yet, swap it for one from the new range so the badge and the
  // cards agree. An answered hand stays until "next" (the user is reading it).
  if (!state.answer) deal({ keepScroll: true });
  else { renderPick(); renderBadge(); }
}

function renderBadge() {
  const badge = $("#trainer-range-badge");
  const hands = activeHands();
  if (!hands) { badge.classList.add("hidden"); return; }
  const s = rangeSummary([...hands]);
  badge.textContent = hands.size ? `🎯 范围 ${s.hands} 手 · ${formatPct(s.pct)}` : "🎯 范围为空 · 发全部";
  badge.classList.remove("hidden");
}

let paint = null;        // { id, on, set, last } while a pointer is painting the grid
let pickRendered = "";   // memo key of the last grid render (skip identical rebuilds)

function renderPick() {
  if (paint) return;     // never rebuild the grid under a finger mid-paint
  const hands = activeHands();
  const s = rangeSummary(hands ? [...hands] : ALL_HANDS);
  $("#trainer-pick-summary").textContent = !hands
    ? "全部 169 手"
    : hands.size ? `已选 ${s.hands} 手 · ${s.combos} 组合 · ${formatPct(s.pct)}` : "未选任何手牌 · 发全部";
  $("#trainer-pick-toggle").textContent = state.showPick ? "收起" : "编辑";
  const box = $("#trainer-pick");
  box.classList.toggle("hidden", !state.showPick);
  if (!state.showPick) { pickRendered = ""; return; }
  const pos = POSITION_LABEL[state.position];
  const key = `${state.scenario}|${state.position}|${hands ? [...hands].join(",") : "all"}`;
  if (key === pickRendered) return;
  pickRendered = key;
  // "playable"/"mixed" are computed for the position on the table right now;
  // say so on the buttons (matters when the position is random).
  $('#trainer-pick-presets [data-preset="playable"]').textContent = `${pos} 可玩手`;
  $('#trainer-pick-presets [data-preset="mixed"]').textContent = `${pos} 混合手`;
  $("#trainer-pick-pos").textContent = `颜色 = ${SCENARIOS[state.scenario].label} · ${pos} 的策略`;
  $("#trainer-pick-grid").innerHTML = rangeGridHTML(state.scenario, state.position, {
    selected: hands || new Set(ALL_HANDS), selectable: true,
  });
}

// Tap toggles a hand; press-and-drag paints the first cell's new state over
// every cell crossed (pointer capture + elementFromPoint so it works for
// mouse and touch alike). One pointer at a time; committed on release — also
// on cancel / lost capture, so what is on screen is what gets saved.
function setupPicker() {
  const grid = $("#trainer-pick-grid");
  const cellAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el && el.closest(".range-cell[data-hand]");
  };
  const applyPaint = (cell) => {
    const h = cell.dataset.hand;
    if (paint.on) paint.set.add(h); else paint.set.delete(h);
    cell.classList.toggle("off", !paint.on);
  };
  // A fast swipe delivers pointermove events several cells apart (and the
  // browser coalesces touch moves), so walk the segment from the previous
  // point in ~8px steps and paint every cell on the way.
  const paintTo = (x, y) => {
    const [x0, y0] = paint.last || [x, y];
    const steps = Math.max(1, Math.ceil(Math.hypot(x - x0, y - y0) / 8));
    for (let i = 1; i <= steps; i++) {
      const cell = cellAt(x0 + (x - x0) * i / steps, y0 + (y - y0) * i / steps);
      if (cell) applyPaint(cell);
    }
    paint.last = [x, y];
  };
  grid.addEventListener("pointerdown", (e) => {
    if (paint || e.button !== 0) return;          // one pointer at a time, primary button only
    const cell = e.target.closest(".range-cell[data-hand]");
    if (!cell) return;
    e.preventDefault();
    try { grid.setPointerCapture(e.pointerId); } catch { /* not all inputs support capture */ }
    const cur = activeHands() || new Set(ALL_HANDS);
    paint = { id: e.pointerId, on: !cur.has(cell.dataset.hand), set: new Set(cur), last: [e.clientX, e.clientY] };
    applyPaint(cell);
  });
  const endPaint = (e) => {
    if (!paint || (e && e.pointerId !== undefined && e.pointerId !== paint.id)) return;
    const set = paint.set;
    paint = null;
    setHands(set);
  };
  grid.addEventListener("pointermove", (e) => {
    if (!paint || e.pointerId !== paint.id) return;
    // the button was released but the up event never reached us (context
    // menu, alt-tab): finish instead of painting on hover
    if (e.pointerType !== "touch" && e.buttons === 0) { endPaint(e); return; }
    const points = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    if (points.length) for (const p of points) paintTo(p.clientX, p.clientY);
    else paintTo(e.clientX, e.clientY);
  });
  grid.addEventListener("pointerup", endPaint);
  grid.addEventListener("pointercancel", endPaint);
  grid.addEventListener("lostpointercapture", endPaint);

  $("#trainer-pick-toggle").addEventListener("click", () => {
    state.showPick = !state.showPick;
    renderPick();
  });
  $("#trainer-pick-presets").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-preset]");
    if (!btn) return;
    const kind = btn.dataset.preset;
    const cur = activeHands() || new Set(ALL_HANDS);
    let next;
    if (kind === "invert") next = new Set(ALL_HANDS.filter((h) => !cur.has(h)));
    else if (kind === "clear") next = new Set();
    else next = new Set(presetHands(kind, state.scenario, state.position));
    setHands(next);
  });
}

function renderRange() {
  $("#trainer-range-toggle").textContent = state.showRange ? "隐藏" : "显示";
  const box = $("#trainer-range");
  box.classList.toggle("hidden", !state.showRange);
  if (!state.showRange) { box.innerHTML = ""; return; }
  if (!state.answer) {
    box.innerHTML = `<div class="tr-range-empty">作答后显示这个位置的范围表</div>`;
    return;
  }
  box.innerHTML = `
    <div class="tr-range-title">${SCENARIOS[state.scenario].label} · ${POSITION_LABEL[state.position]} · 高亮 ${state.deal.hand}</div>
    <div class="range-grid">${rangeGridHTML(state.scenario, state.position, { highlight: state.deal.hand })}</div>
    <div class="range-legend">
      <span><i class="dot dot-r"></i>加注</span>
      <span><i class="dot dot-c"></i>跟注</span>
      <span><i class="dot dot-f"></i>弃牌</span>
    </div>`;
}
