// F09 Session 6 acceptance: ranked and friend duels. Both seats receive the
// identical set; no path shows an answer or the other seat's picks before both
// have locked in; abandoned duels resolve by the documented timeout rules; the
// Sparring Partner fallback is unrated and disclosed; Elo is zero-sum and the
// ledger reproduces every rating. The integrity rules are D1 constraints.

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ELO_START, applyElo, pointsFor, resolveDuel, scorePick } from "../../frontend/src/duel";
import { RANKED_MIN_COMPLETED_DUELS } from "../src/accounts";
import { handle } from "../src/index";
import {
  RANKED_MAX_WAITING,
  RANKED_REUSE_COOLDOWN_MS,
  REPEAT_PAIR_WINDOW_MS,
  settleDue,
  settleMatch,
} from "../src/matches";
import { DummyTokenCheck, MemoryMailer, TURNSTILE_DUMMY_TOKEN } from "../src/services";
import { sha256Hex, sign } from "../src/tokens";
import { fixturePoolEntries } from "../scripts/fixture-pool.mjs";

const mailer = new MemoryMailer();
let counter = 0;
const unique = () => ++counter + "-" + Math.random().toString(36).slice(2, 8);
const freshIp = () => "198.18.0." + (counter % 250) + "-" + unique();

const ANSWERS = new Map(
  fixturePoolEntries()
    .filter((e) => e.key.includes(":puzzle:"))
    .map((e) => {
      const p = JSON.parse(e.value);
      return [p.view.puzzleId as string, p.answer];
    }),
);
const RANKED_IDS = [...ANSWERS.values()].filter((a) => a.partition === "ranked").map((a) => a.puzzleId as string);
// Pre-resolution responses must carry none of these: answers, model values, or picks.
const HIDDEN_MARKERS = ["actualWinner", "modelHomeWinProbability", "modelInSample", "partition", "0.691234", "0.308766", '"picks"', '"confidence"', '"side"', '"points"', '"correct"'];

type CallInit = RequestInit & { ip?: string };

async function call(path: string, init: CallInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", init.ip ?? freshIp());
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await handle(new Request("https://duel.test" + path, { ...init, headers }), env, {
    mailer,
    humanCheck: new DummyTokenCheck(),
  });
  const text = await response.text();
  return { status: response.status, text, body: text ? JSON.parse(text) : null };
}

const auth = (token: string) => ({ authorization: "Bearer " + token });
const post = (body: unknown, token?: string): CallInit => ({ method: "POST", body: JSON.stringify(body), headers: token ? auth(token) : {} });

function expectHidden(text: string) {
  for (const marker of HIDDEN_MARKERS) expect(text, marker).not.toContain(marker);
}

type Player = { token: string; accountId: string; participant: string; name: string };

