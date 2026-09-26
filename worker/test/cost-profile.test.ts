// F09 Session 8: cost profile. Every API flow runs against metered D1 and KV
// bindings (meter.ts), so the numbers are what Cloudflare would bill: D1
// queries, rows read and written, and KV reads and writes. A month of rated
// play at launch scale is then seeded straight into D1 to measure the
// scheduled sweep and the boards. The budgets asserted here are regression
// guards; the measured figures and their prices are recorded in the F09 brief
// (Session 8 handoff record).

import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { runIntegritySweep } from "../src/integrity";
import { leaderboard } from "../src/leaderboard";
import { SETTLE_PER_SWEEP, settleDue } from "../src/matches";
import { TURNSTILE_DUMMY_TOKEN } from "../src/services";
import { account, auth, call, emptyQueue, guest, lock, mailer, picksFor, post, ranked, unique } from "./helpers";
import { measure, type Usage } from "./meter";

const DAY = 24 * 3600 * 1000;
const report: Record<string, Usage> = {};

/**
 * Console output from inside workerd does not reach the terminal. To refresh
 * the table in the F09 brief, set this to true: the figures then print as a
 * failing assertion's diff. Leave it false.
 */
const PRINT = false;

function show() {
  if (PRINT) expect.soft(JSON.stringify(report, null, 1)).toBe("(figures above)");
}

/** D1 allows 1,000 queries per Worker invocation on the paid plan (50 on the free plan). */
const D1_QUERIES_PER_INVOCATION = 1000;

