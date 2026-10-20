import { db, MOCK } from "./db.js";
import {
  sessionPnl, sessionPnlBb, bbPer100, netPlayMs, buildSessionRow, buildSeries, computeStats,
  venueColor, fmtUsd, fmtBb, fmtBb100, pnlClass, num,
} from "./bankroll-core.js";
import { renderBankrollChart } from "./bankroll-chart.js";
import { POSITIONS_RFI, POSITIONS_VS_UTG, POSITION_LABEL } from "./ranges.js";
import { rangeGridHTML } from "./range-grid.js";
import { setupTrainer, enterTrainer } from "./trainer.js";

// ───────────────────────── state ─────────────────────────

const LS_KEY = "poker.activeSession";        // {startedAt, plannedMinutes, alarmStopped, limpCount, totalBreakMs, breakStartedAt}
const LS_DURATION = "poker.lastDurationMins";
const LS_LAST_VENUE = "poker.lastVenueId";
const LS_LAST_STAKES = "poker.lastStakesId";
const LS_CHART_VENUES = "poker.chart.venues"; // JSON array of venue ids; absent = all
const LS_CHART_TOTAL = "poker.chart.total";   // "0" hides the 合计 line

let countdownRAF = null;
let alarmInterval = null;
let vibInterval = null;
let audioCtx = null;

let venues = [];                               // from db, sorted
let stakes = [];
let sessions = [];                             // ASC by started_at
let prevView = "view-home";                    // where to return after closing ranges / trainer
let rangeScenario = "RFI";
let rangePosition = "BTN";

// ───────────────────────── DOM helpers ─────────────────────────

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function showView(id) {
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $(`#${id}`).classList.remove("hidden");
  window.scrollTo(0, 0);   // every view opens at its top
  if (id === "view-home") updateActiveBanner();
}

function currentView() {
  const v = $$(".view").find((el) => !el.classList.contains("hidden"));
  return v ? v.id : "view-home";
}

function updateActiveBanner() {
  const banner = $("#active-banner");
  if (!banner) return;
  const s = loadActive();
  if (!s) {
    banner.classList.add("hidden");
    return;
  }
  banner.classList.remove("hidden");
  const remaining = remainingMs(s);
  const timeEl = $("#active-banner-time");
  if (remaining > 0) {
    timeEl.textContent = `剩 ${formatHMS(remaining)}`;
    banner.classList.remove("expired");
  } else {
    timeEl.textContent = `超时 ${formatHMS(-remaining)}`;
    banner.classList.add("expired");
  }
}

let toastTimer = null;
function toast(msg, kind = "") {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.className = "toast " + kind;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3000);
}

function showFatalError(msg) {
  const el = $("#error-banner");
  if (!el) return;
  el.classList.remove("hidden");
  el.textContent = "⚠ " + msg;
}

// Disable a button while an async action runs; returns a restore function.
function busy(btn, label) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  return () => { btn.disabled = false; btn.textContent = old; };
}

// ───────────────────────── timer state (localStorage) ─────────────────────────

function loadActive() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveActive(s) {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}
function clearActive() {
  localStorage.removeItem(LS_KEY);
}

// ───────────────────────── motivational content ─────────────────────────

const LIMP_WARNINGS = [
  "你不是来交学费的。limp 一次少一点本金。",
  "想清楚你的目标 —— 是娱乐还是赚钱？",
  "鱼塘的鱼最爱 limp。你确定你不是？",
  "每个 limp 都在喂养未来的盈利者。不是你。",
  "没纪律的好手 = 永远的输家。",
  "你的对手感谢你今天的捐款。",
  "raise 或 fold。三个字母都比 limp 强。",
  "limp 是弱者的语言。停。",
  "你以为是省钱，其实是慢性失血。",
  "聪明的鱼会 raise。傻的鱼会 limp。",
  "FOLD 是力量。LIMP 是软弱。RAISE 是答案。",
  "你的钱包不会撒谎。",
  "继续这样，打到 70 岁你也还是输家。",
  "决策好坏看 EV。你刚做了一个差决策。",
  "如果没理由 limp，那就是没纪律。",
  "Limp 一次 ≈ 输 0.3 BB 的期望。算算今晚捐了多少。",
  "你的 limp 让 BB 变得便宜。BB 谢谢你。",
  "对自己狠一点。不该打的牌就别打。",
  "扑克奖励耐心，惩罚冲动。你刚被惩罚了。",
  "纪律 = 钱。没纪律 = 没钱。",
];

const DAILY_MOTTOS = [
  "Tight is right.",
  "Position is power.",
  "打你的 A 游戏，不是 B 游戏。",
  "决策好坏看 EV，不看结果。",
  "扑克是用残缺信息做决策的艺术。",
  "每一手都是独立的决策。",
  "懂得弃牌的人才能久赢。",
  "在牌桌上，最大的对手是你自己。",
  "无聊不是 fold 的理由。",
  "短期看运气，长期看技能。坚持长期。",
  "Don't chase. Don't tilt. Don't limp.",
  "如果你是桌上第 4 好的玩家，你就是输家。",
  "懂得离开桌子是赢家的特征。",
  "扑克的本质：把钱从坏玩家搬到好玩家。",
  "自律 > 智商 > 运气。",
  "今天打不好就关电脑。明天再来。",
  "扑克不是为了让你 happy，是为了让你赚钱。",
  "Live $1/$2：value bet 多一点，bluff 少一点。",
  "读对手比读牌重要。",
  "打人不打牌。",
  "fold 是最常对的动作。",
  "你的范围在打牌，不是你的具体两张牌。",
  "翻前打错，翻后再聪明也救不回来。",
  "想 3-bet 之前问：value 还是 bluff？两个都不是就 fold。",
  "BB 位置最差。别打太宽。",
  "BTN 位置最好。别打太紧。",
  "set-mining 需要 implied odds。深筹码才划算。",
  "每个 limp 都是给鱼的礼物。",
  "FOLD. RAISE. 这两个。从不 LIMP。",
  "扑克 = 100% 技能 + 100% 运气 = 200%。",
];