/** A signed-in account. `eligible` fast-tracks the Session 5 gate (tested in accounts.test.ts) with completed sets written directly. */
async function account(eligible = true): Promise<Player> {
  const email = "ranked." + unique() + "@example.com";
  expect((await call("/v1/auth/magic-link", post({ email, turnstileToken: TURNSTILE_DUMMY_TOKEN }))).status).toBe(202);
  const link = /#token=(ml_[A-Za-z0-9_-]+)/.exec([...mailer.sent].reverse().find((m) => m.to === email)!.text)![1];
  const signed = await call("/v1/auth/verify", post({ token: link }));
  expect(signed.status).toBe(200);
  const token = signed.body.sessionToken as string;
  const row = await env.DB.prepare("SELECT account_id FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).first<{ account_id: string }>();
  const accountId = row!.account_id;
  const participant = "a:" + accountId;
  const name = "Player " + (counter % 100000);
  if (eligible) {
    const statements = [];
    for (let i = 0; i < RANKED_MIN_COMPLETED_DUELS; i++) {
      const duelId = "d_seed_" + unique();
      statements.push(
        env.DB.prepare(
          `INSERT INTO duels (id, mode, partition, draw_kind, puzzle_ids, pool_version, issued_to, issued_at, expires_at)
           VALUES (?, 'solo', 'sim', 'random', '[]', 'duel-pool-v1', ?, 0, 1)`,
        ).bind(duelId, participant),
        env.DB.prepare(
          "INSERT INTO submissions (duel_id, participant, idempotency_key, submitted_at, ms_to_submit, total_points, result) VALUES (?, ?, ?, 0, 0, 0, '{}')",
        ).bind(duelId, participant, unique()),
      );
    }
    await env.DB.batch(statements);
    expect((await call("/v1/account/display-name", post({ displayName: name }, token))).status).toBe(200);
  }
  return { token, accountId, participant, name };
}

async function guest(): Promise<string> {
  const r = await call("/v1/guests", { method: "POST" });
  expect(r.status).toBe(201);
  return r.body.guestToken;
}

const ranked = (p: Player) => call("/v1/sets", post({ mode: "ranked" }, p.token));
const friend = (token: string, draw: object = { kind: "random" }) => call("/v1/sets", post({ mode: "friend", draw }, token));
const read = (token: string, duelId: string) => call("/v1/duels/" + duelId, { headers: auth(token) });

type Side = "home" | "away";
type Conf = "lean" | "confident" | "lock";
function picksFor(puzzles: { puzzleId: string }[], side: (i: number) => Side = (i) => (i % 2 ? "away" : "home"), conf: Conf = "confident") {
  return puzzles.map((p, i) => ({ puzzleId: p.puzzleId, side: side(i), confidence: conf }));
}
function rightPicks(puzzles: { puzzleId: string }[]) {
  return puzzles.map((p) => ({ puzzleId: p.puzzleId, side: ANSWERS.get(p.puzzleId).actualWinner as Side, confidence: "lock" as Conf }));
}
function wrongPicks(puzzles: { puzzleId: string }[]) {
  return puzzles.map((p) => ({
    puzzleId: p.puzzleId,
    side: (ANSWERS.get(p.puzzleId).actualWinner === "home" ? "away" : "home") as Side,
    confidence: "lock" as Conf,
  }));
}

async function lock(token: string, set: { duelId: string; setToken: string }, picks: object[], key = unique()) {
  return call("/v1/duels/" + set.duelId + "/submission", {
    method: "POST",
    headers: { ...auth(token), "idempotency-key": key },
    body: JSON.stringify({ setToken: set.setToken, picks }),
  });
}

async function matchOf(duelId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT match_id FROM duels WHERE id = ?").bind(duelId).first<{ match_id: string }>();
  return row!.match_id;
}

/** Closes every open match so a test's queue holds only what it creates. */
async function emptyQueue() {
  await env.DB.prepare("UPDATE matches SET open_until = 1 WHERE open_until > 1").run();
}

/** A creator's ranked set, locked in and waiting. */
async function queued(creator: Player, picks: (p: { puzzleId: string }[]) => object[] = picksFor) {
  const set = await ranked(creator);
  expect(set.status).toBe(201);
  expect(set.body.opponent).toBeNull();
  const locked = await lock(creator.token, set.body, picks(set.body.puzzles));
  expect(locked.status).toBe(200);
  expect(locked.body.state).toBe("waiting");
  return set.body;
}

beforeEach(async () => {
  await emptyQueue();
});

// ---------------------------------------------------------------------------

describe("matchmaking deals both seats the identical set", () => {
  it("the joiner receives the creator's exact puzzles, in order, from the ranked partition", async () => {
    const [a, b] = [await account(), await account()];
    const setA = await queued(a);
    const setB = await ranked(b);
    expect(setB.status).toBe(201);
    expect(setB.body.mode).toBe("ranked");
    expect(setB.body.opponent).toEqual({ kind: "player", name: a.name });
    expect(setB.body.puzzles.map((p: { puzzleId: string }) => p.puzzleId)).toEqual(setA.puzzles.map((p: { puzzleId: string }) => p.puzzleId));
    expect(setB.body.puzzles).toEqual(setA.puzzles);
    for (const p of setB.body.puzzles) expect(ANSWERS.get(p.puzzleId).partition).toBe("ranked");

    const match = await matchOf(setA.duelId);
    expect(await matchOf(setB.body.duelId)).toBe(match);
    const rows = await env.DB.prepare("SELECT d.puzzle_ids FROM duels d WHERE d.match_id = ? UNION ALL SELECT puzzle_ids FROM matches WHERE id = ?")
      .bind(match, match)
      .all<{ puzzle_ids: string }>();
    expect(rows.results).toHaveLength(3);
    expect(new Set(rows.results.map((r) => r.puzzle_ids)).size).toBe(1);
  });

  it("a match holds one opponent: racing joiners get one seat, and D1 rejects a second", async () => {
    const a = await account();
    await queued(a);
    const joiners = await Promise.all([account(), account(), account(), account()]);
    const sets = await Promise.all(joiners.map((j) => ranked(j)));
    const seats = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM match_seats WHERE seat = 'opponent' AND match_id IN (SELECT match_id FROM match_seats WHERE participant = ?)",
    )
      .bind(a.participant)
      .first<{ n: number }>();
    expect(seats?.n).toBe(1);
    // The others were dealt fresh sets of their own, not a seat in a's match.
    expect(sets.filter((s) => s.body.opponent?.name === a.name)).toHaveLength(1);
    const match = await env.DB.prepare("SELECT match_id FROM match_seats WHERE participant = ?").bind(a.participant).first<{ match_id: string }>();
    await expect(
      env.DB.prepare("INSERT INTO match_seats (match_id, seat, participant, duel_id, joined_at) VALUES (?, 'opponent', 'a:x', 'd_x', 0)")
        .bind(match!.match_id)
        .run(),
    ).rejects.toThrow(/UNIQUE|PRIMARY KEY|FOREIGN KEY/);
  });

  it("never seats an account in its own match, or before the creator has locked in", async () => {
    const a = await account();
    const first = await ranked(a); // not locked in yet
    const b = await account();
    const setB = await ranked(b);
    expect(setB.body.opponent).toBeNull(); // dealt its own set: a's is not joinable
    await lock(a.token, first.body, picksFor(first.body.puzzles));
    const second = await ranked(a);
    // a's own waiting match is skipped; b's unlocked one is not joinable either.
    expect(second.body.opponent).toBeNull();
    expect(second.body.duelId).not.toBe(first.body.duelId);
  });

  it("guests cannot rank; ineligible accounts cannot rank", async () => {
    expect((await call("/v1/sets", post({ mode: "ranked" }, await guest()))).body.error).toBe("account_required");
    expect((await ranked(await account(false))).body.error).toBe("ranked_locked");
  });
});