describe("per-request cost", () => {
  it("measures every play, account, and board flow", async () => {
    await emptyQueue();
    await env.DB.prepare("DELETE FROM ranked_reveals").run();

    let token = "";
    report["POST /v1/guests"] = await measure(async (m) => {
      token = (await call("/v1/guests", { method: "POST", env: m })).body.guestToken;
    });
    let set: { duelId: string; setToken: string; puzzles: { puzzleId: string }[] } = { duelId: "", setToken: "", puzzles: [] };
    report["POST /v1/sets solo"] = await measure(async (m) => {
      set = (await call("/v1/sets", { ...post({ mode: "solo", draw: { kind: "random" } }, token), env: m })).body;
    });
    report["POST submission solo"] = await measure(async (m) => {
      const r = await call("/v1/duels/" + set.duelId + "/submission", {
        method: "POST", env: m,
        headers: { ...auth(token), "idempotency-key": unique() },
        body: JSON.stringify({ setToken: set.setToken, picks: picksFor(set.puzzles) }),
      });
      expect(r.body.state).toBe("revealed");
    });
    report["GET /v1/duels/:id revealed"] = await measure((m) => call("/v1/duels/" + set.duelId, { headers: auth(token), env: m }));

    report["POST /v1/sets bot"] = await measure(async (m) => {
      set = (await call("/v1/sets", { ...post({ mode: "bot", draw: { kind: "era", era: "2012-2016" } }, token), env: m })).body;
    });
    report["POST submission bot"] = await measure(async (m) => {
      const r = await call("/v1/duels/" + set.duelId + "/submission", {
        method: "POST", env: m,
        headers: { ...auth(token), "idempotency-key": unique() },
        body: JSON.stringify({ setToken: set.setToken, picks: picksFor(set.puzzles) }),
      });
      expect(r.body.state).toBe("revealed");
    });

    const email = "cost." + unique() + "@example.com";
    report["POST /v1/auth/magic-link"] = await measure((m) =>
      call("/v1/auth/magic-link", { ...post({ email, turnstileToken: TURNSTILE_DUMMY_TOKEN }), env: m }),
    );
    const link = /#token=(ml_[A-Za-z0-9_-]+)/.exec([...mailer.sent].reverse().find((x) => x.to === email)!.text)![1];
    let session = "";
    report["POST /v1/auth/verify (new account, guest merge)"] = await measure(async (m) => {
      session = (await call("/v1/auth/verify", { ...post({ token: link, guestToken: token }), env: m })).body.sessionToken;
    });
    report["GET /v1/account"] = await measure((m) => call("/v1/account", { headers: auth(session), env: m }));

    const creator = await account();
    const joiner = await account();
    let rankedSet: typeof set = set;
    report["POST /v1/sets ranked (queues)"] = await measure(async (m) => {
      rankedSet = (await call("/v1/sets", { ...post({ mode: "ranked" }, creator.token), env: m })).body;
    });
    report["POST submission ranked (waits)"] = await measure(async (m) => {
      const r = await call("/v1/duels/" + rankedSet.duelId + "/submission", {
        method: "POST", env: m,
        headers: { ...auth(creator.token), "idempotency-key": unique() },
        body: JSON.stringify({ setToken: rankedSet.setToken, picks: picksFor(rankedSet.puzzles) }),
      });
      expect(r.body.state).toBe("waiting");
    });
    let joined: typeof set = set;
    report["POST /v1/sets ranked (joins)"] = await measure(async (m) => {
      joined = (await call("/v1/sets", { ...post({ mode: "ranked" }, joiner.token), env: m })).body;
    });
    expect(joined.puzzles).toEqual(rankedSet.puzzles);
    report["POST submission ranked (settles, rated)"] = await measure(async (m) => {
      const r = await call("/v1/duels/" + joined.duelId + "/submission", {
        method: "POST", env: m,
        headers: { ...auth(joiner.token), "idempotency-key": unique() },
        body: JSON.stringify({ setToken: joined.setToken, picks: picksFor(joined.puzzles) }),
      });
      expect(r.body.state).toBe("revealed");
    });
    const again = await ranked(creator);
    await lock(creator.token, again.body, picksFor(again.body.puzzles));
    report["GET /v1/duels/:id waiting poll"] = await measure((m) => call("/v1/duels/" + again.body.duelId, { headers: auth(creator.token), env: m }));

    report["GET /v1/leaderboard 30d (uncached)"] = await measure((m) => call("/v1/leaderboard?board=30d", { env: m }));
    report["GET /v1/leaderboard daily (cached hit)"] = await measure(async (m) => {
      await call("/v1/leaderboard?board=daily", { env: { ...m, LEADERBOARD_CACHE_SECONDS: "60" } });
    });

    const host = await guest();
    const friendSet = (await call("/v1/sets", post({ mode: "friend", draw: { kind: "random" } }, host))).body;
    const waiting = (await lock(host, friendSet, picksFor(friendSet.puzzles))).body;
    const invite = waiting.waiting.invitePath.split("#invite=")[1];
    const pal = await guest();
    report["POST /v1/invites/accept"] = await measure((m) => call("/v1/invites/accept", { ...post({ invite }, pal), env: m }));
    show();

    // Budgets: generous against today's figures, tight enough to catch a
    // per-row query loop or a scan of history creeping into a request.
    for (const [flow, u] of Object.entries(report)) {
      expect(u.d1Queries, flow).toBeLessThan(60);
      expect(u.rowsRead, flow).toBeLessThan(200);
      expect(u.kvWrites, flow).toBeLessThanOrEqual(3);
    }
  });

  it("keeps the scheduled settler inside D1's per-invocation query limit", async () => {
    await emptyQueue();
    await env.DB.prepare("DELETE FROM ranked_reveals").run();
    const creator = await account();
    const joiner = await account();
    const set = (await ranked(creator)).body;
    await lock(creator.token, set, picksFor(set.puzzles));
    const joined = (await ranked(joiner)).body;
    expect(joined.puzzles).toEqual(set.puzzles);
    // The joiner never locks in: a rated forfeit, settled by the cron alone.
    await env.DB.prepare("UPDATE duels SET expires_at = ? WHERE id = ?").bind(Date.now() - 1, joined.duelId).run();
    let settled = 0;
    const usage = await measure(async (m) => {
      settled = await settleDue(m, Date.now(), 1);
    });
    expect(settled).toBe(1);
    report["cron: settle one rated forfeit"] = usage;
    // Each run settles at most SETTLE_PER_SWEEP matches and then sweeps.
    expect(SETTLE_PER_SWEEP * usage.d1Queries + 100).toBeLessThan(D1_QUERIES_PER_INVOCATION);
  });
});

// ---------------------------------------------------------------------------
// A month of rated play at launch scale, seeded straight into D1
// ---------------------------------------------------------------------------

const SCALE_ACCOUNTS = 2000;
const SCALE_MATCHES_PER_DAY = 1000;
const SCALE_DAYS = 30;