function getDailyMotto() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - start) / 86400000);
  return DAILY_MOTTOS[dayOfYear % DAILY_MOTTOS.length];
}

function pickLimpWarning(count) {
  const idx = Math.max(0, Math.floor(count / 3) - 1) % LIMP_WARNINGS.length;
  return LIMP_WARNINGS[idx];
}

const BREAK_MOTTOS = [
  "起来走走，活动一下，喝口水。",
  "深呼吸。重置情绪。回来是新的开始。",
  "休息是为了走更远 —— 但别忘了回来。",
  "tilt 了？这个休息来得正好。冷静再回去。",
  "喝水，别喝酒。清醒的大脑才赢钱。",
  "复盘一下：刚才有没有打丢的 spot？",
  "累了就多歇会儿。疲劳是 EV 杀手。",
  "输了别急着回去翻本，那是 tilt。",
  "赢了别飘，回去还是打你的 A game。",
  "看看窗外，让眼睛和脑子都歇歇。",
  "记住今天的目标：是赚钱，不是刺激。",
  "回去之前问自己：我还能保持纪律吗？",
  "好的休息让你下一小时更清醒。",
  "把上一手的好坏都放下，回去重新开始。",
];

function pickBreakMotto() {
  return BREAK_MOTTOS[Math.floor(Math.random() * BREAK_MOTTOS.length)];
}

// ───────────────────────── formatting ─────────────────────────

function pad(n) { return String(n).padStart(2, "0"); }