describe("nothing leaks before both have locked in", () => {
  it("no answer and no opponent pick in any pre-resolution payload or error", async () => {
    const [a, b] = [await account(), await account()];
    const setA = await ranked(a);
    const texts: string[] = [setA.text, (await read(a.token, setA.body.duelId)).text];
    const lockedA = await lock(a.token, setA.body, rightPicks(setA.body.puzzles));
    texts.push(lockedA.text, (await read(a.token, setA.body.duelId)).text);
    expect(lockedA.body.waiting).toEqual({
      duelId: setA.body.duelId,
      mode: "ranked",
      opponent: null,
      openUntil: expect.any(Number),
      invitePath: null,
      canStopWaiting: true,
    });

    const setB = await ranked(b);
    texts.push(setB.text, (await read(b.token, setB.body.duelId)).text);
    // The creator now sees who joined, and still nothing else.
    const waitingA = await read(a.token, setA.body.duelId);
    texts.push(waitingA.text);
    expect(waitingA.body.waiting.opponent).toEqual({ kind: "player", name: b.name });
    expect(waitingA.body.waiting.canStopWaiting).toBe(false);
    // Errors on the joiner's side.
    texts.push((await lock(b.token, { ...setB.body, setToken: "bad" }, [])).text);
    texts.push((await lock(b.token, setB.body, [])).text);
    texts.push((await call("/v1/duels/" + setB.body.duelId + "/stop-waiting", post({}, b.token))).text);
    texts.push((await read(b.token, setA.body.duelId)).text); // the other seat's duel: not found
    texts.push((await read(a.token, setB.body.duelId)).text);
    for (const text of texts) expectHidden(text);
  });
});

