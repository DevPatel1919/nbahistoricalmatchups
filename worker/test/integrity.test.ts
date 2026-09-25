// F09 Session 7 acceptance: leaderboard and anti-abuse enforcement. Anomaly
// metrics are recorded for all rated play; a synthetic scripted-submission run,
// a lookup cheater, and a synthetic collusion ring are detected end to end
// through the API; flags never block play or move a rating; the board excludes
// flagged accounts until a reviewer clears them.

import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ELO_START } from "../../frontend/src/duel";
import worker from "../src/index";
import { purgeExpired, raiseFlags, runIntegritySweep } from "../src/integrity";
import { MULTI_ACCOUNT_FLAG_AT } from "../src/integrity-rules";
import { BOARD_MIN_DUELS } from "../src/leaderboard";
import { REPEAT_PAIR_WINDOW_MS, settleMatch } from "../src/matches";
import { sha256Hex } from "../src/tokens";
import {
  ANSWERS,
  account,
  auth,
  call,
  emptyQueue,
  lock,
  matchOf,
  mixedPicks,
  post,
  ranked,
  rightPicks,
  thinkFor,
  unique,
  wrongPicks,
  type Player,
  type PuzzleRef,
} from "./helpers";

const ADMIN = { authorization: "Bearer test-admin-token-0123456789abcdef0123" };
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

type FlagRow = { id: string; kind: string; related: string; status: string; evidence: string };

async function flagsOf(p: Player, status = "open"): Promise<FlagRow[]> {
  const rows = await env.DB.prepare("SELECT id, kind, related, status, evidence FROM integrity_flags WHERE account_id = ? AND status = ? ORDER BY kind, related")
    .bind(p.accountId, status)
    .all<FlagRow>();
  return rows.results;
}
const kindsOf = async (p: Player) => (await flagsOf(p)).map((f) => f.kind + (f.related ? ":" + f.related : ""));

const sweep = () => runIntegritySweep(env, Date.now());

/**
 * One rated set played alone: deal, think for `thinkMs`, lock in, and stop
 * waiting (the Sparring Partner fallback, unrated). Its metrics are still
 * recorded, because the set itself was a ranked submission.
 */
async function soloRanked(p: Player, picks: (ps: PuzzleRef[]) => object[], thinkMs: number) {
  // Revealed answers cool down for everyone; clear them so a long run is never exhausted.
  await env.DB.prepare("DELETE FROM ranked_reveals").run();
  await emptyQueue();
  const set = await ranked(p);
  expect(set.status).toBe(201);
  if (thinkMs) await thinkFor(set.body.duelId, thinkMs);
  const locked = await lock(p.token, set.body, picks(set.body.puzzles));
  expect(locked.status).toBe(200);
  if (locked.body.state === "waiting") {
    const stopped = await call("/v1/duels/" + set.body.duelId + "/stop-waiting", { method: "POST", headers: auth(p.token) });
    expect(stopped.status).toBe(200);
  }
  return set.body;
}

/**
 * One rated match through the real queue: `creator` locks in right picks,
 * `loser` joins and either locks in wrong picks or forfeits. Both take a
 * human-paced minute. Afterwards the pairing is moved outside the repeat-pair
 * window so the same two can meet again.
 */
async function playRated(creator: Player, loser: Player, how: "lose" | "forfeit" = "lose") {
  await env.DB.prepare("DELETE FROM ranked_reveals").run();
  await emptyQueue();
  const set = await ranked(creator);
  expect(set.status).toBe(201);
  await thinkFor(set.body.duelId, 60_000);
  expect((await lock(creator.token, set.body, rightPicks(set.body.puzzles))).body.state).toBe("waiting");
  const matchId = await matchOf(set.body.duelId);
  // Widen the rating window to its maximum, and let the joiner see any puzzle.
  await env.DB.prepare("UPDATE matches SET created_at = created_at - ? WHERE id = ?").bind(12 * HOUR, matchId).run();
  await env.DB.prepare("DELETE FROM ranked_exposures WHERE account_id = ?").bind(loser.accountId).run();
  const join = await ranked(loser);
  expect(join.body.opponent?.name).toBe(creator.name);
  if (how === "forfeit") {
    await env.DB.prepare("UPDATE duels SET expires_at = ? WHERE id = ?").bind(Date.now() - 1, join.body.duelId).run();
    await settleMatch(env, matchId, Date.now());
  } else {
    await thinkFor(join.body.duelId, 60_000);
    expect((await lock(loser.token, join.body, wrongPicks(join.body.puzzles))).body.state).toBe("revealed");
  }
  const resolution = await env.DB.prepare("SELECT settled_by, rated FROM match_resolutions WHERE match_id = ?").bind(matchId).first<{ settled_by: string; rated: number }>();
  expect(resolution).toEqual({ settled_by: how === "forfeit" ? "forfeit" : "both-locked", rated: 1 });
  await env.DB.prepare("UPDATE match_seats SET joined_at = joined_at - ? WHERE match_id = ?").bind(REPEAT_PAIR_WINDOW_MS + HOUR, matchId).run();
  return matchId;
}