function formatHMS(ms) {
  const abs = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatHM(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDuration(ms) {
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h${pad(m)}m`;
}

function formatDate(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatDateTime(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${formatHM(d)}`;
}

function toDatetimeLocal(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "?";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

// ───────────────────────── audio (Web Audio API) ─────────────────────────

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function beep() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.setValueAtTime(660, now + 0.15);
  osc.connect(gain).connect(audioCtx.destination);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.25, now + 0.02);
  gain.gain.linearRampToValueAtTime(0, now + 0.45);
  osc.start(now);
  osc.stop(now + 0.5);
}

function startAlarm() {
  ensureAudio();
  beep();
  if (alarmInterval) clearInterval(alarmInterval);
  alarmInterval = setInterval(beep, 700);
  if (navigator.vibrate) {
    navigator.vibrate([400, 150, 400, 150, 600, 200, 400]);
    // re-vibrate every few seconds (one interval, even if the alarm is re-entered)
    if (vibInterval) clearInterval(vibInterval);
    vibInterval = setInterval(() => navigator.vibrate([400, 150, 400]), 3000);
  }
}

function stopAlarm() {
  if (alarmInterval) {
    clearInterval(alarmInterval);
    alarmInterval = null;
  }
  if (vibInterval) {
    clearInterval(vibInterval);
    vibInterval = null;
  }
  if (navigator.vibrate) navigator.vibrate(0);
}

// ───────────────────────── data ─────────────────────────

const venueById = (id) => venues.find((v) => v.id === id) || null;
const stakesById = (id) => stakes.find((s) => s.id === id) || null;

async function loadAll() {
  try {
    [venues, stakes, sessions] = await Promise.all([db.listVenues(), db.listStakes(), db.listSessions()]);
  } catch (err) {
    console.error(err);
    $("#recent-list").innerHTML = `<div class="recent-empty">加载失败：${esc(err.message || err)}</div>`;
    toast("加载失败：" + (err.message || err), "err");
    return;
  }
  renderHome();
  openDeepLink();
}

// index.html#bankroll / #settings / #add open that view once the data is in
// (desktop bookmarks and layout checks). Never on top of a running timer.
function openDeepLink() {
  const target = { "#bankroll": enterBankroll, "#settings": enterSettings, "#add": () => enterSessionForm({ mode: "add" }) }[location.hash];
  if (!target || loadActive()) return;
  history.replaceState(null, "", location.pathname + location.search);
  target();
}

async function reloadSessions() {
  sessions = await db.listSessions();
  renderHome();
  if (currentView() === "view-bankroll") renderBankroll();
}

// ───────────────────────── shared renderers ─────────────────────────

function kpiHTML(label, value, cls = "") {
  return `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value ${cls}">${value}</div></div>`;
}

function renderKpis(root, st, { full = false } = {}) {
  const items = [
    kpiHTML("总盈亏", fmtUsd(st.total), pnlClass(st.total)),
    kpiHTML("Sessions", st.count),
    kpiHTML("$/h", st.hourly == null ? "—" : fmtUsd(st.hourly), st.hourly == null ? "" : pnlClass(st.hourly)),
    kpiHTML("线上 bb/100", fmtBb100(st.online.bbPer100), st.online.bbPer100 == null ? "" : pnlClass(st.online.bbPer100)),
  ];
  if (full) {
    items.push(
      kpiHTML("胜率", st.winrate == null ? "—" : `${Math.round(st.winrate * 100)}%`),
      kpiHTML("总时长", `${st.hours.toFixed(1)} h`),
      kpiHTML("线上手数", st.online.hands ? st.online.hands.toLocaleString() : "—"),
      kpiHTML("线上盈亏", st.online.count ? fmtBb(st.online.pnlBb) : "—", st.online.count ? pnlClass(st.online.pnlBb) : ""),
    );
  }
  root.innerHTML = items.join("");
}

function sessionRowHTML(s) {
  const v = venueById(s.venue_id);
  const started = new Date(s.started_at);
  const pnl = sessionPnl(s);
  let sub;
  if (v && v.kind === "online") {
    const st = stakesById(s.stakes_id);
    const bb = sessionPnlBb(s);
    const parts = [st ? st.code : "?", bb == null ? "" : fmtBb(bb)];
    if (s.hands) parts.push(`${s.hands} 手 · ${fmtBb100(bbPer100(bb, s.hands))}`);
    sub = parts.filter(Boolean).join(" · ");
  } else {
    sub = formatDuration(netPlayMs(s));
    if (s.notes) sub += ` · ${s.notes}`;
  }
  return `
    <div class="recent-row" data-id="${esc(s.id)}">
      <span class="dot" style="background:${venueColor(venues, s.venue_id)}"></span>
      <div class="recent-main">
        <div class="recent-title">${esc(v ? v.name : "?")} <span class="muted">· ${formatDate(started)} ${formatHM(started)}</span></div>
        <div class="muted small recent-sub">${esc(sub)}</div>
      </div>
      <div class="pnl ${pnlClass(pnl)}">${fmtUsd(pnl)}</div>
    </div>
  `;
}

function renderSessionRows(root, list, emptyText) {
  if (!list || list.length === 0) {
    root.innerHTML = `<div class="recent-empty">${emptyText}</div>`;
    return;
  }
  root.innerHTML = list.map(sessionRowHTML).join("");
}

function rowClickOpensEdit(rootSel, returnTo) {
  $(rootSel).addEventListener("click", (e) => {
    const row = e.target.closest(".recent-row");
    if (!row) return;
    const s = sessions.find((x) => x.id === row.dataset.id);
    if (s) enterSessionForm({ mode: "edit", session: s, returnTo });
  });
}

// ───────────────────────── home view ─────────────────────────

let pickedMinutes = 180;

function renderHome() {
  renderKpis($("#home-kpis"), computeStats(sessions));
  renderSessionRows($("#recent-list"), sessions.slice(-8).reverse(), "还没记录过 session");
  renderMiniChart();
}

function renderMiniChart() {
  const series = buildSeries(sessions, venues, venues.map((v) => v.id), { includeTotal: true });
  // The sparkline is one line: the 合计 when there are several venues, else the only venue.
  const total = series.datasets.find((d) => d.venueId === null) || series.datasets[0];
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#aafbb2";
  renderBankrollChart($("#chart-mini"), { ...series, datasets: total ? [{ ...total, color: accent }] : [] }, { mini: true, noVenuesText: "还没记录过 session" });
}

function setupHome() {
  const saved = parseInt(localStorage.getItem(LS_DURATION) || "180", 10);
  pickedMinutes = saved;
  selectDurationChip(saved);

  $("#duration-chips").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    if (btn.dataset.custom !== undefined) {
      $$("#duration-chips .chip").forEach((c) => c.classList.remove("selected"));
      btn.classList.add("selected");
      $("#duration-custom-wrap").classList.remove("hidden");
      const input = $("#duration-custom-input");
      input.focus();
      input.value = pickedMinutes;
    } else {
      const mins = parseInt(btn.dataset.mins, 10);
      selectDurationChip(mins);
      pickedMinutes = mins;
      $("#duration-custom-wrap").classList.add("hidden");
    }
  });

  $("#duration-custom-input").addEventListener("input", (e) => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v) && v > 0) pickedMinutes = v;
  });

  $("#start-btn").addEventListener("click", () => {
    if (!pickedMinutes || pickedMinutes < 1) {
      toast("请设置时长", "err");
      return;
    }
    if (loadActive()) {
      enterRunning();   // a session is already running: just go back to it
      return;
    }
    ensureAudio(); // unlock audio on user gesture
    const s = {
      startedAt: Date.now(),
      plannedMinutes: pickedMinutes,
      alarmStopped: false,
      limpCount: 0,
      totalBreakMs: 0,
      breakStartedAt: null,
    };
    saveActive(s);
    localStorage.setItem(LS_DURATION, String(pickedMinutes));
    enterRunning();
  });

  $("#add-session-btn").addEventListener("click", () => enterSessionForm({ mode: "add", returnTo: "view-home" }));
  $("#settings-btn").addEventListener("click", enterSettings);
  $("#bankroll-card").addEventListener("click", enterBankroll);
  rowClickOpensEdit("#recent-list", "view-home");

  $("#ranges-btn-home").addEventListener("click", () => {
    prevView = "view-home";
    enterRanges();
  });
  $("#trainer-btn-home").addEventListener("click", () => {
    prevView = "view-home";
    enterTrainer();
  });
}

