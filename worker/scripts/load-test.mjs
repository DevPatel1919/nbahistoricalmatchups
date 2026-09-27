// Load and abuse test for the duel Worker (F09 Session 8). Runs against a
// local `wrangler dev` or a deployed staging Worker and prints a JSON report:
// latency percentiles and status counts per route, then a list of abuse probes
// that must each hold. Exits 1 if any request answered 5xx or any probe failed.
//
//   node scripts/load-test.mjs [--api <url>] [--players 20] [--seconds 60] [--out report.json]
//
// Load: `players` guests play solo and bot sets back to back (and read the
// boards), while a quarter as many accounts reach ranked and play each other
// through the real queue. Accounts need the localhost auth doubles
// (AUTH_TEST_DOUBLES), so against staging the ranked part is skipped.
//
// Locally every request comes from one address, so each virtual player sends
// its own cf-connecting-ip; Cloudflare replaces that header on a deployed
// Worker, where every player shares the test machine's address. Raise
// RATE_LIMIT_SCALE on staging for the run, or the per-IP limits (correctly)
// answer 429. Restore it to "1" afterwards.
//
// Local run (from worker/):
//   node scripts/seed-local.mjs --fixture --fresh --persist-to .wrangler/load
//   npx wrangler dev --local --port 8789 --persist-to .wrangler/load --var GUEST_TOKEN_SECRET:load-guest-secret-0123456789 \
//     --var SET_TOKEN_SECRET:load-set-secret-0123456789ab --var EMAIL_HASH_SECRET:load-email-secret-0123456789 \
//     --var AUTH_TEST_DOUBLES:1 --var RATE_LIMIT_SCALE:100 --var LEADERBOARD_CACHE_SECONDS:60 //     --var ALLOWED_ORIGINS:http://localhost:4317 --var APP_ORIGIN:http://localhost:4317
//   node scripts/load-test.mjs --api http://localhost:8789

import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const API = arg("api", "http://localhost:8789").replace(/\/+$/, "");
const PLAYERS = Number(arg("players", "20"));
const SECONDS = Number(arg("seconds", "60"));
const OUT = arg("out", null);
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API);

// ---------------------------------------------------------------------------
// Measured requests
// ---------------------------------------------------------------------------

const samples = new Map(); // route -> { ms: number[], status: Record<number, number> }

