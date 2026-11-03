// Chart.js wrapper for the bankroll lines. `Chart` is the UMD global loaded by
// index.html (cdnjs, pinned). Series come from bankroll-core.buildSeries; this
// file only maps them onto Chart.js and the dark theme.

import { fmtUsd } from "./bankroll-core.js?v=25";

const charts = new WeakMap();   // canvas → Chart, so re-renders destroy the old one

const pad = (n) => String(n).padStart(2, "0");
const tickLabel = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };
const titleLabel = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function withAlpha(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function showEmpty(canvas, text) {
  const wrap = canvas.parentElement;
  let el = wrap.querySelector(".chart-empty");
  if (!el) {
    el = document.createElement("div");
    el.className = "chart-empty";
    wrap.appendChild(el);
  }
  el.textContent = text;
  canvas.classList.add("hidden");
}

function clearEmpty(canvas) {
  const el = canvas.parentElement.querySelector(".chart-empty");
  if (el) el.remove();
  canvas.classList.remove("hidden");
}

// series: { labels: ["", iso…], sessions: [...], datasets: [{label, color, data, own, venueId}] }
// mini: sparkline on the home card (no axes, no tooltip, area fill).
// onPointTap(session): full chart only; a click on a session's x opens it.
// Without it a tap just shows the tooltip.
export function renderBankrollChart(canvas, series, { mini = false, onPointTap = null, noVenuesText = "没选场地", noSessionsText = "还没记录过 session" } = {}) {
  const old = charts.get(canvas);
  if (old) { old.destroy(); charts.delete(canvas); }

  if (series.datasets.length === 0) { showEmpty(canvas, noVenuesText); return null; }
  if (series.sessions.length === 0) { showEmpty(canvas, noSessionsText); return null; }
  if (!window.Chart) { showEmpty(canvas, "图表库没加载(离线?)"); return null; }
  clearEmpty(canvas);

  const muted = cssVar("--muted", "#b3b3b8");
  const grid = cssVar("--border-2", "#3a3a3e");
  const neg = cssVar("--neg", "#ff6b6b");

  const datasets = series.datasets.map((ds) => {
    const isTotal = ds.venueId === null && !mini;   // the sparkline is one plain line
    return {
      label: ds.label,
      data: ds.data,
      borderColor: ds.color,
      backgroundColor: ds.color,
      borderWidth: isTotal ? 2.5 : 2,
      pointRadius: ds.own.map((o, i) => (o && !mini && i > 0 ? 3 : 0)),
      pointHoverRadius: mini ? 0 : 6,
      pointBackgroundColor: ds.color,
      pointBorderColor: ds.color,
      tension: 0,
      fill: mini ? { target: "origin", above: withAlpha(ds.color, 0.14), below: withAlpha(neg, 0.14) } : false,
    };
  });

  const chart = new Chart(canvas, {
    type: "line",
    data: { labels: series.labels.map((l, i) => (i === 0 ? "" : tickLabel(l))), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      events: mini ? [] : ["mousemove", "mouseout", "click", "touchstart", "touchmove"],
      interaction: { mode: "index", intersect: false },
      layout: { padding: mini ? 2 : { right: 10, top: 6 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: !mini,
          backgroundColor: cssVar("--bg-3", "#202022"),
          titleColor: cssVar("--fg", "#fdfdfd"),
          bodyColor: cssVar("--fg", "#fdfdfd"),
          borderColor: grid,
          borderWidth: 1,
          callbacks: {
            title: (items) => {
              const i = items.length ? items[0].dataIndex : 0;
              return i === 0 ? "起点" : titleLabel(series.labels[i]);
            },
            label: (item) => ` ${item.dataset.label}: ${fmtUsd(item.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          display: !mini,
          ticks: { color: muted, maxTicksLimit: 8, maxRotation: 0, autoSkip: true, font: { size: 11 } },
          grid: { display: false },
          border: { color: grid },
        },
        y: {
          display: !mini,
          ticks: { color: muted, font: { size: 11 }, callback: (v) => (v < 0 ? `−$${-v}` : `$${v}`) },
          grid: { color: (ctx) => (ctx.tick && ctx.tick.value === 0 ? muted : grid) },
          border: { display: false },
        },
      },
      onClick: (_evt, elements) => {
        if (!onPointTap || !elements.length) return;
        const idx = elements[0].index;
        if (idx > 0 && series.sessions[idx - 1]) onPointTap(series.sessions[idx - 1]);
      },
    },
  });
  charts.set(canvas, chart);
  return chart;
}