describe("resolution and Elo", () => {
  it("both locked in: each sees the other's picks, the result follows the scoring rule, and rating moves zero-sum", async () => {
    const [a, b] = [await account(), await account()];
    const setA = await queued(a, rightPicks);
    const setB = (await ranked(b)).body;
    const revealedB = await lock(b.token, setB, wrongPicks(setB.puzzles));
    expect(revealedB.status).toBe(200);
    expect(revealedB.body.state).toBe("revealed");
    const resultB = revealedB.body.result;
    const resultA = (await read(a.token, setA.duelId)).body.result;

    // Scores match the published table and the duel rule.
    expect(resultA.you.total).toBe(5 * pointsFor(0.9));
    expect(resultB.you.total).toBe(5 * pointsFor(0.1));
    const answers = setA.puzzles.map((p: { puzzleId: string }) => ANSWERS.get(p.puzzleId));
    const expected = resolveDuel(
      rightPicks(setA.puzzles).map((p, i) => scorePick(p, answers[i])),
      wrongPicks(setA.puzzles).map((p, i) => scorePick(p, answers[i])),
    );
    expect(expected.outcome).toBe("a");
    expect(resultA.opponent).toMatchObject({ kind: "player", name: b.name, total: resultB.you.total, outcome: "you", decidedBy: "total" });
    expect(resultB.opponent).toMatchObject({ kind: "player", name: a.name, total: resultA.you.total, outcome: "opponent" });
    expect(resultA.opponent.picks).toEqual(resultB.you.picks);
    expect(resultB.opponent.picks).toEqual(resultA.you.picks);
    expect(resultA.model.label).toBe("Pre-game model");

    // Elo: both provisional (K 40), equal ratings, so the winner gains 20.
    const elo = applyElo({ rating: ELO_START, ratedDuels: 0 }, { rating: ELO_START, ratedDuels: 0 }, "a");
    expect(resultA.match).toEqual({ settledBy: "both-locked", rated: true, rating: { before: 1200, after: 1200 + elo.deltaA, delta: elo.deltaA, k: 40 } });
    expect(resultB.match.rating).toEqual({ before: 1200, after: 1200 - elo.deltaA, delta: -elo.deltaA, k: 40 });
    const meA = await call("/v1/account", { headers: auth(a.token) });
    expect(meA.body.rating).toEqual({ rating: 1200 + elo.deltaA, ratedDuels: 1, provisional: true });
  });

  it("the ledger audits every rating: zero-sum per match and rating = start + sum of deltas", async () => {
    const players = await Promise.all(Array.from({ length: 4 }, () => account()));
    // Six matches round-robin, alternating winners, no repeat pairs.
    const pairs = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
    for (const [i, j] of pairs) {
      await emptyQueue();
      const creatorWins = (i + j) % 2 === 0;
      const setA = await queued(players[i], creatorWins ? rightPicks : wrongPicks);
      const setB = (await ranked(players[j])).body;
      expect(setB.opponent?.name).toBe(players[i].name);
      const r = await lock(players[j].token, setB, creatorWins ? wrongPicks(setB.puzzles) : rightPicks(setB.puzzles));
      expect(r.body.state).toBe("revealed");
      void setA;
    }
    const perMatch = await env.DB.prepare(
      "SELECT match_id, SUM(delta) AS total, COUNT(*) AS n FROM rating_changes WHERE account_id IN (?, ?, ?, ?) GROUP BY match_id",
    )
      .bind(...players.map((p) => p.accountId))
      .all<{ total: number; n: number }>();
    expect(perMatch.results).toHaveLength(6);
    for (const m of perMatch.results) expect([m.total, m.n]).toEqual([0, 2]);
    for (const p of players) {
      const [rating, ledger] = await Promise.all([
        env.DB.prepare("SELECT rating, rated_duels FROM ratings WHERE account_id = ?").bind(p.accountId).first<{ rating: number; rated_duels: number }>(),
        env.DB.prepare("SELECT SUM(delta) AS total, COUNT(*) AS n FROM rating_changes WHERE account_id = ?").bind(p.accountId).first<{ total: number; n: number }>(),
      ]);
      expect(rating!.rating).toBe(ELO_START + ledger!.total);
      expect(rating!.rated_duels).toBe(ledger!.n);
      expect(rating!.rated_duels).toBe(3);
    }
    // Chained: each change starts from the previous change's result.
    const chain = await env.DB.prepare("SELECT rating_before, rating_after FROM rating_changes WHERE account_id = ? ORDER BY created_at, rated_duels_before")
      .bind(players[0].accountId)
      .all<{ rating_before: number; rating_after: number }>();
    for (let i = 1; i < chain.results.length; i++) expect(chain.results[i].rating_before).toBe(chain.results[i - 1].rating_after);
  });

  it("settles once under concurrency: parallel settles apply one resolution and one rating change each", async () => {
    const [a, b] = [await account(), await account()];
    const setA = await queued(a);
    const setB = (await ranked(b)).body;
    const match = await matchOf(setA.duelId);
    await Promise.all([
      lock(b.token, setB, picksFor(setB.puzzles, () => "home")),
      ...Array.from({ length: 5 }, () => settleMatch(env, match, Date.now())),
      read(a.token, setA.duelId),
    ]);
    await settleMatch(env, match, Date.now());
    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM match_resolutions WHERE match_id = ?1) AS res, (SELECT COUNT(*) FROM rating_changes WHERE match_id = ?1) AS changes",
    )
      .bind(match)
      .first<{ res: number; changes: number }>();
    expect(counts).toEqual({ res: 1, changes: 2 });
    for (const p of [a, b]) {
      const row = await env.DB.prepare("SELECT rated_duels FROM ratings WHERE account_id = ?").bind(p.accountId).first<{ rated_duels: number }>();
      expect(row?.rated_duels).toBe(1);
    }
    // D1 itself refuses a second resolution, a second change, and a change from a stale rating.
    await expect(
      env.DB.prepare("INSERT INTO match_resolutions (match_id, settled_by, outcome, rated, resolved_at) VALUES (?, 'both-locked', 'draw', 1, 0)").bind(match).run(),
    ).rejects.toThrow(/UNIQUE|PRIMARY KEY/);
    await expect(
      env.DB.prepare(
        `INSERT INTO rating_changes (match_id, account_id, rating_before, rating_after, delta, k, rated_duels_before, created_at)
         VALUES (?, ?, (SELECT rating FROM ratings WHERE account_id = ? AND rating = 1200 AND rated_duels = 0), 1210, 10, 40, 0, 0)`,
      )
        .bind(match, a.accountId, a.accountId)
        .run(),
    ).rejects.toThrow(/NOT NULL|UNIQUE|PRIMARY KEY/);
  });
});