async function call(route, path, { method = "GET", body, token, ip, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h["content-type"] = "application/json";
  if (token) h.authorization = "Bearer " + token;
  if (ip) h["cf-connecting-ip"] = ip;
  const started = performance.now();
  let status = 0;
  let json = null;
  try {
    const r = await fetch(API + path, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    status = r.status;
    const text = await r.text();
    json = text ? JSON.parse(text) : null;
    return { status, body: json, text };
  } catch {
    return { status: 0, body: null, text: "" };
  } finally {
    const s = samples.get(route) ?? { ms: [], status: {} };
    s.ms.push(performance.now() - started);
    // Statuses are labelled with the API's error code, e.g. "429 rate_limited".
    const label = status >= 400 && json?.error ? status + " " + json.error : String(status);
    s.status[label] = (s.status[label] ?? 0) + 1;
    samples.set(route, s);
  }
}

/**
 * A 5xx or a failed connection. "503 ranked_exhausted" is not one: every
 * account has been shown, or is cooling down from, every ranked puzzle, which
 * the small fixture pool reaches within seconds and is the designed answer.
 */
function isServerError(label) {
  const status = parseInt(label, 10);
  return (status >= 500 || status === 0) && !label.endsWith("ranked_exhausted");
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);
const round = (n) => (n === null ? null : Math.round(n));

function summary() {
  const routes = {};
  let total = 0;
  let serverErrors = 0;
  for (const [route, s] of [...samples].sort()) {
    const sorted = [...s.ms].sort((a, b) => a - b);
    total += sorted.length;
    serverErrors += Object.entries(s.status).filter(([k]) => isServerError(k)).reduce((n, [, v]) => n + v, 0);
    routes[route] = { n: sorted.length, p50: round(pct(sorted, 50)), p95: round(pct(sorted, 95)), p99: round(pct(sorted, 99)), max: round(sorted.at(-1)), status: s.status };
  }
  return { total, serverErrors, routes };
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

let ipCounter = 0;
const nextIp = () => "198.51.100." + (++ipCounter % 250);
const key = () => crypto.randomUUID();
const sides = ["home", "away"];
const tiers = ["lean", "confident", "lock"];
const randomPicks = (puzzles) =>
  puzzles.map((p) => ({ puzzleId: p.puzzleId, side: sides[Math.floor(Math.random() * 2)], confidence: tiers[Math.floor(Math.random() * 3)] }));
const ERAS = ["1998-2004", "2005-2011", "2012-2016", "2017-2021", "2022-2026"];

async function guestPlayer(deadline) {
  const ip = nextIp();
  const g = await call("POST /v1/guests", "/v1/guests", { method: "POST", ip });
  if (g.status !== 201) return;
  const token = g.body.guestToken;
  for (let i = 0; Date.now() < deadline; i++) {
    const mode = i % 2 ? "bot" : "solo";
    const draw = i % 3 ? { kind: "random" } : { kind: "era", era: ERAS[i % ERAS.length] };
    const set = await call("POST /v1/sets " + mode, "/v1/sets", { method: "POST", body: { mode, draw }, token, ip });
    if (set.status !== 201) continue;
    await call("POST submission " + mode, "/v1/duels/" + set.body.duelId + "/submission", {
      method: "POST", token, ip, headers: { "idempotency-key": key() }, body: { setToken: set.body.setToken, picks: randomPicks(set.body.puzzles) },
    });
    await call("GET /v1/duels/:id", "/v1/duels/" + set.body.duelId, { token, ip });
    if (i % 5 === 0) await call("GET /v1/leaderboard", "/v1/leaderboard?board=" + (i % 10 ? "daily" : "30d"), { ip });
  }
}

async function signIn(ip) {
  const email = "load." + key() + "@example.com";
  const sent = await call("POST /v1/auth/magic-link", "/v1/auth/magic-link", { method: "POST", ip, body: { email, turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" } });
  if (sent.status !== 202) return null;
  const outbox = await call("GET /v1/dev/outbox", "/v1/dev/outbox?to=" + encodeURIComponent(email), { ip });
  const token = /#token=(ml_[A-Za-z0-9_-]+)/.exec(outbox.body?.text ?? "")?.[1];
  if (!token) return null;
  const v = await call("POST /v1/auth/verify", "/v1/auth/verify", { method: "POST", ip, body: { token } });
  return v.status === 200 ? v.body.sessionToken : null;
}

const rankedOutcomes = {};
async function rankedPlayer(deadline, n) {
  const ip = nextIp();
  const token = await signIn(ip);
  if (!token) return;
  // Eligibility: ten completed sets and a name.
  for (let i = 0; i < 10; i++) {
    const set = await call("POST /v1/sets solo", "/v1/sets", { method: "POST", body: { mode: "solo", draw: { kind: "random" } }, token, ip });
    if (set.status !== 201) return;
    await call("POST submission solo", "/v1/duels/" + set.body.duelId + "/submission", {
      method: "POST", token, ip, headers: { "idempotency-key": key() }, body: { setToken: set.body.setToken, picks: randomPicks(set.body.puzzles) },
    });
  }
  const named = await call("POST /v1/account/display-name", "/v1/account/display-name", { method: "POST", token, ip, body: { displayName: "Load " + n + " " + key().slice(0, 6) } });
  if (named.status !== 200) return;
  const waiting = [];
  while (Date.now() < deadline) {
    const set = await call("POST /v1/sets ranked", "/v1/sets", { method: "POST", body: { mode: "ranked" }, token, ip });
    const outcome = set.status === 201 ? (set.body.opponent ? "joined" : "queued") : set.body?.error ?? String(set.status);
    rankedOutcomes[outcome] = (rankedOutcomes[outcome] ?? 0) + 1;
    if (set.status !== 201) {
      // Queue full or ranked puzzles exhausted: settle what is waiting and pause.
      for (const id of waiting.splice(0)) await call("POST stop-waiting", "/v1/duels/" + id + "/stop-waiting", { method: "POST", token, ip });
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    const locked = await call("POST submission ranked", "/v1/duels/" + set.body.duelId + "/submission", {
      method: "POST", token, ip, headers: { "idempotency-key": key() }, body: { setToken: set.body.setToken, picks: randomPicks(set.body.puzzles) },
    });
    if (locked.body?.state === "waiting") waiting.push(set.body.duelId);
    for (const id of waiting) await call("GET /v1/duels/:id ranked", "/v1/duels/" + id, { token, ip });
  }
  for (const id of waiting) await call("POST stop-waiting", "/v1/duels/" + id + "/stop-waiting", { method: "POST", token, ip });
}

// ---------------------------------------------------------------------------
// Abuse probes: each one states what must hold
// ---------------------------------------------------------------------------

const probes = [];
function probe(name, ok, detail = "") {
  probes.push({ name, ok: Boolean(ok), detail });
}

async function abuseProbes() {
  const ip = nextIp();
  const token = (await call("POST /v1/guests", "/v1/guests", { method: "POST", ip })).body?.guestToken;
  const other = (await call("POST /v1/guests", "/v1/guests", { method: "POST", ip: nextIp() })).body?.guestToken;
  const set = await call("probe", "/v1/sets", { method: "POST", token, ip, body: { mode: "bot", draw: { kind: "random" } } });
  probe("a set is issued", set.status === 201);
  probe("no answer, model probability, or partition in a pre-lock payload", !/actualWinner|modelHomeWinProbability|modelInSample|partition|"band"/.test(set.text));

  const sub = (k, body, t = token) =>
    call("probe", "/v1/duels/" + set.body.duelId + "/submission", { method: "POST", token: t, ip, headers: k ? { "idempotency-key": k } : {}, body });
  const picks = randomPicks(set.body.puzzles);
  probe("another participant cannot read the set", (await call("probe", "/v1/duels/" + set.body.duelId, { token: other, ip })).status === 404);
  probe("a forged set token is refused", (await sub(key(), { setToken: set.body.setToken.slice(0, -2) + "xx", picks })).body?.error === "set_token_invalid");
  probe("another participant's submission is refused", (await sub(key(), { setToken: set.body.setToken, picks }, other)).status === 403);
  probe("a submission without an idempotency key is refused", (await sub(null, { setToken: set.body.setToken, picks })).status === 400);
  probe("an oversized body is refused", (await sub(key(), JSON.stringify({ setToken: set.body.setToken, picks, pad: "x".repeat(10_000) }))).status === 400);
  probe("picks for other puzzles are refused", (await sub(key(), { setToken: set.body.setToken, picks: picks.map((p, i) => ({ ...p, puzzleId: i ? p.puzzleId : "p_other" })) })).status === 400);

  // Ten racing submissions with different keys: exactly one wins.
  const racing = await Promise.all(Array.from({ length: 10 }, () => sub(key(), { setToken: set.body.setToken, picks })));
  const winners = racing.filter((r) => r.status === 200);
  probe("ten racing submissions: exactly one is accepted", winners.length === 1, racing.map((r) => r.status).join(","));
  probe("the losers are told it was already submitted", racing.filter((r) => r.status !== 200).every((r) => r.body?.error === "already_submitted"));
  probe("the Sparring Partner is disclosed on the result", /Sparring Partner/.test(winners[0]?.text ?? "") && /not a model prediction/i.test(winners[0]?.text ?? ""));
  probe("the model benchmark is on the result", winners[0]?.body?.result?.model?.label === "Pre-game model");

  probe("a bad bearer token is 401", (await call("probe", "/v1/sets", { method: "POST", token: "nope", ip, body: { mode: "solo", draw: { kind: "random" } } })).status === 401);
  probe("the review queue is invisible without the admin token", (await call("probe", "/v1/admin/flags", { ip })).status === 404);
  probe("ranked needs an account", (await call("probe", "/v1/sets", { method: "POST", token, ip, body: { mode: "ranked" } })).body?.error === "account_required");
  probe("account deletion needs a session", (await call("probe", "/v1/account/delete", { method: "POST", token, ip, body: { confirm: true } })).status === 401);

  // A burst of guest creation from one address meets the limit with 429, never 5xx.
  const burstIp = "203.0.113.77";
  const statuses = [];
  for (let i = 0; i < 1200; i++) {
    const r = await call("POST /v1/guests (burst)", "/v1/guests", { method: "POST", ip: burstIp });
    statuses.push(r.status);
    if (r.status === 429) break;
  }
  const limited = statuses.at(-1) === 429;
  probe("a guest-creation burst from one address is limited with 429", limited, statuses.length + " requests before 429");
  probe("the burst produced no server errors", statuses.every((s) => s < 500 && s > 0));
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const health = await call("GET /v1/health", "/v1/health");
if (health.status !== 200) {
  console.error("The Worker at " + API + " is not answering /v1/health.");
  process.exit(1);
}
// Ranked players sign in through the local email outbox; a player whose
// sign-in fails (no auth doubles) simply stops.
const accounts = LOCAL;
const started = Date.now();
const deadline = started + SECONDS * 1000;
await Promise.all([
  ...Array.from({ length: PLAYERS }, () => guestPlayer(deadline)),
  ...(accounts ? Array.from({ length: Math.max(2, Math.floor(PLAYERS / 4)) }, (_, n) => rankedPlayer(deadline, n)) : []),
]);
const elapsed = (Date.now() - started) / 1000;
const load = summary();

let cron = null;
if (LOCAL) {
  // Runs the scheduled handler (settle, then the integrity sweep) once.
  const t = performance.now();
  const r = await fetch(API + "/cdn-cgi/local/scheduled").catch(() => null);
  cron = { status: r?.status ?? 0, ms: Math.round(performance.now() - t) };
}

samples.clear();
await abuseProbes();

const report = {
  api: API,
  players: PLAYERS,
  seconds: SECONDS,
  requests: load.total,
  requestsPerSecond: Math.round(load.total / elapsed),
  serverErrors: load.serverErrors,
  rankedOutcomes,
  cron,
  routes: load.routes,
  probes,
};
const text = JSON.stringify(report, null, 2);
console.log(text);
if (OUT) writeFileSync(OUT, text + "\n", "utf8");
const failed = probes.filter((p) => !p.ok);
if (load.serverErrors > 0 || failed.length > 0) {
  console.error("FAILED: " + load.serverErrors + " server errors, " + failed.length + " probes: " + failed.map((p) => p.name).join("; "));
  process.exit(1);
}