/** A rated result written straight into D1, for board windows and ordering. */
async function insertRated(winner: Player, loser: Player, at: number, delta = 12, draw = false) {
  const matchId = "m_board_" + unique();
  const ids = ["d_board_" + unique(), "d_board_" + unique()];
  const statements = [
    env.DB.prepare(
      `INSERT INTO matches (id, kind, puzzle_ids, pool_version, draw_kind, creator_rating, created_at, open_until)
       VALUES (?, 'ranked', '[]', 'duel-pool-v1', 'random', 1200, ?, ?)`,
    ).bind(matchId, at, at),
    ...[winner, loser].map((p, i) =>
      env.DB.prepare(
        `INSERT INTO duels (id, mode, partition, draw_kind, puzzle_ids, pool_version, issued_to, issued_at, expires_at, match_id)
         VALUES (?, 'ranked', 'ranked', 'random', '[]', 'duel-pool-v1', ?, ?, ?, ?)`,
      ).bind(ids[i], p.participant, at, at, matchId),
    ),
    ...[winner, loser].map((p, i) =>
      env.DB.prepare("INSERT INTO match_seats (match_id, seat, participant, duel_id, joined_at) VALUES (?, ?, ?, ?, ?)")
        .bind(matchId, i === 0 ? "creator" : "opponent", p.participant, ids[i], at),
    ),
    env.DB.prepare("INSERT INTO match_resolutions (match_id, settled_by, outcome, rated, resolved_at) VALUES (?, 'both-locked', ?, 1, ?)")
      .bind(matchId, draw ? "draw" : "creator", at),
  ];
  for (const [p, d] of [[winner, delta], [loser, -delta]] as const) {
    const row = await env.DB.prepare("SELECT rating, rated_duels FROM ratings WHERE account_id = ?").bind(p.accountId).first<{ rating: number; rated_duels: number }>();
    const before = row?.rating ?? ELO_START;
    statements.push(
      env.DB.prepare(
        `INSERT INTO ratings (account_id, rating, rated_duels, updated_at) VALUES (?, ?, 1, ?)
         ON CONFLICT (account_id) DO UPDATE SET rating = excluded.rating, rated_duels = rated_duels + 1`,
      ).bind(p.accountId, before + d, at),
      env.DB.prepare(
        `INSERT INTO rating_changes (match_id, account_id, rating_before, rating_after, delta, k, rated_duels_before, created_at)
         VALUES (?, ?, ?, ?, ?, 24, ?, ?)`,
      ).bind(matchId, p.accountId, before, before + d, d, row?.rated_duels ?? 0, at),
    );
  }
  await env.DB.batch(statements);
}

type Entry = { rank: number; name: string; rating: number; duels: number; wins: number; losses: number; draws: number; change: number; provisional: boolean };

async function board(kind: string) {
  const r = await call("/v1/leaderboard?board=" + kind);
  expect(r.status).toBe(200);
  return r.body as { entries: Entry[]; minDuels: number; windowStart: number; board: string };
}
const names = (entries: Entry[], players: Player[]) => entries.filter((e) => players.some((p) => p.name === e.name)).map((e) => e.name);

async function decide(flagId: string, decision: string, note?: string) {
  return call("/v1/admin/flags/" + flagId, { method: "POST", headers: ADMIN, body: JSON.stringify({ decision, note }) });
}

