import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import {
  POSITIONS_RFI, POSITIONS_VS_UTG, POSITION_LABEL,
  cellAction, handAt,
} from "./ranges.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// ───────────────────────── state ─────────────────────────

const LS_KEY = "poker.activeSession";        // {startedAt, plannedMinutes, alarmStopped}
const LS_DURATION = "poker.lastDurationMins";

let countdownRAF = null;
let alarmInterval = null;
let audioCtx = null;
let allSessionsCache = [];                    // all sessions, ASC by started_at
let recentCache = [];                          // last 8 sessions, DESC (for "最近" list)
let editingId = null;                          // session being edited
let prevView = "view-home";                    // where to return after closing ranges
let rangeScenario = "RFI";
let rangePosition = "BTN";
let selectedBankrollSessionId = null;

// ───────────────────────── DOM helpers ─────────────────────────

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function showView(id) {
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $(`#${id}`).classList.remove("hidden");
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

function toDatetimeLocal(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
    // re-vibrate every few seconds
    if (alarmInterval) {
      const vibInterval = setInterval(() => {
        if (!alarmInterval) { clearInterval(vibInterval); return; }
        navigator.vibrate([400, 150, 400]);
      }, 3000);
    }
  }
}

function stopAlarm() {
  if (alarmInterval) {
    clearInterval(alarmInterval);
    alarmInterval = null;
  }
  if (navigator.vibrate) navigator.vibrate(0);
}

// ───────────────────────── sessions CRUD ─────────────────────────