function selectDurationChip(mins) {
  let matched = false;
  $$("#duration-chips .chip").forEach((c) => {
    c.classList.remove("selected");
    if (c.dataset.mins && parseInt(c.dataset.mins, 10) === mins) {
      c.classList.add("selected");
      matched = true;
    }
  });
  if (!matched) {
    $$("#duration-chips .chip").forEach((c) => {
      if (c.dataset.custom !== undefined) c.classList.add("selected");
    });
    $("#duration-custom-wrap").classList.remove("hidden");
    $("#duration-custom-input").value = mins;
  } else {
    $("#duration-custom-wrap").classList.add("hidden");
  }
}

function updateDailyMotto() {
  const el = $("#daily-motto");
  if (!el) return;
  el.textContent = `"${getDailyMotto()}"`;
}

// ───────────────────────── running view ─────────────────────────

function enterRunning() {
  const s = loadActive();
  if (!s) {
    showView("view-home");
    return;
  }
  showView("view-running");
  $("#running-meta").textContent = `开始于 ${formatHM(new Date(s.startedAt))} · 目标 ${formatDuration(s.plannedMinutes * 60000)}`;
  updateLimpDisplay();
  startCountdownLoop();
}

function updateLimpDisplay() {
  const el = $("#limp-count");
  if (!el) return;
  const s = loadActive();
  el.textContent = String(s ? (s.limpCount || 0) : 0);
}

function showLimpWarning(count) {
  $("#warning-count").textContent = `已经 limp ${count} 次垃圾牌`;
  $("#warning-text").textContent = pickLimpWarning(count);
  $("#limp-warning-overlay").classList.remove("hidden");
  if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
}

function hideLimpWarning() {
  $("#limp-warning-overlay").classList.add("hidden");
}

function setupLimpCounter() {
  $("#limp-inc").addEventListener("click", () => {
    const s = loadActive();
    if (!s) return;
    s.limpCount = (s.limpCount || 0) + 1;
    saveActive(s);
    updateLimpDisplay();
    if (s.limpCount > 0 && s.limpCount % 3 === 0) {
      showLimpWarning(s.limpCount);
    }
  });
  $("#limp-dec").addEventListener("click", () => {
    const s = loadActive();
    if (!s) return;
    s.limpCount = Math.max(0, (s.limpCount || 0) - 1);
    saveActive(s);
    updateLimpDisplay();
  });
  $("#limp-reset").addEventListener("click", () => {
    const s = loadActive();
    if (!s) return;
    s.limpCount = 0;
    saveActive(s);
    updateLimpDisplay();
  });
  $("#warning-dismiss").addEventListener("click", hideLimpWarning);
  $("#limp-warning-overlay").addEventListener("click", (e) => {
    if (e.target.id === "limp-warning-overlay") hideLimpWarning();
  });
}

function endAt(s) {
  // Planned end pushes forward by completed break time so the countdown
  // "pauses" across breaks.
  return s.startedAt + s.plannedMinutes * 60000 + (s.totalBreakMs || 0);
}

function remainingMs(s) {
  // While on break the countdown is frozen at the value it had when the
  // break started.
  if (s.breakStartedAt) return endAt(s) - s.breakStartedAt;
  return endAt(s) - Date.now();
}

function startCountdownLoop() {
  stopCountdownLoop();
  const tick = () => {
    const s = loadActive();
    if (!s) return;
    const remaining = remainingMs(s);
    const el = $("#countdown");
    el.classList.toggle("warn", remaining > 0 && remaining <= 5 * 60000);
    el.classList.toggle("expired", remaining <= 0);

    if (remaining <= 0) {
      // overshoot: show how long over
      el.textContent = "+" + formatHMS(-remaining);
      if (!s.alarmStopped) {
        enterAlarm();
        return;
      }
    } else {
      el.textContent = formatHMS(remaining);
    }
    updateActiveBanner();         // keep home banner countdown in sync
    countdownRAF = requestAnimationFrame(throttledTick);
  };

  let lastSec = -1;
  const throttledTick = () => {
    const s = loadActive();
    if (!s) return;
    const remaining = remainingMs(s);
    const sec = Math.floor(remaining / 1000);
    if (sec !== lastSec) {
      lastSec = sec;
      tick();
      return;
    }
    countdownRAF = requestAnimationFrame(throttledTick);
  };

  tick();
}

function stopCountdownLoop() {
  if (countdownRAF) {
    cancelAnimationFrame(countdownRAF);
    countdownRAF = null;
  }
}

function setupRunning() {
  $("#end-btn").addEventListener("click", () => {
    stopCountdownLoop();
    enterRecord();
  });
  $("#ranges-btn").addEventListener("click", () => {
    prevView = "view-running";
    enterRanges();
  });
  $("#trainer-btn").addEventListener("click", () => {
    prevView = "view-running";
    enterTrainer();
  });
  // Back to home while session is running — countdown keeps ticking in
  // the background and will still trigger the alarm when time runs out.
  $("#running-back").addEventListener("click", () => {
    showView("view-home");
  });
  // Tap the "牌局进行中" banner on home to return to the timer.
  $("#active-banner").addEventListener("click", () => {
    if (loadActive()) enterRunning();
  });
}

// ───────────────────────── break view ─────────────────────────

let breakInterval = null;

function enterBreak() {
  const s = loadActive();
  if (!s) {
    showView("view-home");
    return;
  }
  stopCountdownLoop();             // freeze countdown during break
  if (!s.breakStartedAt) {
    s.breakStartedAt = Date.now();
    saveActive(s);
  }
  $("#break-motto").textContent = `"${pickBreakMotto()}"`;
  showView("view-break");
  startBreakLoop();
}

