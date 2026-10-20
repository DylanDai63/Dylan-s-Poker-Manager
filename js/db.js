// Data access. One interface, two backends:
//   • Supabase (default) — tables from supabase/schema.sql, anon key, RLS off.
//   • Mock (?mock=1 in the URL) — in-memory sample data, nothing is saved.
//     For layout checks and demos when the database is unreachable.
//
// supabase-js is loaded lazily on the first query, so an unreachable CDN
// (no signal at the table) only breaks the bankroll, never the timer.

import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

export const MOCK = new URLSearchParams(location.search).get("mock") === "1";

// ───────────────────────── Supabase ─────────────────────────

function supabaseDb() {
  let clientPromise = null;
  function client() {
    if (!clientPromise) {
      clientPromise = import("https://esm.sh/@supabase/supabase-js@2.118.0")
        .then((m) => m.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } }))
        .catch((err) => { clientPromise = null; throw err; });   // retry on the next call
    }
    return clientPromise;
  }

  async function run(build) {
    const sb = await client();
    const { data, error } = await build(sb);
    if (error) throw error;
    return data;
  }

  return {
    name: "supabase",
    listVenues: () => run((sb) => sb.from("venues").select("*").order("sort_order").order("name")),
    listStakes: () => run((sb) => sb.from("stakes").select("*").order("sort_order").order("code")),
    listSessions: () => run((sb) => sb.from("sessions").select("*").order("started_at", { ascending: true })),
    insertSession: (row) => run((sb) => sb.from("sessions").insert([row]).select().single()),
    updateSession: (id, patch) => run((sb) => sb.from("sessions").update(patch).eq("id", id).select().single()),
    deleteSession: (id) => run((sb) => sb.from("sessions").delete().eq("id", id)),
    insertVenue: (row) => run((sb) => sb.from("venues").insert([row]).select().single()),
    insertStakes: (row) => run((sb) => sb.from("stakes").insert([row]).select().single()),
    latestKeepalive: async () => {
      const rows = await run((sb) => sb.from("keepalive_log").select("pinged_at,source").order("pinged_at", { ascending: false }).limit(1));
      return rows && rows[0] ? rows[0] : null;
    },
    ping: (source) => run((sb) => sb.rpc("keepalive", { src: source })),
  };
}

// ───────────────────────── Mock ─────────────────────────

function mockDb() {
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  const venues = [
    { id: "v-wc", name: "Wind Creek", kind: "live", sort_order: 1 },
    { id: "v-hg", name: "Home game", kind: "live", sort_order: 2 },
    { id: "v-on", name: "Online poker", kind: "online", sort_order: 3 },
  ];
  const stakes = [
    { id: "s-z2", code: "z2", bb_usd: 0.02, label: "0.01/0.02 急速桌", sort_order: 1 },
    { id: "s-nl2", code: "NL2", bb_usd: 0.02, label: "0.01/0.02 常规桌", sort_order: 2 },
  ];
  // Sample sessions over the last ~7 weeks so the chart has something to show.
  const day = 86400000;
  const now = Date.now();
  const mk = (daysAgo, venue, hours, buyIn, cashOut, extra = {}) => {
    const start = new Date(now - daysAgo * day - hours * 3600000);
    return {
      id: uuid(), venue_id: venue, stakes_id: null,
      started_at: start.toISOString(), ended_at: new Date(start.getTime() + hours * 3600000).toISOString(),
      buy_in: buyIn, cash_out: cashOut, buy_in_bb: null, cash_out_bb: null, hands: null,
      planned_duration_minutes: 180, break_minutes: 0, notes: null, ...extra,
    };
  };
  const online = (daysAgo, hours, bbIn, bbOut, hands, stake = "s-z2") =>
    mk(daysAgo, "v-on", hours, bbIn * 0.02, bbOut * 0.02, { stakes_id: stake, buy_in_bb: bbIn, cash_out_bb: bbOut, hands });
  let sessions = [
    mk(48, "v-wc", 4.5, 300, 512),
    mk(45, "v-hg", 5, 100, 60, { break_minutes: 20, notes: "老王家" }),
    online(44, 1.5, 100, 162, 410),
    mk(41, "v-wc", 3, 300, 180),
    online(39, 2, 100, 71, 620, "s-nl2"),
    online(37, 1, 100, 131, 300),
    mk(33, "v-wc", 6, 300, 745, { break_minutes: 30 }),
    mk(30, "v-hg", 4, 100, 155),
    online(27, 2.5, 200, 240, 900),
    mk(22, "v-wc", 3.5, 300, 265),
    online(19, 1, 100, 48, 350),
    mk(14, "v-hg", 5, 100, 20),
    online(11, 2, 100, 189, 700),
    mk(7, "v-wc", 5, 300, 640),
    online(3, 1.5, 100, 118, 480, "s-nl2"),
    mk(1, "v-wc", 4, 300, 410),
  ];
  let keepalive = { pinged_at: new Date(now - 5 * 3600000).toISOString(), source: "pc-task" };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const byStart = (a, b) => new Date(a.started_at) - new Date(b.started_at);

  return {
    name: "mock",
    listVenues: async () => clone(venues),
    listStakes: async () => clone(stakes),
    listSessions: async () => clone([...sessions].sort(byStart)),
    insertSession: async (row) => { const s = { id: uuid(), created_at: new Date().toISOString(), ...row }; sessions.push(s); return clone(s); },
    updateSession: async (id, patch) => { const s = sessions.find((x) => x.id === id); if (!s) throw new Error("not found"); Object.assign(s, patch); return clone(s); },
    deleteSession: async (id) => { sessions = sessions.filter((x) => x.id !== id); },
    insertVenue: async (row) => { const v = { id: uuid(), sort_order: venues.length + 1, ...row }; venues.push(v); return clone(v); },
    insertStakes: async (row) => { const s = { id: uuid(), sort_order: stakes.length + 1, ...row }; stakes.push(s); return clone(s); },
    latestKeepalive: async () => clone(keepalive),
    ping: async (source) => { keepalive = { pinged_at: new Date().toISOString(), source }; return keepalive.pinged_at; },
  };
}

export const db = MOCK ? mockDb() : supabaseDb();