describe("timeout rules", () => {
  it("an opponent who joins but never locks in forfeits: the creator wins a rated duel", async () => {
    const [a, b] = [await account(), await account()];
    const setA = await queued(a);
    const setB = (await ranked(b)).body;
    // Nothing happens while the joiner still has time.
    expect((await read(a.token, setA.duelId)).body.state).toBe("waiting");
    await env.DB.prepare("UPDATE duels SET expires_at = ? WHERE id = ?").bind(Date.now() - 1, setB.duelId).run();

    const resultA = (await read(a.token, setA.duelId)).body.result;
    expect(resultA.opponent).toEqual({ kind: "player", name: b.name, total: 0, picks: null, outcome: "you", decidedBy: "forfeit" });
    expect(resultA.match.settledBy).toBe("forfeit");
    expect(resultA.match.rated).toBe(true);
    expect(resultA.match.rating.delta).toBeGreaterThan(0);

    const forfeiter = await read(b.token, setB.duelId);
    expect(forfeiter.body.state).toBe("expired");
    expect(forfeiter.body.match).toEqual({ settledBy: "forfeit", rated: true, rating: { ...resultA.match.rating, before: 1200, after: 1200 - resultA.match.rating.delta, delta: -resultA.match.rating.delta } });
    // Too late to lock in now.
    expect((await lock(b.token, setB, picksFor(setB.puzzles))).body.error).toBe("set_expired");
  });

  it("a lock-in cannot land in a match that has already resolved (D1 guard)", async () => {
    const [a, b] = [await account(), await account()];
    const setA = await queued(a);
    const setB = (await ranked(b)).body;
    const match = await matchOf(setA.duelId);
    // Simulate a resolution written between the joiner's checks and their insert.
    await env.DB.prepare("INSERT INTO match_resolutions (match_id, settled_by, outcome, rated, resolved_at) VALUES (?, 'forfeit', 'creator', 0, ?)")
      .bind(match, Date.now())
      .run();
    const r = await lock(b.token, setB, picksFor(setB.puzzles));
    expect(r.body.error).toBe("set_expired");
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE duel_id = ?").bind(setB.duelId).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("nobody joins before the match closes: the creator plays the disclosed Sparring Partner, unrated", async () => {
    const a = await account();
    const setA = await queued(a);
    await env.DB.prepare("UPDATE matches SET open_until = ? WHERE id = ?").bind(Date.now() - 1, await matchOf(setA.duelId)).run();
    // The scheduled sweep settles it without anyone looking.
    expect(await settleDue(env, Date.now())).toBeGreaterThanOrEqual(1);
    const result = (await read(a.token, setA.duelId)).body.result;
    expect(result.opponent.kind).toBe("bot");
    expect(result.opponent.name).toBe("Sparring Partner");
    expect(result.opponent.disclosure).toMatch(/not a model prediction/);
    expect(result.match).toEqual({ settledBy: "no-opponent", rated: false, rating: null });
    const rating = await env.DB.prepare("SELECT COUNT(*) AS n FROM rating_changes WHERE account_id = ?").bind(a.accountId).first<{ n: number }>();
    expect(rating?.n).toBe(0);
    expect((await call("/v1/account", { headers: auth(a.token) })).body.rating).toBeNull();
  });

  it("the creator may stop waiting, but not once an opponent has joined", async () => {
    const [a, b] = [await account(), await account()];
    const first = await queued(a);
    const stopped = await call("/v1/duels/" + first.duelId + "/stop-waiting", post({}, a.token));
    expect(stopped.status).toBe(200);
    expect(stopped.body.result.match).toEqual({ settledBy: "no-opponent", rated: false, rating: null });
    expect(stopped.body.result.opponent.kind).toBe("bot");
    // A settled match can no longer be joined.
    const setB = await ranked(b);
    expect(setB.body.opponent).toBeNull();

    await emptyQueue();
    const second = await queued(a);
    const c = await account();
    expect((await ranked(c)).body.opponent?.name).toBe(a.name);
    const refused = await call("/v1/duels/" + second.duelId + "/stop-waiting", post({}, a.token));
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("not_waiting");
  });

  it("a creator who never locks in leaves a match nobody can join and nothing to settle", async () => {
    const a = await account();
    const set = await ranked(a);
    await env.DB.prepare("UPDATE duels SET expires_at = ? WHERE id = ?").bind(Date.now() - 1, set.body.duelId).run();
    const b = await account();
    expect((await ranked(b)).body.opponent).toBeNull();
    expect((await read(a.token, set.body.duelId)).body).toEqual({ state: "expired", duelId: set.body.duelId, match: null });
    const res = await env.DB.prepare("SELECT COUNT(*) AS n FROM match_resolutions WHERE match_id = ?").bind(await matchOf(set.body.duelId)).first<{ n: number }>();
    expect(res?.n).toBe(0);
  });
});

