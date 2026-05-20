import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// ───────────────────────── state ─────────────────────────

const LS_KEY = "poker.activeSession";        // {startedAt, plannedMinutes, alarmStopped}
const LS_EMAIL = "poker.lastEmail";
const LS_DURATION = "poker.lastDurationMins";

let currentUser = null;
let countdownRAF = null;
let alarmInterval = null;
let audioCtx = null;

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
  el.textContent = msg;
  el.className = "toast " + kind;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3000);
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

// ───────────────────────── auth ─────────────────────────

async function checkAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    return true;
  }
  return false;
}

async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  currentUser = data.user;
  localStorage.setItem(LS_EMAIL, email);
}

async function logout() {
  stopAlarm();
  await supabase.auth.signOut();
  currentUser = null;
  // keep LS_EMAIL for convenience
  clearActive();
}

// ───────────────────────── sessions CRUD ─────────────────────────

async function saveSessionToCloud(row) {
  if (!currentUser) throw new Error("not logged in");
  const { data, error } = await supabase
    .from("sessions")
    .insert([{ ...row, user_id: currentUser.id }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function listRecent(limit = 8) {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
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
      <div class="recent-row">
        <div>${formatDate(started)} · ${formatHM(started)}–${formatHM(ended)}</div>
        <div class="muted">${formatDuration(ended - started)}</div>
        <div class="pnl ${cls}">${sign}$${Math.abs(pnl).toFixed(2)}</div>
      </div>
    `;
  }).join("");
}

async function refreshRecent() {
  try {
    const list = await listRecent();
    renderRecent(list);
  } catch (err) {
    console.error(err);
    $("#recent-list").innerHTML = `<div class="recent-empty">加载失败：${err.message || err}</div>`;
  }
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

  $("#logout-btn").addEventListener("click", async () => {
    await logout();
    showView("view-auth");
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

// ───────────────────────── auth view ─────────────────────────

function setupAuth() {
  const lastEmail = localStorage.getItem(LS_EMAIL);
  if (lastEmail) $("#login-email").value = lastEmail;

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    const btn = $("#login-btn");
    btn.disabled = true;
    btn.textContent = "登录中...";
    try {
      await login(email, password);
      $("#login-password").value = "";
      await routeAfterAuth();
    } catch (err) {
      console.error(err);
      toast("登录失败：" + (err.message || err), "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "登录";
    }
  });
}

// ───────────────────────── routing ─────────────────────────

async function routeAfterAuth() {
  await refreshRecent();
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

async function boot() {
  setupAuth();
  setupHome();
  setupRunning();
  setupAlarm();
  setupRecord();

  const authed = await checkAuth();
  if (!authed) {
    showView("view-auth");
    return;
  }
  await routeAfterAuth();
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
  if (!s || !currentUser) return;
  const currentView = $$(".view").find((v) => !v.classList.contains("hidden"));
  if (!currentView) return;
  // if we were running and now we're past time → trigger alarm
  if (currentView.id === "view-running") {
    const remaining = endAt(s) - Date.now();
    if (remaining <= 0 && !s.alarmStopped) enterAlarm();
  }
});

boot().catch((err) => {
  console.error("boot failed", err);
  toast("启动失败：" + (err.message || err), "err");
});