beforeEach(async () => {
  await emptyQueue();
});

// ---------------------------------------------------------------------------

describe("anomaly metrics are recorded for all rated play", () => {
  it("both seats of a rated match get a metrics row; unranked play gets none", async () => {
    const [a, b] = [await account(), await account()];
    const matchId = await playRated(a, b);
    const rows = await env.DB.prepare(
      `SELECT pm.* FROM play_metrics pm JOIN match_seats ms ON ms.duel_id = pm.duel_id AND ms.participant = pm.participant WHERE ms.match_id = ? ORDER BY ms.seat`,
    )
      .bind(matchId)
      .all<Record<string, number | string>>();
    expect(rows.results).toHaveLength(2);
    const [creator, opponent] = rows.results;
    expect(creator).toMatchObject({ account_id: a.accountId, picks: 5, correct: 5, lock_picks: 5, lock_correct: 5, confident_picks: 0, lean_picks: 0, confidence_entropy: 0, points: 480 });
    expect(opponent).toMatchObject({ account_id: b.accountId, picks: 5, correct: 0, lock_correct: 0, points: -1120 });
    for (const row of rows.results) {
      expect(row.ms_to_submit as number).toBeGreaterThanOrEqual(60_000);
      expect(row.model_agree as number).toBeGreaterThanOrEqual(0);
      expect(row.model_agree as number).toBeLessThanOrEqual(5);
    }
    // model_agree matches the fixture's model sides.
    const puzzleIds = JSON.parse((await env.DB.prepare("SELECT puzzle_ids FROM matches WHERE id = ?").bind(matchId).first<{ puzzle_ids: string }>())!.puzzle_ids) as string[];
    const modelRight = puzzleIds.filter((id) => (ANSWERS.get(id).modelHomeWinProbability >= 0.5 ? "home" : "away") === ANSWERS.get(id).actualWinner).length;
    expect(creator.model_agree).toBe(modelRight);
    expect(opponent.model_agree).toBe(5 - modelRight);

    const solo = await call("/v1/sets", post({ mode: "solo", draw: { kind: "random" } }, a.token));
    await lock(a.token, solo.body, rightPicks(solo.body.puzzles));
    const unrated = await env.DB.prepare("SELECT COUNT(*) AS n FROM play_metrics WHERE duel_id = ?").bind(solo.body.duelId).first<{ n: number }>();
    expect(unrated?.n).toBe(0);
  });

  it("a D1 CHECK keeps a metrics row internally consistent", async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO play_metrics (duel_id, participant, account_id, submitted_at, ms_to_submit, picks, correct, lock_picks, lock_correct,
           confident_picks, lean_picks, model_agree, confidence_entropy, points, model_points) VALUES ('d', 'a:x', 'x', 0, 0, 5, 6, 0, 0, 5, 0, 0, 0, 0, 0)`,
      ).run(),
    ).rejects.toThrow(/CHECK|FOREIGN KEY/);
  });
});

describe("a synthetic scripted-submission run is detected", () => {
  it("instant, perfect lock-ins trip both the timing and the accuracy-ceiling rules", async () => {
    const bot = await account();
    for (let i = 0; i < 10; i++) await soloRanked(bot, rightPicks, 0);
    await sweep();
    expect(await kindsOf(bot)).toEqual(["accuracy_ceiling", "scripted_timing"]);
    const timing = JSON.parse((await flagsOf(bot)).find((f) => f.kind === "scripted_timing")!.evidence);
    expect(timing.medianMs).toBeLessThan(5_000);
    const accuracy = JSON.parse((await flagsOf(bot)).find((f) => f.kind === "accuracy_ceiling")!.evidence);
    expect(accuracy).toMatchObject({ picks: 50, correct: 50, accuracy: 1, ceiling: 0.68, lockPicks: 50, lockCorrect: 50 });
  });

  it("a human-paced player looking answers up trips only the accuracy rule; a hot honest streak trips nothing", async () => {
    const [cheat, honest] = [await account(), await account()];
    for (let i = 0; i < 10; i++) {
      await soloRanked(cheat, rightPicks, 90_000);
      // 36 of 50 (72%): above the ceiling, but not significantly, as a hot honest streak can be.
      await soloRanked(honest, (ps) => mixedPicks(ps, i < 6 ? 4 : 3), 90_000);
    }
    await sweep();
    expect(await kindsOf(cheat)).toEqual(["accuracy_ceiling"]);
    expect(await kindsOf(honest)).toEqual([]);
  });

  it("flags never block play or rating: a flagged account keeps ranking and its rating still moves", async () => {
    const [flagged, other] = [await account(), await account()];
    await raiseFlags(env, [{ accountId: flagged.accountId, kind: "scripted_timing", related: "", evidence: {} }], Date.now());
    expect((await call("/v1/account", { headers: auth(flagged.token) })).body.hiddenFromBoard).toBe(true);
    await playRated(flagged, other);
    const rating = await env.DB.prepare("SELECT rating FROM ratings WHERE account_id = ?").bind(flagged.accountId).first<{ rating: number }>();
    expect(rating!.rating).toBeGreaterThan(ELO_START);
  });
});

describe("a synthetic collusion ring is detected", () => {
  it("three alts feeding one main through losses and forfeits are all flagged; an honest round robin is not", async () => {
    const main = await account();
    const alts = [await account(), await account(), await account()];
    await playRated(main, alts[0], "forfeit");
    await playRated(main, alts[0], "forfeit");
    await playRated(main, alts[1]);
    await playRated(main, alts[1]);
    await playRated(main, alts[2]);
    await playRated(main, alts[2], "forfeit");

    const honest = [await account(), await account(), await account()];
    await playRated(honest[0], honest[1]);
    await playRated(honest[1], honest[2]);
    await playRated(honest[2], honest[0]);

    await sweep();
    const mainKinds = await kindsOf(main);
    expect(mainKinds).toContain("feeder_ring");
    expect(mainKinds).toContain("forfeit_feeding:" + alts[0].accountId);
    const ring = JSON.parse((await flagsOf(main)).find((f) => f.kind === "feeder_ring")!.evidence);
    expect(ring).toMatchObject({ feeders: 3, winsFromFeeders: 6 });
    expect(new Set(ring.feederAccounts)).toEqual(new Set(alts.map((a) => a.accountId)));
    expect(await kindsOf(alts[0])).toEqual(["feeder_ring:" + main.accountId, "forfeit_feeding:" + main.accountId]);
    expect(await kindsOf(alts[1])).toEqual(["feeder_ring:" + main.accountId]);
    expect(await kindsOf(alts[2])).toEqual(["feeder_ring:" + main.accountId]);
    for (const h of honest) expect(await kindsOf(h)).toEqual([]);

    // Running the sweep again refreshes the same flags rather than piling up new ones.
    await sweep();
    expect(await kindsOf(main)).toEqual(mainKinds);
  });
});

describe("multi-account velocity", () => {
  it(`accounts from one network are linked, and ${MULTI_ACCOUNT_FLAG_AT} in a day are flagged`, async () => {
    const ip = "203.0.113.9-" + unique();
    const first = await account(false, ip);
    const second = await account(false, ip);
    const links = await env.DB.prepare("SELECT COUNT(*) AS n FROM account_links WHERE ? IN (account_id, linked_id)").bind(first.accountId).first<{ n: number }>();
    expect(links?.n).toBe(1);
    expect(await kindsOf(first)).toEqual([]);
    const third = await account(false, ip);
    for (const p of [first, second, third]) expect(await kindsOf(p)).toEqual(["multi_account"]);
    // The network itself is never written to D1.
    const stored = await env.DB.prepare("SELECT * FROM account_links WHERE ? IN (account_id, linked_id)").bind(third.accountId).all();
    expect(JSON.stringify(stored.results)).not.toContain("203.0.113.9");
    // Separate networks are not linked.
    const elsewhere = await account(false);
    const none = await env.DB.prepare("SELECT COUNT(*) AS n FROM account_links WHERE ? IN (account_id, linked_id)").bind(elsewhere.accountId).first<{ n: number }>();
    expect(none?.n).toBe(0);
  });

  it("linked accounts that meet in rated play are flagged", async () => {
    const ip = "203.0.113.10-" + unique();
    const [x, y] = [await account(true, ip), await account(true, ip)];
    await playRated(x, y);
    await sweep();
    expect(await kindsOf(x)).toContain("linked_accounts:" + y.accountId);
    expect(await kindsOf(y)).toContain("linked_accounts:" + x.accountId);
  });
});

describe("leaderboards", () => {
  it("daily ranks today's rated results by rating change; 30 days ranks by rating with a minimum of duels", async () => {
    const [p, q, r] = [await account(), await account(), await account()];
    const now = Date.now();
    const today = Math.floor(now / DAY) * DAY;
    await insertRated(p, q, now - 1000, 12);
    await insertRated(p, r, now - 1000, 12);
    await insertRated(r, q, now - 1000, 10);
    await insertRated(q, p, today - HOUR, 100); // yesterday: not on the daily board

    const daily = await board("daily");
    expect(daily.windowStart).toBe(today);
    expect(names(daily.entries, [p, q, r])).toEqual([p.name, r.name, q.name]);
    const dp = daily.entries.find((e) => e.name === p.name)!;
    expect(dp).toMatchObject({ duels: 2, wins: 2, losses: 0, draws: 0, change: 24, provisional: true });
    expect(daily.entries.find((e) => e.name === q.name)).toMatchObject({ duels: 2, wins: 0, losses: 2, change: -22 });
    // Ranks are positions on the board.
    expect(daily.entries.map((e) => e.rank)).toEqual(daily.entries.map((_, i) => i + 1));

    // 30 days needs BOARD_MIN_DUELS rated duels in the window; results older than 30 days don't count.
    expect(BOARD_MIN_DUELS["30d"]).toBe(5);
    await insertRated(p, r, now - 40 * DAY, 12);
    expect(names((await board("30d")).entries, [p, q, r])).toEqual([]);
    await insertRated(p, r, now - 10 * DAY, 12);
    expect(names((await board("30d")).entries, [p, q, r])).toEqual([]); // 4 in the window
    await insertRated(p, r, now - 20 * DAY, 12);
    const month = await board("30d");
    expect(names(month.entries, [p, q, r])).toEqual([p.name]);
    expect(month.entries.find((e) => e.name === p.name)).toMatchObject({ duels: 5, wins: 4, losses: 1 });
  });

  it("is public, names only: no account id, email hash, or flag detail", async () => {
    const [p, q] = [await account(), await account()];
    await insertRated(p, q, Date.now() - 1000);
    const r = await call("/v1/leaderboard?board=daily");
    expect(r.text).toContain(p.name);
    for (const secret of [p.accountId, q.accountId, "email", "account_id", "flag"]) expect(r.text).not.toContain(secret);
    expect((await call("/v1/leaderboard?board=weekly")).status).toBe(400);
    expect((await call("/v1/leaderboard")).status).toBe(400);
  });

  it("the board excludes flagged accounts pending review: open hides, cleared restores, upheld keeps hidden", async () => {
    const [p, q] = [await account(), await account()];
    await insertRated(p, q, Date.now() - 1000);
    await raiseFlags(env, [{ accountId: p.accountId, kind: "accuracy_ceiling", related: "", evidence: { picks: 50 } }], Date.now());
    await raiseFlags(env, [{ accountId: q.accountId, kind: "win_trading", related: p.accountId, evidence: {} }], Date.now());
    for (const kind of ["daily", "30d"]) expect(names((await board(kind)).entries, [p, q])).toEqual([]);
    expect((await call("/v1/account", { headers: auth(p.token) })).body.hiddenFromBoard).toBe(true);

    expect((await decide((await flagsOf(p))[0].id, "clear", "Checked: consistent with play history.")).status).toBe(200);
    expect((await decide((await flagsOf(q))[0].id, "uphold")).status).toBe(200);
    expect(names((await board("daily")).entries, [p, q])).toEqual([p.name]);
    expect((await call("/v1/account", { headers: auth(p.token) })).body.hiddenFromBoard).toBe(false);
    expect((await call("/v1/account", { headers: auth(q.token) })).body.hiddenFromBoard).toBe(true);
  });

  it("is edge-cached when LEADERBOARD_CACHE_SECONDS is set", async () => {
    const cached = { ...env, LEADERBOARD_CACHE_SECONDS: "60" };
    const first = await call("/v1/leaderboard?board=30d", { env: cached });
    expect(first.headers.get("cache-control")).toBe("public, max-age=60");
    const [p, q] = [await account(), await account()];
    for (let i = 0; i < 5; i++) await insertRated(p, q, Date.now() - 1000);
    const second = await call("/v1/leaderboard?board=30d", { env: cached });
    expect(second.body.generatedAt).toBe(first.body.generatedAt);
    expect(second.text).not.toContain(p.name);
    expect((await call("/v1/leaderboard?board=30d")).text).toContain(p.name);
  });
});

describe("the internal review queue", () => {
  it("is invisible without the admin token: 404 for no token, a wrong token, or an unset secret", async () => {
    expect((await call("/v1/admin/flags")).status).toBe(404);
    expect((await call("/v1/admin/flags", { headers: { authorization: "Bearer nope" } })).status).toBe(404);
    expect((await call("/v1/admin/flags", { headers: ADMIN, env: { ...env, ADMIN_TOKEN: undefined } })).status).toBe(404);
    expect((await call("/v1/admin/flags", { headers: ADMIN, env: { ...env, ADMIN_TOKEN: "short" } })).status).toBe(404);
    const r = await call("/v1/admin/flags", { headers: { authorization: "Bearer nope" } });
    expect(r.body.error).toBe("not_found");
  });

  it("lists open flags with evidence and account context, and records each decision once", async () => {
    const [p, q] = [await account(), await account()];
    await raiseFlags(env, [{ accountId: p.accountId, kind: "forfeit_feeding", related: q.accountId, evidence: { forfeitsGiven: 2 } }], Date.now());
    const list = await call("/v1/admin/flags?status=open", { headers: ADMIN });
    expect(list.status).toBe(200);
    const flag = list.body.flags.find((f: { accountId: string }) => f.accountId === p.accountId);
    expect(flag).toMatchObject({
      kind: "forfeit_feeding",
      displayName: p.name,
      relatedAccountId: q.accountId,
      relatedDisplayName: q.name,
      status: "open",
      evidence: { forfeitsGiven: 2 },
      reviewedAt: null,
      account: { rating: null, ratedDuels: 0 },
    });
    expect((await decide(flag.id, "ban")).status).toBe(400);
    expect((await decide(flag.id, "clear", "x".repeat(501))).status).toBe(400);
    expect((await decide("f_missing", "clear")).status).toBe(404);

    const upheld = await decide(flag.id, "uphold", "Two forfeits the same evening.");
    expect(upheld.body).toMatchObject({ status: "upheld", reviewNote: "Two forfeits the same evening." });
    expect((await decide(flag.id, "uphold")).status).toBe(409);
    // An upheld flag can be cleared later (an appeal); a cleared one is final.
    expect((await decide(flag.id, "clear", "Appeal accepted.")).body.status).toBe("cleared");
    const again = await decide(flag.id, "clear");
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("flag_decided");
    const cleared = await call("/v1/admin/flags?status=cleared", { headers: ADMIN });
    expect(cleared.body.flags.some((f: { id: string }) => f.id === flag.id)).toBe(true);
    expect((await call("/v1/admin/flags?status=banned", { headers: ADMIN })).status).toBe(400);
  });

  it("a D1 index allows one open flag per account, kind, and related account", async () => {
    const p = await account();
    const insert = () =>
      env.DB.prepare(
        "INSERT INTO integrity_flags (id, account_id, kind, related, status, evidence, created_at, updated_at) VALUES (?, ?, 'repeat_pair', 'x', 'open', '{}', 0, 0)",
      ).bind("f_" + unique(), p.accountId).run();
    await insert();
    await expect(insert()).rejects.toThrow(/UNIQUE/);
    await expect(
      env.DB.prepare("UPDATE integrity_flags SET status = 'cleared' WHERE account_id = ?").bind(p.accountId).run(),
    ).rejects.toThrow(/CHECK/); // a decision needs a review time
  });

  it("a cleared flag is judged again only on play after the review", async () => {
    const cheat = await account();
    for (let i = 0; i < 10; i++) await soloRanked(cheat, rightPicks, 90_000);
    await sweep();
    const [flag] = await flagsOf(cheat);
    expect(flag.kind).toBe("accuracy_ceiling");
    expect((await decide(flag.id, "clear", "Known strong player.")).status).toBe(200);
    await sweep();
    expect(await kindsOf(cheat)).toEqual([]);
    // Nine more perfect sets after the review are not yet enough evidence; the tenth is.
    for (let i = 0; i < 9; i++) await soloRanked(cheat, rightPicks, 90_000);
    await sweep();
    expect(await kindsOf(cheat)).toEqual([]);
    await soloRanked(cheat, rightPicks, 90_000);
    await sweep();
    expect(await kindsOf(cheat)).toEqual(["accuracy_ceiling"]);
  });

  it("POST /v1/admin/sweep runs the detectors on demand", async () => {
    const r = await call("/v1/admin/sweep", { method: "POST", headers: ADMIN });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ findings: expect.any(Number), purged: expect.any(Number) });
  });
});

describe("the scheduled handler", () => {
  it("settles due matches, then sweeps: a forfeit feeder is flagged with nobody looking", async () => {
    const [main, alt] = [await account(), await account()];
    await playRated(main, alt, "forfeit");
    // The second forfeit is left for the cron to settle.
    await env.DB.prepare("DELETE FROM ranked_reveals").run();
    await emptyQueue();
    const set = await ranked(main);
    await thinkFor(set.body.duelId, 60_000);
    await lock(main.token, set.body, rightPicks(set.body.puzzles));
    const matchId = await matchOf(set.body.duelId);
    await env.DB.prepare("UPDATE matches SET created_at = created_at - ? WHERE id = ?").bind(12 * HOUR, matchId).run();
    await env.DB.prepare("DELETE FROM ranked_exposures WHERE account_id = ?").bind(alt.accountId).run();
    const join = await ranked(alt);
    expect(join.body.opponent?.name).toBe(main.name);
    await env.DB.prepare("UPDATE duels SET expires_at = ? WHERE id = ?").bind(Date.now() - 1, join.body.duelId).run();

    const ctx = createExecutionContext();
    worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: "*/15 * * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await env.DB.prepare("SELECT settled_by FROM match_resolutions WHERE match_id = ?").bind(matchId).first()).toEqual({ settled_by: "forfeit" });
    expect(await kindsOf(alt)).toContain("forfeit_feeding:" + main.accountId);
  });

  it("purges sign-in links and sessions a day after they stop working, and keeps live ones", async () => {
    const now = Date.now();
    const old = await sha256Hex("old-" + unique());
    const live = await sha256Hex("live-" + unique());
    const p = await account(false);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO magic_links (token_hash, email_hash, created_at, expires_at) VALUES (?, 'h', ?, ?)").bind(old, now - 3 * DAY, now - 2 * DAY),
      env.DB.prepare("INSERT INTO magic_link_redemptions (token_hash, redeemed_at) VALUES (?, ?)").bind(old, now - 3 * DAY),
      env.DB.prepare("INSERT INTO magic_links (token_hash, email_hash, created_at, expires_at) VALUES (?, 'h', ?, ?)").bind(live, now, now + HOUR),
      env.DB.prepare("INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(old, p.accountId, now - 40 * DAY, now - 2 * DAY),
      env.DB.prepare("INSERT INTO sessions (token_hash, account_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?)").bind(live, p.accountId, now - DAY, now + DAY, now - 2 * DAY),
    ]);
    expect(await purgeExpired(env, now)).toBeGreaterThanOrEqual(4);
    expect(await env.DB.prepare("SELECT token_hash FROM magic_links WHERE token_hash IN (?, ?)").bind(old, live).all()).toMatchObject({ results: [{ token_hash: live }] });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM magic_link_redemptions WHERE token_hash = ?").bind(old).first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash IN (?, ?)").bind(old, live).first<{ n: number }>())?.n).toBe(0);
    // The account's real session still works.
    expect((await call("/v1/account", { headers: auth(p.token) })).status).toBe(200);
  });
});