describe("queue rules", () => {
  it("skips an opponent faced within the repeat-pair window", async () => {
    const [a, b] = [await account(), await account()];
    await queued(a);
    const first = (await ranked(b)).body;
    await lock(b.token, first, picksFor(first.puzzles));
    await emptyQueue();
    await queued(a);
    expect((await ranked(b)).body.opponent).toBeNull();
    // Outside the window they can meet again.
    await env.DB.prepare("UPDATE match_seats SET joined_at = joined_at - ? WHERE participant IN (?, ?)")
      .bind(REPEAT_PAIR_WINDOW_MS + 1000, a.participant, b.participant)
      .run();
    await emptyQueue();
    await queued(a);
    expect((await ranked(b)).body.opponent?.name).toBe(a.name);
  });

  it("matches within a rating window that widens the longer a match has waited", async () => {
    const [a, b] = [await account(), await account()];
    await env.DB.prepare("INSERT INTO ratings (account_id, rating, rated_duels, updated_at) VALUES (?, 1500, 20, 0)").bind(b.accountId).run();
    const setA = await queued(a); // creator at 1200
    expect((await ranked(b)).body.opponent).toBeNull(); // 300 apart, window 100
    await emptyQueue();
    const again = await queued(a);
    await env.DB.prepare("UPDATE matches SET created_at = created_at - ? WHERE id = ?").bind(4 * 3600 * 1000, await matchOf(again.duelId)).run();
    expect((await ranked(b)).body.opponent?.name).toBe(a.name); // window 100 + 4 x 50 = 300
    void setA;
  });

  it(`caps waiting ranked sets at ${RANKED_MAX_WAITING} per account`, async () => {
    const a = await account();
    for (let i = 0; i < RANKED_MAX_WAITING; i++) await ranked(a);
    const r = await ranked(a);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("ranked_queue_full");
  });
});

