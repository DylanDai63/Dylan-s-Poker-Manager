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
  } catch { /* corrupt prefs: fall back to defaults */ }
  state.positionChoice = normalizeChoice(state.scenario, state.positionChoice);
}

function savePrefs() {
  try {
    localStorage.setItem(LS_PREFS, JSON.stringify({
      scenario: state.scenario,
      positionChoice: state.positionChoice,
      showRange: state.showRange,
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

function deal() {
  state.position = pickPosition(state.scenario, state.positionChoice);
  state.deal = dealCombo();
  state.strategy = strategyFor(state.scenario, state.position, state.deal.hand);
  state.answer = null;
  renderAll();
  // Phone: "next hand" lives in the bottom dock; if the page was scrolled
  // down (reading the range), bring the new cards back into view.
  if (compactMQ.matches && window.scrollY > 0) window.scrollTo({ top: 0, behavior: "smooth" });
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