function resumeFromBreak() {
  const s = loadActive();
  if (!s) {
    showView("view-home");
    return;
  }
  if (s.breakStartedAt) {
    s.totalBreakMs = (s.totalBreakMs || 0) + (Date.now() - s.breakStartedAt);
    s.breakStartedAt = null;
    saveActive(s);
  }
  stopBreakLoop();
  enterRunning();
}

function startBreakLoop() {
  stopBreakLoop();
  updateBreakDisplay();
  breakInterval = setInterval(updateBreakDisplay, 1000);
}

function stopBreakLoop() {
  if (breakInterval) {
    clearInterval(breakInterval);
    breakInterval = null;
  }
}

function updateBreakDisplay() {
  const s = loadActive();
  if (!s || !s.breakStartedAt) return;
  const elapsed = Date.now() - s.breakStartedAt;
  $("#break-elapsed").textContent = formatHMS(elapsed);
  const totalSoFar = (s.totalBreakMs || 0) + elapsed;
  $("#break-total").textContent = `本场累计休息 ${Math.round(totalSoFar / 60000)} 分钟`;
}

function setupBreak() {
  $("#break-btn").addEventListener("click", enterBreak);
  $("#break-resume").addEventListener("click", resumeFromBreak);
}

// ───────────────────────── alarm view ─────────────────────────

function enterAlarm() {
  stopCountdownLoop();
  showView("view-alarm");
  const s = loadActive();
  if (s) {
    const over = Date.now() - endAt(s);
    $("#alarm-elapsed").textContent = over > 0
      ? `已超时 ${formatHMS(over)}`
      : "时间到了";
  }
  startAlarm();
}

function setupAlarm() {
  $("#alarm-stop-btn").addEventListener("click", () => {
    stopAlarm();
    const s = loadActive();
    if (s) {
      s.alarmStopped = true;
      saveActive(s);
    }
    enterRunning(); // back to running view, countdown will keep showing overage
  });

  $("#alarm-restart-btn").addEventListener("click", () => {
    stopAlarm();
    const s = loadActive();
    if (s) {
      s.startedAt = Date.now();
      s.alarmStopped = false;
      s.totalBreakMs = 0;
      s.breakStartedAt = null;
      saveActive(s);
    }
    enterRunning();
  });

  $("#alarm-end-btn").addEventListener("click", () => {
    stopAlarm();
    enterRecord();
  });
}

// End of a timed session → the session form, pre-filled from the timer.
function enterRecord() {
  const s = loadActive();
  if (!s) {
    showView("view-home");
    return;
  }
  stopAlarm();
  stopBreakLoop();
  let breakMs = s.totalBreakMs || 0;
  if (s.breakStartedAt) breakMs += Date.now() - s.breakStartedAt;   // ended while on a break
  enterSessionForm({
    mode: "record",
    returnTo: "view-home",
    timer: {
      startedAt: new Date(s.startedAt),
      endedAt: new Date(),
      plannedMinutes: s.plannedMinutes,
      breakMinutes: Math.round(breakMs / 60000),
    },
  });
}

// ───────────────────────── session form (record / add / edit) ─────────────────────────

// form.mode: "record" (after the timer; saving clears the active session),
//            "add" (by hand), "edit" (existing row; delete allowed)
let form = { mode: "add", session: null, timer: null, venueId: null, stakesId: null, returnTo: "view-home" };

function enterSessionForm(opts) {
  form = {
    mode: opts.mode,
    session: opts.session || null,
    timer: opts.timer || null,
    venueId: null,
    stakesId: null,
    returnTo: opts.returnTo || "view-home",
  };
  const s = form.session;
  $("#session-title").textContent = { record: "Session 结束，记一笔", add: "记一场", edit: "编辑 Session" }[form.mode];

  // venue / stakes: the row's, else the last used, else the first
  form.venueId = s ? s.venue_id : localStorage.getItem(LS_LAST_VENUE);
  if (!venueById(form.venueId)) form.venueId = venues[0] ? venues[0].id : null;
  form.stakesId = s && s.stakes_id ? s.stakes_id : localStorage.getItem(LS_LAST_STAKES);
  if (!stakesById(form.stakesId)) form.stakesId = stakes[0] ? stakes[0].id : null;

  let startedAt, endedAt;
  if (s) {
    startedAt = new Date(s.started_at);
    endedAt = new Date(s.ended_at);
  } else if (form.timer) {
    startedAt = form.timer.startedAt;
    endedAt = form.timer.endedAt;
  } else {
    endedAt = new Date();
    startedAt = new Date(endedAt.getTime() - 3 * 3600000);
  }
  $("#f-started").value = toDatetimeLocal(startedAt);
  $("#f-ended").value = toDatetimeLocal(endedAt);
  // USD is always prefilled (an online row stores the converted amounts too),
  // so switching an online row to a live venue keeps its money.
  const isOnlineRow = !!(s && s.buy_in_bb != null);
  $("#f-buyin").value = s ? s.buy_in : "";
  $("#f-cashout").value = s ? s.cash_out : "";
  $("#f-buyin-bb").value = isOnlineRow ? s.buy_in_bb : "";
  $("#f-cashout-bb").value = isOnlineRow ? s.cash_out_bb : "";
  $("#f-hands").value = s && s.hands != null ? s.hands : "";
  const brk = s ? (s.break_minutes || 0) : form.timer ? form.timer.breakMinutes : 0;
  $("#f-break").value = brk || "";
  $("#f-notes").value = s ? (s.notes || "") : "";
  $("#f-more").open = !!(brk || (s && s.notes));

  $("#f-delete").classList.toggle("hidden", form.mode !== "edit");
  $("#f-discard").classList.toggle("hidden", form.mode !== "record");

  renderVenueChips();
  renderStakesChips();
  applyVenueKind();
  updatePreview();
  showView("view-session");
  if (venues.length === 0) toast("还没有场地，先去设置里加一个", "err");
}