describe("limited reuse of ranked puzzles (owner decision)", () => {
  it("never deals an account a puzzle it has been shown, and skips puzzles revealed within the cooldown", async () => {
    const a = await account();
    await env.DB.prepare("DELETE FROM ranked_reveals").run(); // start from a known cooldown state
    // Everything but seven puzzles has been shown to a, and two of those seven were revealed recently.
    const shown = RANKED_IDS.slice(7);
    await env.DB.batch(shown.map((id) => env.DB.prepare("INSERT INTO ranked_exposures (account_id, puzzle_id, shown_at) VALUES (?, ?, 0)").bind(a.accountId, id)));
    const now = Date.now();
    await env.DB.batch(
      RANKED_IDS.slice(0, 2).map((id) =>
        env.DB.prepare("INSERT OR REPLACE INTO ranked_reveals (puzzle_id, last_revealed_at) VALUES (?, ?)").bind(id, now - 1000),
      ),
    );
    const set = await ranked(a);
    expect(set.status).toBe(201);
    expect(set.body.puzzles.map((p: { puzzleId: string }) => p.puzzleId).sort()).toEqual(RANKED_IDS.slice(2, 7).sort());
    // Those five are now exposed too, so nothing is left for a.
    await env.DB.prepare("UPDATE duels SET expires_at = 1 WHERE id = ?").bind(set.body.duelId).run();
    expect((await ranked(a)).body.error).toBe("ranked_exhausted");
    // Past the cooldown the two revealed puzzles are eligible again, but two unseen puzzles do not make a set.
    await env.DB.prepare("UPDATE ranked_reveals SET last_revealed_at = ? WHERE puzzle_id IN (?, ?)")
      .bind(now - RANKED_REUSE_COOLDOWN_MS - 1000, RANKED_IDS[0], RANKED_IDS[1])
      .run();
    expect((await ranked(a)).body.error).toBe("ranked_exhausted");
  });

  it("a joiner is never seated in a match containing a puzzle it has been shown", async () => {
    const [a, b] = [await account(), await account()];
    const setA = await queued(a);
    await env.DB.prepare("INSERT INTO ranked_exposures (account_id, puzzle_id, shown_at) VALUES (?, ?, 0)").bind(b.accountId, setA.puzzles[3].puzzleId).run();
    expect((await ranked(b)).body.opponent).toBeNull();
  });

  it("records exposure at issue and the reveal time at resolution", async () => {
    const [a, b] = [await account(), await account()];
    const setA = await queued(a);
    const ids = setA.puzzles.map((p: { puzzleId: string }) => p.puzzleId);
    const exposed = await env.DB.prepare("SELECT COUNT(*) AS n FROM ranked_exposures WHERE account_id = ?").bind(a.accountId).first<{ n: number }>();
    expect(exposed?.n).toBe(5);
    const before = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ranked_reveals WHERE puzzle_id IN (${ids.map(() => "?").join()}) AND last_revealed_at > ?`)
      .bind(...ids, Date.now() - 60_000)
      .first<{ n: number }>();
    expect(before?.n).toBe(0); // locked in, but nothing revealed yet
    const setB = (await ranked(b)).body;
    await lock(b.token, setB, picksFor(setB.puzzles));
    const after = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ranked_reveals WHERE puzzle_id IN (${ids.map(() => "?").join()}) AND last_revealed_at > ?`)
      .bind(...ids, Date.now() - 60_000)
      .first<{ n: number }>();
    expect(after?.n).toBe(5);
  });
});