/** 30,000 rated human-vs-human matches over 30 days among 2,000 accounts; no pair meets twice. */
async function seedMonth(now: number) {
  const n = SCALE_MATCHES_PER_DAY * SCALE_DAYS;
  const step = Math.floor((SCALE_DAYS * DAY) / n);
  const seq = (count: number) => `WITH RECURSIVE s(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM s WHERE i < ${count - 1})`;
  // Match i: creator i mod A, opponent a distinct account; resolved `i * step` ms ago.
  const c = `('sc' || (i % ${SCALE_ACCOUNTS}))`;
  const o = `('sc' || ((i % ${SCALE_ACCOUNTS} + 1 + (i / ${SCALE_ACCOUNTS}) % ${SCALE_ACCOUNTS - 1}) % ${SCALE_ACCOUNTS}))`;
  const t = `(${now} - i * ${step})`;
  const statements = [
    `INSERT INTO accounts (id, email_hash, display_name, display_name_key, created_at)
       ${seq(SCALE_ACCOUNTS)} SELECT 'sc' || i, 'eh-sc' || i, 'Scale ' || i, 'scale ' || i, 0 FROM s`,
    `INSERT INTO ratings (account_id, rating, rated_duels, updated_at)
       ${seq(SCALE_ACCOUNTS)} SELECT 'sc' || i, 1200, 30, 0 FROM s`,
    `INSERT INTO matches (id, kind, puzzle_ids, pool_version, draw_kind, creator_rating, created_at, open_until)
       ${seq(n)} SELECT 'msc' || i, 'ranked', '[]', 'duel-pool-v1', 'random', 1200, ${t} - 600000, ${t} FROM s`,
    ...(["creator", "opponent"] as const).flatMap((seat) => {
      const who = seat === "creator" ? c : o;
      const duel = `('dsc${seat[0]}' || i)`;
      return [
        `INSERT INTO duels (id, mode, partition, draw_kind, puzzle_ids, pool_version, issued_to, issued_at, expires_at, match_id)
           ${seq(n)} SELECT ${duel}, 'ranked', 'ranked', 'random', '[]', 'duel-pool-v1', 'a:' || ${who}, ${t} - 300000, ${t}, 'msc' || i FROM s`,
        `INSERT INTO match_seats (match_id, seat, participant, duel_id, joined_at)
           ${seq(n)} SELECT 'msc' || i, '${seat}', 'a:' || ${who}, ${duel}, ${t} - 300000 FROM s`,
        `INSERT INTO submissions (duel_id, participant, idempotency_key, submitted_at, ms_to_submit, total_points, result)
           ${seq(n)} SELECT ${duel}, 'a:' || ${who}, 'k' || ${duel}, ${t}, 120000, 40, '{}' FROM s`,
        `INSERT INTO play_metrics (duel_id, participant, account_id, submitted_at, ms_to_submit, picks, correct, lock_picks, lock_correct,
             confident_picks, lean_picks, model_agree, confidence_entropy, points, model_points)
           ${seq(n)} SELECT ${duel}, 'a:' || ${who}, ${who}, ${t}, 120000, 5, 3, 1, 1, 2, 2, 4, 1.5, 40, 60 FROM s`,
        `INSERT INTO rating_changes (match_id, account_id, rating_before, rating_after, delta, k, rated_duels_before, created_at)
           ${seq(n)} SELECT 'msc' || i, ${who}, 1200, 1200 + ${seat === "creator" ? "12" : "-12"}, ${seat === "creator" ? "12" : "-12"}, 24, 29, ${t} FROM s`,
      ];
    }),
    `INSERT INTO match_resolutions (match_id, settled_by, outcome, rated, resolved_at)
       ${seq(n)} SELECT 'msc' || i, 'both-locked', 'creator', 1, ${t} FROM s`,
  ];
  for (const sql of statements) await env.DB.prepare(sql).run();
}

describe("a month of rated play (30,000 matches, 2,000 accounts)", () => {
  const now = Date.now();
  beforeAll(async () => {
    await emptyQueue();
    await seedMonth(now);
  }, 120_000);

  it("measures the sweep, the settler, and both boards", async () => {
    const scale: Record<string, Usage> = {};
    scale["scheduled sweep"] = await measure((m) => runIntegritySweep(m, now));
    scale["scheduled settler (nothing due)"] = await measure((m) => settleDue(m, now));
    scale["board 30d (uncached)"] = await measure((m) => leaderboard(m, "30d", now));
    scale["board daily (uncached)"] = await measure((m) => leaderboard(m, "daily", now));
    Object.assign(report, scale);
    show();

    // The sweep is a fixed handful of queries, not one per account: D1 allows
    // 1,000 per invocation and this month has 1,000+ active accounts a day.
    expect(scale["scheduled sweep"].d1Queries).toBeLessThan(20);
    expect(scale["scheduled sweep"].rowsRead).toBeLessThan(300_000);
    // Bounded windows: none of these reads all of history.
    expect(scale["scheduled settler (nothing due)"].rowsRead).toBeLessThan(30_000);
    expect(scale["board daily (uncached)"].rowsRead).toBeLessThan(30_000);
    expect(scale["board 30d (uncached)"].rowsRead).toBeLessThan(450_000);
  }, 120_000);
});