function renderVenueChips() {
  $("#venue-chips").innerHTML = venues.map((v) => `
    <button type="button" class="chip ${v.id === form.venueId ? "selected" : ""}" data-id="${esc(v.id)}">
      <i class="dot" style="background:${venueColor(venues, v.id)}"></i>${esc(v.name)}
    </button>
  `).join("") || `<span class="muted small">没有场地</span>`;
}

function renderStakesChips() {
  $("#stakes-chips").innerHTML = stakes.map((st) => `
    <button type="button" class="chip ${st.id === form.stakesId ? "selected" : ""}" data-id="${esc(st.id)}" title="${esc(st.label || "")}">
      ${esc(st.code)} <span class="chip-sub">$${Number(st.bb_usd)}/bb</span>
    </button>
  `).join("") || `<span class="muted small">没有级别，先去设置里加</span>`;
}

function applyVenueKind() {
  const v = venueById(form.venueId);
  const online = !!(v && v.kind === "online");
  $("#stakes-wrap").classList.toggle("hidden", !online);
  $("#online-wrap").classList.toggle("hidden", !online);
  $("#live-wrap").classList.toggle("hidden", online);
}

function readForm() {
  return {
    startedAt: new Date($("#f-started").value),
    endedAt: new Date($("#f-ended").value),
    buyIn: $("#f-buyin").value,
    cashOut: $("#f-cashout").value,
    buyInBb: $("#f-buyin-bb").value,
    cashOutBb: $("#f-cashout-bb").value,
    hands: $("#f-hands").value,
    breakMinutes: $("#f-break").value,
    notes: $("#f-notes").value,
    plannedMinutes: form.session ? form.session.planned_duration_minutes : form.timer ? form.timer.plannedMinutes : null,
  };
}

function currentRow() {
  const venue = venueById(form.venueId);
  const stake = venue && venue.kind === "online" ? stakesById(form.stakesId) : null;
  return buildSessionRow(readForm(), venue, stake);
}

function updatePreview() {
  const el = $("#f-preview");
  const { row } = currentRow();
  if (row.buy_in == null || row.cash_out == null) {
    el.textContent = "填完金额这里会显示盈亏";
    el.className = "preview";
    return;
  }
  const pnl = sessionPnl(row);
  const parts = [`盈亏 ${fmtUsd(pnl)}`];
  if (row.buy_in_bb != null) {
    const bb = sessionPnlBb(row);
    parts.push(`${fmtBb(bb)}（${fmtUsd(row.buy_in, { sign: false })} → ${fmtUsd(row.cash_out, { sign: false })}）`);
    if (num(row.hands) > 0) parts.push(fmtBb100(bbPer100(bb, row.hands)));
  }
  if (row.started_at && row.ended_at) parts.push(formatDuration(netPlayMs(row)));
  el.textContent = parts.join(" · ");
  el.className = "preview " + pnlClass(pnl);
}

function setupSessionForm() {
  $("#venue-chips").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    form.venueId = btn.dataset.id;
    renderVenueChips();
    applyVenueKind();
    updatePreview();
  });
  $("#stakes-chips").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    form.stakesId = btn.dataset.id;
    renderStakesChips();
    updatePreview();
  });
  ["#f-started", "#f-ended", "#f-buyin", "#f-cashout", "#f-buyin-bb", "#f-cashout-bb", "#f-hands", "#f-break"].forEach((sel) => {
    $(sel).addEventListener("input", updatePreview);
  });

  $("#session-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { row, errors } = currentRow();
    if (errors.length) {
      toast(errors[0], "err");
      return;
    }
    const done = busy($("#f-save"), "保存中...");
    try {
      if (form.mode === "edit") await db.updateSession(form.session.id, row);
      else await db.insertSession(row);
    } catch (err) {
      console.error(err);
      toast("保存失败：" + (err.message || err), "err");
      done();
      return;
    }
    done();
    localStorage.setItem(LS_LAST_VENUE, row.venue_id);
    if (row.stakes_id) localStorage.setItem(LS_LAST_STAKES, row.stakes_id);
    if (form.mode === "record") clearActive();
    toast("已保存", "ok");
    await leaveFormAfterWrite(form.returnTo);
  });

  $("#f-delete").addEventListener("click", async () => {
    if (form.mode !== "edit" || !form.session) return;
    if (!confirm("确定删除这条 session？无法恢复。")) return;
    const done = busy($("#f-delete"), "删除中...");
    try {
      await db.deleteSession(form.session.id);
    } catch (err) {
      console.error(err);
      toast("删除失败：" + (err.message || err), "err");
      done();
      return;
    }
    done();
    toast("已删除", "ok");
    await leaveFormAfterWrite(form.returnTo);
  });

  $("#f-discard").addEventListener("click", () => {
    if (!confirm("确定丢弃这场 session？数据不会保存。")) return;
    clearActive();
    showView("view-home");
  });

  // Back from the post-timer form returns to the running timer (End was a
  // mis-tap); otherwise to wherever the form was opened from.
  $("#session-back").addEventListener("click", () => {
    if (form.mode === "record" && loadActive()) {
      enterRunning();
      return;
    }
    showView(form.returnTo);
    if (form.returnTo === "view-bankroll") renderBankroll();
  });
}