describe("friend duels", () => {
  it("guests invite by link after locking in; the friend plays the identical set; both see each other's picks; unrated", async () => {
    const [host, pal] = [await guest(), await guest()];
    const set = (await friend(host, { kind: "era", era: "2012-2016" })).body;
    expect(set.mode).toBe("friend");
    expect(set.draw).toEqual({ kind: "era", era: "2012-2016" });
    expect(JSON.stringify(set)).not.toContain("invite");
    const waiting = (await lock(host, set, picksFor(set.puzzles, () => "home", "lean"))).body;
    expect(waiting.state).toBe("waiting");
    expectHidden(JSON.stringify(waiting));
    expect(waiting.waiting.invitePath).toMatch(/^\/duel\/join#invite=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const invite = waiting.waiting.invitePath.split("#invite=")[1];

    expect((await call("/v1/invites/accept", post({ invite }, host))).body.error).toBe("invite_own");
    const accepted = await call("/v1/invites/accept", post({ invite }, pal));
    expect(accepted.status).toBe(200);
    expectHidden(accepted.text);
    expect(accepted.body.set.puzzles).toEqual(set.puzzles);
    expect(accepted.body.set.opponent).toEqual({ kind: "player", name: "Your friend" });
    // Reopening the link returns the same seat; anyone else finds it used.
    expect((await call("/v1/invites/accept", post({ invite }, pal))).body).toEqual({ duelId: accepted.body.duelId, set: null });
    expect((await call("/v1/invites/accept", post({ invite }, await guest()))).body.error).toBe("invite_unavailable");

    const done = (await lock(pal, accepted.body.set, picksFor(set.puzzles, () => "away", "confident"))).body;
    expect(done.state).toBe("revealed");
    expect(done.result.match).toEqual({ settledBy: "both-locked", rated: false, rating: null });
    const hostResult = (await read(host, set.duelId)).body.result;
    expect(hostResult.opponent.picks).toEqual(done.result.you.picks);
    expect(done.result.opponent.picks).toEqual(hostResult.you.picks);
    const ratings = await env.DB.prepare("SELECT COUNT(*) AS n FROM rating_changes WHERE match_id = ?").bind(await matchOf(set.duelId)).first<{ n: number }>();
    expect(ratings?.n).toBe(0);
  });

  it("rejects forged and non-friend invites", async () => {
    const pal = await guest();
    const forged = await sign({ v: 1, typ: "invite", match: "m_nope" }, "wrong-secret-0123456789");
    for (const invite of ["", "x.y", forged, await sign({ v: 1, typ: "invite", match: "m_nope" }, env.SET_TOKEN_SECRET), 42]) {
      expect((await call("/v1/invites/accept", post({ invite }, pal))).body.error).toBe("invite_unavailable");
    }
    // A ranked match cannot be entered by invite.
    const a = await account();
    const setA = await queued(a);
    const rankedInvite = await sign({ v: 1, typ: "invite", match: await matchOf(setA.duelId) }, env.SET_TOKEN_SECRET);
    expect((await call("/v1/invites/accept", post({ invite: rankedInvite }, pal))).body.error).toBe("invite_unavailable");
  });

  it("an unanswered invite reveals solo when it closes, and the host can stop waiting early", async () => {
    const host = await guest();
    const set = (await friend(host)).body;
    await lock(host, set, picksFor(set.puzzles));
    const stopped = await call("/v1/duels/" + set.duelId + "/stop-waiting", post({}, host));
    expect(stopped.body.result.opponent).toBeNull();
    expect(stopped.body.result.match).toEqual({ settledBy: "no-opponent", rated: false, rating: null });
    const invite = (await sign({ v: 1, typ: "invite", match: await matchOf(set.duelId) }, env.SET_TOKEN_SECRET));
    expect((await call("/v1/invites/accept", post({ invite }, await guest()))).body.error).toBe("invite_unavailable");
  });

  it("a guest host who signs in keeps the waiting match", async () => {
    const host = await guest();
    const set = (await friend(host)).body;
    const waiting = (await lock(host, set, picksFor(set.puzzles))).body;
    const email = "host." + unique() + "@example.com";
    await call("/v1/auth/magic-link", post({ email, turnstileToken: TURNSTILE_DUMMY_TOKEN }));
    const link = /#token=(ml_[A-Za-z0-9_-]+)/.exec([...mailer.sent].reverse().find((m) => m.to === email)!.text)![1];
    const session = (await call("/v1/auth/verify", post({ token: link, guestToken: host }))).body.sessionToken as string;
    const r = await read(session, set.duelId);
    expect(r.body).toEqual(waiting);
    const pal = await guest();
    const invite = waiting.waiting.invitePath.split("#invite=")[1];
    const joined = (await call("/v1/invites/accept", post({ invite }, pal))).body;
    await lock(pal, joined.set, picksFor(set.puzzles));
    expect((await read(session, set.duelId)).body.state).toBe("revealed");
  });
});