async function saveSessionToCloud(row) {
  const { data, error } = await supabase
    .from("sessions")
    .insert([row])
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateSessionInCloud(id, patch) {
  const { data, error } = await supabase
    .from("sessions")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteSessionFromCloud(id) {
  const { error } = await supabase.from("sessions").delete().eq("id", id);
  if (error) throw error;
}

async function listAllSessions() {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .order("started_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

// ───────────────────────── views ─────────────────────────

function renderRecent(list) {
  const root = $("#recent-list");
  if (!list || list.length === 0) {
    root.innerHTML = `<div class="recent-empty">还没记录过 session</div>`;
    return;
  }
  root.innerHTML = list.map((s) => {
    const started = new Date(s.started_at);
    const ended = new Date(s.ended_at);
    const pnl = Number(s.cash_out) - Number(s.buy_in);
    const sign = pnl > 0 ? "+" : pnl < 0 ? "−" : "";
    const cls = pnl > 0 ? "pos" : pnl < 0 ? "neg" : "zero";
    return `
      <div class="recent-row" data-id="${s.id}">
        <div>${formatDate(started)} · ${formatHM(started)}–${formatHM(ended)}</div>
        <div class="muted">${formatDuration(ended - started)}</div>
        <div class="pnl ${cls}">${sign}$${Math.abs(pnl).toFixed(2)}</div>
      </div>
    `;
  }).join("");
}

async function refreshRecent() {
  try {
    allSessionsCache = await listAllSessions();
    recentCache = allSessionsCache.slice(-8).reverse();
    renderRecent(recentCache);
    renderBankrollMini();
  } catch (err) {
    console.error(err);
    $("#recent-list").innerHTML = `<div class="recent-empty">加载失败：${err.message || err}</div>`;
  }
}

function setupRecentClicks() {
  $("#recent-list").addEventListener("click", (e) => {
    const row = e.target.closest(".recent-row");
    if (!row) return;
    const id = row.dataset.id;
    const s = recentCache.find((x) => x.id === id);
    if (s) enterEdit(s);
  });
}

// ───────────────────────── home view ─────────────────────────

let pickedMinutes = 180;

function setupHome() {
  const saved = parseInt(localStorage.getItem(LS_DURATION) || "180", 10);
  pickedMinutes = saved;
  selectDurationChip(saved);

  $("#duration-chips").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    if (btn.dataset.custom !== undefined) {
      $$(".chip").forEach((c) => c.classList.remove("selected"));
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
    ensureAudio(); // unlock audio on user gesture
    const s = {
      startedAt: Date.now(),
      plannedMinutes: pickedMinutes,
      alarmStopped: false,
    };
    saveActive(s);
    localStorage.setItem(LS_DURATION, String(pickedMinutes));
    enterRunning();
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

// ───────────────────────── running view ─────────────────────────

function enterRunning() {
  const s = loadActive();
  if (!s) {
    showView("view-home");
    return;
  }
  showView("view-running");
  $("#running-meta").textContent = `开始于 ${formatHM(new Date(s.startedAt))} · 目标 ${formatDuration(s.plannedMinutes * 60000)}`;
  startCountdownLoop();
}

function endAt(s) {
  return s.startedAt + s.plannedMinutes * 60000;
}

function startCountdownLoop() {
  stopCountdownLoop();
  const tick = () => {
    const s = loadActive();
    if (!s) return;
    const remaining = endAt(s) - Date.now();
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
    countdownRAF = requestAnimationFrame(throttledTick);
  };

  let lastSec = -1;
  const throttledTick = () => {
    const s = loadActive();
    if (!s) return;
    const remaining = endAt(s) - Date.now();
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
      saveActive(s);
    }
    enterRunning();
  });

  $("#alarm-end-btn").addEventListener("click", () => {
    stopAlarm();
    enterRecord();
  });
}

// ───────────────────────── record view ─────────────────────────

let recordContext = null; // captured at the moment user pressed End

function enterRecord() {
  const s = loadActive();
  if (!s) {
    showView("view-home");
    return;
  }
  stopAlarm();
  recordContext = {
    startedAt: new Date(s.startedAt),
    endedAt: new Date(),
    plannedMinutes: s.plannedMinutes,
  };
  $("#record-summary").textContent =
    `${formatHM(recordContext.startedAt)} → ${formatHM(recordContext.endedAt)} · ${formatDuration(recordContext.endedAt - recordContext.startedAt)}`;
  $("#buy-in").value = "";
  $("#cash-out").value = "";
  $("#notes").value = "";
  showView("view-record");
  setTimeout(() => $("#buy-in").focus(), 200);
}

function setupRecord() {
  $("#record-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!recordContext) return;
    const buyIn = parseFloat($("#buy-in").value);
    const cashOut = parseFloat($("#cash-out").value);
    if (isNaN(buyIn) || isNaN(cashOut)) {
      toast("请填 buy-in 和 cash-out", "err");
      return;
    }
    const btn = $("#save-btn");
    btn.disabled = true;
    btn.textContent = "保存中...";
    try {
      await saveSessionToCloud({
        started_at: recordContext.startedAt.toISOString(),
        ended_at: recordContext.endedAt.toISOString(),
        planned_duration_minutes: recordContext.plannedMinutes,
        buy_in: buyIn,
        cash_out: cashOut,
        notes: $("#notes").value.trim() || null,
      });
      clearActive();
      recordContext = null;
      toast("已保存", "ok");
      await refreshRecent();
      showView("view-home");
    } catch (err) {
      console.error(err);
      toast("保存失败：" + (err.message || err), "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "保存";
    }
  });

  $("#discard-btn").addEventListener("click", () => {
    if (!confirm("确定丢弃这场 session？数据不会保存。")) return;
    clearActive();
    recordContext = null;
    showView("view-home");
  });
}

// ───────────────────────── edit view ─────────────────────────

function enterEdit(session) {
  editingId = session.id;
  const started = new Date(session.started_at);
  const ended = new Date(session.ended_at);
  $("#edit-summary").textContent =
    `${formatDate(started)} · ${formatHM(started)} → ${formatHM(ended)}`;
  $("#edit-started-at").value = toDatetimeLocal(started);
  $("#edit-ended-at").value = toDatetimeLocal(ended);
  $("#edit-planned").value = session.planned_duration_minutes;
  $("#edit-buy-in").value = session.buy_in;
  $("#edit-cash-out").value = session.cash_out;
  $("#edit-notes").value = session.notes || "";
  showView("view-edit");
}

function setupEdit() {
  $("#edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!editingId) return;
    const startedAt = new Date($("#edit-started-at").value);
    const endedAt = new Date($("#edit-ended-at").value);
    if (isNaN(startedAt) || isNaN(endedAt)) {
      toast("时间填写不正确", "err");
      return;
    }
    if (endedAt <= startedAt) {
      toast("结束时间要晚于开始时间", "err");
      return;
    }
    const btn = $("#edit-save-btn");
    btn.disabled = true;
    btn.textContent = "保存中...";
    try {
      await updateSessionInCloud(editingId, {
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        planned_duration_minutes: parseInt($("#edit-planned").value, 10),
        buy_in: parseFloat($("#edit-buy-in").value),
        cash_out: parseFloat($("#edit-cash-out").value),
        notes: $("#edit-notes").value.trim() || null,
      });
      toast("已保存", "ok");
      editingId = null;
      await refreshRecent();
      showView("view-home");
    } catch (err) {
      console.error(err);
      toast("保存失败：" + (err.message || err), "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "保存";
    }
  });

  $("#edit-delete-btn").addEventListener("click", async () => {
    if (!editingId) return;
    if (!confirm("确定删除这条 session？无法恢复。")) return;
    const btn = $("#edit-delete-btn");
    btn.disabled = true;
    btn.textContent = "删除中...";
    try {
      await deleteSessionFromCloud(editingId);
      toast("已删除", "ok");
      editingId = null;
      await refreshRecent();
      showView("view-home");
    } catch (err) {
      console.error(err);
      toast("删除失败：" + (err.message || err), "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "删除这条";
    }
  });

  $("#edit-cancel-btn").addEventListener("click", () => {
    editingId = null;
    showView("view-home");
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
  const grid = $("#range-grid");
  const cells = [];
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const hand = handAt(r, c);
      const { r: pr, c: pc } = cellAction(r, c, rangeScenario, rangePosition);
      const pf = Math.max(0, 1 - pr - pc);
      const bars = [
        pr > 0 ? `<div class="bar-r" style="flex-grow:${pr}"></div>` : "",
        pc > 0 ? `<div class="bar-c" style="flex-grow:${pc}"></div>` : "",
        pf > 0 ? `<div class="bar-f" style="flex-grow:${pf}"></div>` : "",
      ].join("");
      cells.push(`<div class="range-cell"><div class="bars">${bars}</div><span class="label">${hand}</span></div>`);
    }
  }
  grid.innerHTML = cells.join("");
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

// ───────────────────────── bankroll view ─────────────────────────

function sessionPnl(s) {
  return Number(s.cash_out) - Number(s.buy_in);
}

function buildBankrollPoints(sessions) {
  // sessions assumed ASC by started_at. Returns [{time, pnl, session}].
  // First point is a synthetic anchor at $0 just before the first session.
  if (sessions.length === 0) return [];
  const first = new Date(sessions[0].started_at);
  const points = [{ time: new Date(first.getTime() - 1), pnl: 0, session: null }];
  let cumul = 0;
  for (const s of sessions) {
    cumul += sessionPnl(s);
    points.push({ time: new Date(s.ended_at), pnl: cumul, session: s });
  }
  return points;
}

function renderBankrollChart(container, sessions, { mini = true, selectedId = null, onPointTap = null } = {}) {
  container.innerHTML = "";

  if (sessions.length === 0) {
    container.innerHTML = `<div class="chart-empty">还没记录过 session</div>`;
    return;
  }

  const points = buildBankrollPoints(sessions);
  const W = container.clientWidth || 320;
  const H = mini ? 120 : 280;
  const padTop = mini ? 8 : 14;
  const padBottom = mini ? 8 : 26;
  const padLeft = mini ? 8 : 44;
  const padRight = mini ? 8 : 12;
  const innerW = Math.max(1, W - padLeft - padRight);
  const innerH = Math.max(1, H - padTop - padBottom);

  const minTime = points[0].time.getTime();
  const maxTime = points[points.length - 1].time.getTime();
  const timeRange = Math.max(1, maxTime - minTime);

  let minPnl = Math.min(...points.map((p) => p.pnl));
  let maxPnl = Math.max(...points.map((p) => p.pnl));
  if (minPnl === maxPnl) {
    minPnl -= 10;
    maxPnl += 10;
  }
  if (minPnl > 0) minPnl = 0;
  if (maxPnl < 0) maxPnl = 0;
  const pnlRange = maxPnl - minPnl || 1;

  const xFor = (t) => padLeft + ((t.getTime() - minTime) / timeRange) * innerW;
  const yFor = (p) => padTop + (1 - (p - minPnl) / pnlRange) * innerH;

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");

  // Zero line (only if range crosses zero)
  if (minPnl < 0 && maxPnl > 0) {
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", padLeft);
    line.setAttribute("x2", W - padRight);
    line.setAttribute("y1", yFor(0));
    line.setAttribute("y2", yFor(0));
    line.setAttribute("class", "zero-line");
    svg.appendChild(line);
  }

  // Line path
  const lastPnl = points[points.length - 1].pnl;
  const lineCls = lastPnl > 0 ? "chart-line pos" : lastPnl < 0 ? "chart-line neg" : "chart-line";
  let d = "";
  for (let i = 0; i < points.length; i++) {
    d += (i === 0 ? "M" : "L") + xFor(points[i].time).toFixed(1) + "," + yFor(points[i].pnl).toFixed(1);
  }
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  path.setAttribute("class", lineCls);
  svg.appendChild(path);

  // Points (skip synthetic anchor at index 0)
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const cx = xFor(p.time);
    const cy = yFor(p.pnl);
    const pnl = sessionPnl(p.session);
    const cls = pnl >= 0 ? "chart-point pos" : "chart-point neg";
    const isSelected = selectedId && p.session.id === selectedId;

    const c = document.createElementNS(ns, "circle");
    c.setAttribute("cx", cx);
    c.setAttribute("cy", cy);
    c.setAttribute("r", mini ? 2.5 : isSelected ? 7 : 4.5);
    c.setAttribute("class", cls + (isSelected ? " selected" : ""));
    svg.appendChild(c);

    if (onPointTap && !mini) {
      // Larger invisible tap target
      const tap = document.createElementNS(ns, "circle");
      tap.setAttribute("cx", cx);
      tap.setAttribute("cy", cy);
      tap.setAttribute("r", 14);
      tap.setAttribute("fill", "transparent");
      tap.style.cursor = "pointer";
      tap.dataset.id = p.session.id;
      svg.appendChild(tap);
    }
  }

  // Axis labels (full only)
  if (!mini) {
    const mkText = (x, y, text, anchor = "start") => {
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", x);
      t.setAttribute("y", y);
      t.setAttribute("class", "chart-label");
      t.setAttribute("text-anchor", anchor);
      t.textContent = text;
      svg.appendChild(t);
    };
    const fmtAxis = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
    mkText(padLeft, H - 8, fmtAxis(points[0].time));
    mkText(W - padRight, H - 8, fmtAxis(points[points.length - 1].time), "end");
    mkText(padLeft - 4, padTop + 4, `$${Math.round(maxPnl)}`, "end");
    mkText(padLeft - 4, padTop + innerH, `$${Math.round(minPnl)}`, "end");
    if (minPnl < 0 && maxPnl > 0) {
      mkText(padLeft - 4, yFor(0) + 3, "$0", "end");
    }
  }

  if (onPointTap && !mini) {
    svg.addEventListener("click", (e) => {
      const id = e.target && e.target.dataset && e.target.dataset.id;
      if (!id) return;
      const session = sessions.find((s) => s.id === id);
      if (session) onPointTap(session);
    });
  }

  container.appendChild(svg);
}

function renderBankrollMini() {
  const card = $("#bankroll-card");
  const chart = $("#bankroll-chart-mini");
  const total = $("#pnl-total");
  if (!card || !chart || !total) return;

  const sessions = allSessionsCache;
  const sum = sessions.reduce((acc, s) => acc + sessionPnl(s), 0);
  const sign = sum > 0 ? "+" : sum < 0 ? "−" : "";
  total.textContent = `${sign}$${Math.abs(sum).toFixed(2)}`;
  total.className = "pnl-total " + (sum > 0 ? "pos" : sum < 0 ? "neg" : "");

  renderBankrollChart(chart, sessions, { mini: true });
}

function computeStats(sessions) {
  if (sessions.length === 0) {
    return { total: 0, count: 0, winrate: null, hourly: null };
  }
  let total = 0;
  let wins = 0;
  let totalMs = 0;
  for (const s of sessions) {
    const pnl = sessionPnl(s);
    total += pnl;
    if (pnl > 0) wins++;
    totalMs += new Date(s.ended_at) - new Date(s.started_at);
  }
  const hours = totalMs / 1000 / 3600;
  return {
    total,
    count: sessions.length,
    winrate: wins / sessions.length,
    hourly: hours > 0 ? total / hours : null,
  };
}

function renderBankrollDetail() {
  const sessions = allSessionsCache;
  const stats = computeStats(sessions);

  const totalEl = $("#stat-total");
  const sign = stats.total > 0 ? "+" : stats.total < 0 ? "−" : "";
  totalEl.textContent = `${sign}$${Math.abs(stats.total).toFixed(2)}`;
  totalEl.className = "stat-value " + (stats.total > 0 ? "pos" : stats.total < 0 ? "neg" : "");

  $("#stat-count").textContent = String(stats.count);
  $("#stat-winrate").textContent = stats.winrate == null ? "—" : `${Math.round(stats.winrate * 100)}%`;
  $("#stat-hourly").textContent = stats.hourly == null
    ? "—"
    : `${stats.hourly >= 0 ? "+" : "−"}$${Math.abs(stats.hourly).toFixed(1)}/h`;
  const hourlyEl = $("#stat-hourly");
  hourlyEl.className = "stat-value " + (stats.hourly == null ? "" : stats.hourly > 0 ? "pos" : stats.hourly < 0 ? "neg" : "");

  renderBankrollChart($("#bankroll-chart-full"), sessions, {
    mini: false,
    selectedId: selectedBankrollSessionId,
    onPointTap: (session) => {
      selectedBankrollSessionId = session.id;
      renderBankrollDetail();        // re-render to highlight selected point
      renderSessionDetailCard(session);
    },
  });

  // If a session was previously selected and still exists, re-render its card
  if (selectedBankrollSessionId) {
    const s = sessions.find((x) => x.id === selectedBankrollSessionId);
    if (s) renderSessionDetailCard(s);
  }
}

function renderSessionDetailCard(session) {
  const card = $("#session-detail-card");
  card.classList.remove("hidden");
  const started = new Date(session.started_at);
  const ended = new Date(session.ended_at);
  const pnl = sessionPnl(session);
  const sign = pnl > 0 ? "+" : pnl < 0 ? "−" : "";
  const cls = pnl > 0 ? "pos" : pnl < 0 ? "neg" : "";

  $("#detail-summary").textContent = `${formatDate(started)} · ${formatDuration(ended - started)}`;
  $("#detail-times").textContent = `${formatHM(started)} → ${formatHM(ended)}`;
  $("#detail-amounts").innerHTML = `
    <div><div class="label">Buy-in</div><div class="v">$${Number(session.buy_in).toFixed(2)}</div></div>
    <div><div class="label">Cash-out</div><div class="v">$${Number(session.cash_out).toFixed(2)}</div></div>
    <div><div class="label">P/L</div><div class="v ${cls}">${sign}$${Math.abs(pnl).toFixed(2)}</div></div>
  `;
  $("#detail-notes").textContent = session.notes || "";
  $("#detail-edit-btn").onclick = () => enterEdit(session);
}

function enterBankroll() {
  selectedBankrollSessionId = null;
  $("#session-detail-card").classList.add("hidden");
  showView("view-bankroll");
  renderBankrollDetail();
}

function setupBankroll() {
  $("#bankroll-card").addEventListener("click", enterBankroll);
  $("#bankroll-close").addEventListener("click", () => showView("view-home"));
}

// ───────────────────────── routing ─────────────────────────

async function boot() {
  setupHome();
  setupRunning();
  setupAlarm();
  setupRecord();
  setupEdit();
  setupRanges();
  setupRecentClicks();
  setupBankroll();

  refreshRecent();  // fire and forget; home view shows immediately

  const s = loadActive();
  if (!s) {
    showView("view-home");
    return;
  }
  const remaining = endAt(s) - Date.now();
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

// When page becomes visible again, re-check timer state
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const s = loadActive();
  if (!s) return;
  const currentView = $$(".view").find((v) => !v.classList.contains("hidden"));
  if (!currentView) return;
  if (currentView.id === "view-running") {
    const remaining = endAt(s) - Date.now();
    if (remaining <= 0 && !s.alarmStopped) enterAlarm();
  }
});

boot().catch((err) => {
  console.error("boot failed", err);
  showFatalError("启动失败：" + (err.message || err));
});