// After a successful write: refresh and go back. A refresh failure must not
// read as a failed write (the row is already in the database).
async function leaveFormAfterWrite(view) {
  try {
    await reloadSessions();
  } catch (err) {
    console.error(err);
    toast("已保存，但列表刷新失败：" + (err.message || err), "err");
  }
  showView(view);
  if (view === "view-bankroll") renderBankroll();
}

// ───────────────────────── bankroll view ─────────────────────────

let chartSel = null;        // Set of venue ids, or null = all venues
let chartTotal = true;

function loadChartPrefs() {
  try {
    const a = JSON.parse(localStorage.getItem(LS_CHART_VENUES));
    if (Array.isArray(a)) chartSel = new Set(a);
  } catch { /* defaults */ }
  chartTotal = localStorage.getItem(LS_CHART_TOTAL) !== "0";
}

function saveChartPrefs() {
  if (chartSel) localStorage.setItem(LS_CHART_VENUES, JSON.stringify([...chartSel]));
  else localStorage.removeItem(LS_CHART_VENUES);
  localStorage.setItem(LS_CHART_TOTAL, chartTotal ? "1" : "0");
}

function selectedVenueIds() {
  const ids = venues.map((v) => v.id);
  return chartSel ? ids.filter((id) => chartSel.has(id)) : ids;
}

function renderVenueFilter(sel) {
  const selSet = new Set(sel);
  const chips = venues.map((v) => `
    <button type="button" class="chip ${selSet.has(v.id) ? "selected" : ""}" data-id="${esc(v.id)}">
      <i class="dot" style="background:${venueColor(venues, v.id)}"></i>${esc(v.name)}
    </button>
  `);
  chips.push(`
    <button type="button" class="chip chip-total ${chartTotal ? "selected" : ""}" data-total="1" ${sel.length > 1 ? "" : "disabled"}>
      <i class="dot dot-total"></i>合计
    </button>
  `);
  $("#venue-filter").innerHTML = chips.join("");
}

function renderBankroll() {
  const sel = selectedVenueIds();
  renderVenueFilter(sel);
  const series = buildSeries(sessions, venues, sel, { includeTotal: chartTotal });
  renderBankrollChart($("#chart-full"), series, {
    mini: false,
    onPointTap: (s) => enterSessionForm({ mode: "edit", session: s, returnTo: "view-bankroll" }),
  });
  renderKpis($("#bankroll-stats"), computeStats(series.sessions), { full: true });
  $("#session-list-count").textContent = series.sessions.length ? `· ${series.sessions.length}` : "";
  renderSessionRows($("#session-list"), series.sessions.slice().reverse(), sel.length ? "这些场地还没记录" : "没选场地");
}

function enterBankroll() {
  showView("view-bankroll");
  renderBankroll();
}

function setupBankroll() {
  $("#bankroll-close").addEventListener("click", () => showView("view-home"));
  $("#venue-filter").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn || btn.disabled) return;
    if (btn.dataset.total) {
      chartTotal = !chartTotal;
    } else {
      const all = venues.map((v) => v.id);
      const next = new Set(chartSel ? [...chartSel].filter((id) => all.includes(id)) : all);
      if (next.has(btn.dataset.id)) next.delete(btn.dataset.id);
      else next.add(btn.dataset.id);
      chartSel = next.size === all.length ? null : next;
    }
    saveChartPrefs();
    renderBankroll();
  });
  rowClickOpensEdit("#session-list", "view-bankroll");
}

// ───────────────────────── settings view ─────────────────────────

function renderSettings() {
  $("#venue-list").innerHTML = venues.map((v) => `
    <div class="plain-row">
      <i class="dot" style="background:${venueColor(venues, v.id)}"></i>
      <span class="grow">${esc(v.name)}</span>
      <span class="muted small">${v.kind === "online" ? "线上 · bb" : "线下 · USD"}</span>
    </div>
  `).join("") || `<div class="muted small">还没有场地</div>`;
  $("#stakes-list").innerHTML = stakes.map((st) => `
    <div class="plain-row">
      <span class="grow"><b>${esc(st.code)}</b> <span class="muted small">${esc(st.label || "")}</span></span>
      <span class="muted small">1 bb = $${Number(st.bb_usd)}</span>
    </div>
  `).join("") || `<div class="muted small">还没有级别</div>`;
  $("#db-mode").textContent = db.name + (MOCK ? "（假数据，不保存）" : "");
}

async function refreshKeepalive() {
  const el = $("#keepalive-status");
  el.textContent = "查询中…";
  try {
    const k = await db.latestKeepalive();
    if (!k) {
      el.textContent = "还没有任何保活记录";
      el.className = "value neg";
      return;
    }
    const hours = (Date.now() - new Date(k.pinged_at).getTime()) / 3600000;
    el.innerHTML = `上次保活：<b>${esc(timeAgo(k.pinged_at))}</b> <span class="muted small">（${esc(k.source || "?")} · ${formatDateTime(new Date(k.pinged_at))}）</span>`;
    el.className = "value " + (hours > 24 ? "neg" : "pos");
  } catch (err) {
    console.error(err);
    el.textContent = "查不到：" + (err.message || err);
    el.className = "value neg";
  }
}

function enterSettings() {
  showView("view-settings");
  renderSettings();
  refreshKeepalive();
}

function setupSettings() {
  $("#settings-close").addEventListener("click", () => showView("view-home"));

  $("#ping-btn").addEventListener("click", async () => {
    const done = busy($("#ping-btn"), "ping 中...");
    try {
      await db.ping("app");
      toast("ping 成功", "ok");
      await refreshKeepalive();
    } catch (err) {
      console.error(err);
      toast("ping 失败：" + (err.message || err), "err");
    } finally {
      done();
    }
  });

  $("#venue-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#venue-name").value.trim();
    const kind = $("#venue-kind").value;
    if (!name) { toast("场地名不能为空", "err"); return; }
    const done = busy(e.submitter || $("#venue-form button"), "添加中...");
    try {
      await db.insertVenue({ name, kind, sort_order: venues.length + 1 });
      venues = await db.listVenues();
      $("#venue-name").value = "";
      renderSettings();
      renderHome();
      toast("已添加", "ok");
    } catch (err) {
      console.error(err);
      toast("添加失败：" + (err.message || err), "err");
    } finally {
      done();
    }
  });

  $("#stakes-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = $("#stakes-code").value.trim();
    const bb = num($("#stakes-bb").value);
    const label = $("#stakes-label").value.trim() || null;
    if (!code) { toast("代号不能为空", "err"); return; }
    if (!Number.isFinite(bb) || bb <= 0) { toast("1 bb 的美元数要大于 0", "err"); return; }
    const done = busy(e.submitter || $("#stakes-form button"), "添加中...");
    try {
      await db.insertStakes({ code, bb_usd: bb, label, sort_order: stakes.length + 1 });
      stakes = await db.listStakes();
      $("#stakes-code").value = "";
      $("#stakes-bb").value = "";
      $("#stakes-label").value = "";
      renderSettings();
      toast("已添加", "ok");
    } catch (err) {
      console.error(err);
      toast("添加失败：" + (err.message || err), "err");
    } finally {
      done();
    }
  });
}

// ───────────────────────── ranges view ─────────────────────────

function enterRanges() {
  showView("view-ranges");
  renderScenarioChips();
  renderPositionChips();
  renderRangeGrid();
}

function renderScenarioChips() {
  $$("#scenario-chips .chip").forEach((c) => {
    c.classList.toggle("selected", c.dataset.scenario === rangeScenario);
  });
}

function renderPositionChips() {
  const list = rangeScenario === "RFI" ? POSITIONS_RFI : POSITIONS_VS_UTG;
  if (!list.includes(rangePosition)) rangePosition = list[list.length - 1];  // default to most useful (BTN/BB)
  const html = list.map(
    (p) => `<button type="button" class="chip ${p === rangePosition ? "selected" : ""}" data-pos="${p}">${POSITION_LABEL[p]}</button>`
  ).join("");
  $("#position-chips").innerHTML = html;
}

function renderRangeGrid() {
  $("#range-grid").innerHTML = rangeGridHTML(rangeScenario, rangePosition);
}

function setupRanges() {
  $("#scenario-chips").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    rangeScenario = btn.dataset.scenario;
    renderScenarioChips();
    renderPositionChips();
    renderRangeGrid();
  });

  $("#position-chips").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    rangePosition = btn.dataset.pos;
    renderPositionChips();
    renderRangeGrid();
  });

  $("#ranges-close").addEventListener("click", () => {
    showView(prevView || "view-home");
  });
}

// ───────────────────────── routing ─────────────────────────

async function boot() {
  loadChartPrefs();
  setupHome();
  setupRunning();
  setupAlarm();
  setupBreak();
  setupLimpCounter();
  setupSessionForm();
  setupBankroll();
  setupSettings();
  setupRanges();
  try {
    setupTrainer({
      showView,
      onClose: () => {
        // Drop the #trainer deep link so a reload lands on the normal view.
        if (location.hash === "#trainer") history.replaceState(null, "", location.pathname + location.search);
        showView(prevView || "view-home");
      },
    });
  } catch (err) {
    console.error("[trainer] setup failed, timer keeps working", err);
  }
  updateDailyMotto();

  // Placeholders until the data is in (the timer must not wait for the network).
  renderKpis($("#home-kpis"), computeStats([]));
  $("#recent-list").innerHTML = `<div class="recent-empty">加载中…</div>`;
  loadAll();  // fire and forget; home view shows immediately

  const s = loadActive();
  if (!s) {
    showView("view-home");
    return;
  }
  if (s.breakStartedAt) {
    enterBreak();        // was on a break when app closed
    return;
  }
  const remaining = remainingMs(s);
  if (remaining <= 0 && !s.alarmStopped) {
    enterAlarm();
  } else {
    enterRunning();
  }
}

// Register service worker (we already had one)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => console.error("[sw]", e));
  });
}

// When page becomes visible again, re-check timer state from any view
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const s = loadActive();
  if (!s) return;
  const remaining = remainingMs(s);
  if (remaining <= 0 && !s.alarmStopped) {
    enterAlarm();
  } else {
    updateActiveBanner();
  }
});

boot().then(() => {
  // Deep link for desktop practice: index.html#trainer opens the trainer
  // directly (never on top of the alarm screen).
  if (location.hash === "#trainer" && $("#view-alarm").classList.contains("hidden")) {
    prevView = currentView();
    enterTrainer();
  }
}).catch((err) => {
  console.error("boot failed", err);
  showFatalError("启动失败：" + (err.message || err));
});
