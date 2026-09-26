// F09 Session 8: privacy. Account deletion removes every row keyed to the
// account while leaving opponents' results and ratings valid; it is refused
// while a match is in progress; the purge drops abandoned sets and guests that
// never played; the network signal survives a deleted account.

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { DELETED_PLAYER_NAME, RANKED_MIN_COMPLETED_DUELS } from "../src/accounts";
import { GUEST_IDLE_PURGE_MS, PURGE_GRACE_MS, purgeExpired, raiseFlags } from "../src/integrity";
import { REPEAT_PAIR_WINDOW_MS } from "../src/matches";
import { TURNSTILE_DUMMY_TOKEN } from "../src/services";
import { sha256Hex } from "../src/tokens";
import {
  account,
  auth,
  call,
  emptyQueue,
  guest,
  lock,
  mailer,
  picksFor,
  post,
  queued,
  ranked,
  read,
  unique,
  type Player,
} from "./helpers";

const del = (p: { token: string }, body: unknown = { confirm: true }) => call("/v1/account/delete", post(body, p.token));

/** Every row in every table, as text, for "is it still anywhere" checks. */
async function everything(): Promise<string> {
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'",
  ).all<{ name: string }>();
  const dumps = await Promise.all(tables.results.map((t) => env.DB.prepare("SELECT * FROM " + t.name).all()));
  return dumps.map((d, i) => tables.results[i].name + ":" + JSON.stringify(d.results)).join("\n");
}

async function emailHashOf(p: Player): Promise<string> {
  const row = await env.DB.prepare("SELECT email_hash FROM accounts WHERE id = ?").bind(p.accountId).first<{ email_hash: string }>();
  return row!.email_hash;
}

/** A rated match between two accounts, both locked in. */
async function ratedMatch(creator: Player, joiner: Player) {
  await env.DB.prepare("DELETE FROM ranked_reveals").run();
  await emptyQueue();
  const set = await queued(creator);
  await env.DB.prepare("DELETE FROM ranked_exposures WHERE account_id = ?").bind(joiner.accountId).run();
  const joined = (await ranked(joiner)).body;
  expect(joined.opponent?.name).toBe(creator.name);
  expect((await lock(joiner.token, joined, picksFor(joined.puzzles))).body.state).toBe("revealed");
  // Outside the matchmaker's repeat-pair window, so the same two can meet again.
  await env.DB.prepare("UPDATE match_seats SET joined_at = joined_at - ? WHERE duel_id IN (?, ?)")
    .bind(REPEAT_PAIR_WINDOW_MS + 3600_000, set.duelId, joined.duelId).run();
  return { creatorDuel: set.duelId as string, joinerDuel: joined.duelId as string };
}

describe("account deletion", () => {
  it("removes every row keyed to the account; opponents keep valid results and ratings", async () => {
    // Guest history merged at sign-in, then solo play, a rated match, a waiting
    // ranked set, a flag, and a network link.
    const guestToken = await guest();
    const solo = (await call("/v1/sets", post({ mode: "solo", draw: { kind: "random" } }, guestToken))).body;
    await lock(guestToken, solo, picksFor(solo.puzzles));
    const email = "leaver." + unique() + "@example.com";
    await call("/v1/auth/magic-link", post({ email, turnstileToken: TURNSTILE_DUMMY_TOKEN }));
    const link = /#token=(ml_[A-Za-z0-9_-]+)/.exec([...mailer.sent].reverse().find((m) => m.to === email)!.text)![1];
    const signed = await call("/v1/auth/verify", post({ token: link, guestToken }));
    expect(signed.status).toBe(200);
    const token = signed.body.sessionToken as string;
    const row = await env.DB.prepare("SELECT account_id FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).first<{ account_id: string }>();
    const leaver: Player = { token, accountId: row!.account_id, participant: "a:" + row!.account_id, name: "Leaver " + (Date.now() % 100000) };
    // Ranked eligibility, fast-tracked as in helpers.ts: ten completed sets and a name.
    await env.DB.batch(
      Array.from({ length: RANKED_MIN_COMPLETED_DUELS }, () => {
        const duelId = "d_seed_" + unique();
        return [
          env.DB.prepare(
            `INSERT INTO duels (id, mode, partition, draw_kind, puzzle_ids, pool_version, issued_to, issued_at, expires_at)
             VALUES (?, 'solo', 'sim', 'random', '[]', 'duel-pool-v1', ?, 0, 1)`,
          ).bind(duelId, leaver.participant),
          env.DB.prepare(
            "INSERT INTO submissions (duel_id, participant, idempotency_key, submitted_at, ms_to_submit, total_points, result) VALUES (?, ?, ?, 0, 0, 0, '{}')",
          ).bind(duelId, leaver.participant, unique()),
        ];
      }).flat(),
    );
    expect((await call("/v1/account/display-name", post({ displayName: leaver.name }, token))).status).toBe(200);
    const other = await account();

    await ratedMatch(leaver, other);
    await ratedMatch(other, leaver);
    await queued(leaver); // waiting, nobody joined
    await raiseFlags(env, [{ accountId: leaver.accountId, kind: "scripted_timing", related: "", evidence: { sets: 5 } }], Date.now());
    const [lo, hi] = [leaver.accountId, other.accountId].sort();
    await env.DB.prepare("INSERT INTO account_links (account_id, linked_id, reason, created_at) VALUES (?, ?, 'creation-network', ?)")
      .bind(lo, hi, Date.now()).run();
    const hash = await emailHashOf(leaver);

    const otherBefore = (await call("/v1/account", { headers: auth(other.token) })).body;
    const otherLedger = await env.DB.prepare("SELECT COUNT(*) AS n FROM rating_changes WHERE account_id = ?").bind(other.accountId).first<{ n: number }>();
    expect(otherLedger!.n).toBe(2);
    expect(await everything()).toContain(leaver.name);

    expect((await del(leaver)).body).toEqual({ ok: true });

    const all = await everything();
    for (const trace of [leaver.accountId, hash, leaver.name]) expect(all).not.toContain(trace);
    // The old session and the merged guest token are both dead.
    expect((await call("/v1/account", { headers: auth(leaver.token) })).status).toBe(401);
    expect((await call("/v1/sets", post({ mode: "solo", draw: { kind: "random" } }, guestToken))).status).toBe(401);

    // The opponent's rating, ledger, results, and board standing are untouched.
    const otherAfter = (await call("/v1/account", { headers: auth(other.token) })).body;
    expect(otherAfter.rating).toEqual(otherBefore.rating);
    const ledger = await env.DB.prepare(
      "SELECT rating_before, rating_after, delta FROM rating_changes WHERE account_id = ? ORDER BY created_at",
    ).bind(other.accountId).all<{ rating_before: number; rating_after: number; delta: number }>();
    expect(ledger.results).toHaveLength(2);
    expect(ledger.results[1].rating_before).toBe(ledger.results[0].rating_after);
    expect(ledger.results[1].rating_after).toBe(otherAfter.rating.rating);
    const seats = await env.DB.prepare("SELECT duel_id FROM match_seats WHERE participant = ?").bind(other.participant).all<{ duel_id: string }>();
    for (const { duel_id } of seats.results) {
      const state = (await read(other.token, duel_id)).body;
      expect(state.state).toBe("revealed");
      expect(state.result.opponent.name).toBe(DELETED_PLAYER_NAME);
    }
    const board = (await call("/v1/leaderboard?board=daily")).body;
    expect(board.entries.map((e: { name: string }) => e.name)).toContain(other.name);
  });

  it("an address that deleted its account starts over with a fresh account", async () => {
    const email = "again." + unique() + "@example.com";
    const signIn = async () => {
      await call("/v1/auth/magic-link", post({ email, turnstileToken: TURNSTILE_DUMMY_TOKEN }));
      const link = /#token=(ml_[A-Za-z0-9_-]+)/.exec([...mailer.sent].reverse().find((m) => m.to === email)!.text)![1];
      return (await call("/v1/auth/verify", post({ token: link }))).body;
    };
    const first = await signIn();
    expect((await call("/v1/account/display-name", post({ displayName: "Leaver " + (Date.now() % 100000) }, first.sessionToken))).status).toBe(200);
    expect((await del({ token: first.sessionToken })).status).toBe(200);
    const second = await signIn();
    expect(second.account.displayName).toBeNull();
    expect(second.account.completedDuels).toBe(0);
    expect(second.account.rating).toBeNull();
  });

  it("is refused while a match with an opponent is in progress, and nothing is deleted", async () => {
    const creator = await account();
    const joiner = await account();
    await env.DB.prepare("DELETE FROM ranked_reveals").run();
    await emptyQueue();
    await queued(creator);
    const joined = (await ranked(joiner)).body;
    expect(joined.opponent?.name).toBe(creator.name);

    for (const p of [creator, joiner]) {
      const r = await del(p);
      expect(r.status).toBe(409);
      expect(r.body.error).toBe("match_in_progress");
      expect((await call("/v1/account", { headers: auth(p.token) })).status).toBe(200);
    }
    // Once it settles, deletion goes through.
    expect((await lock(joiner.token, joined, picksFor(joined.puzzles))).body.state).toBe("revealed");
    expect((await del(creator)).status).toBe(200);
    expect((await read(joiner.token, joined.duelId)).body.result.opponent.name).toBe(DELETED_PLAYER_NAME);
  });

  it("needs a session and an explicit confirmation", async () => {
    const p = await account(false);
    expect((await call("/v1/account/delete", post({ confirm: true }))).status).toBe(401);
    expect((await call("/v1/account/delete", post({ confirm: true }, await guest()))).status).toBe(401);
    for (const body of [{}, { confirm: "yes" }, { confirm: 1 }]) expect((await del(p, body)).status).toBe(400);
    expect((await call("/v1/account", { headers: auth(p.token) })).status).toBe(200);
  });
});

describe("the purge", () => {
  it("drops expired unplayed solo sets and never-played guests; keeps anything played", async () => {
    const now = Date.now();
    const idle = await guest();
    const player = await guest();
    const played = (await call("/v1/sets", post({ mode: "solo", draw: { kind: "random" } }, player))).body;
    await lock(player, played, picksFor(played.puzzles));
    const abandoned = (await call("/v1/sets", post({ mode: "bot", draw: { kind: "random" } }, player))).body;
    const fresh = (await call("/v1/sets", post({ mode: "solo", draw: { kind: "random" } }, player))).body;
    // Age everything past its grace period, except the fresh set.
    await env.DB.prepare("UPDATE duels SET expires_at = ? WHERE id IN (?, ?)").bind(now - PURGE_GRACE_MS - 1, played.duelId, abandoned.duelId).run();
    await env.DB.prepare("UPDATE guests SET created_at = ?").bind(now - GUEST_IDLE_PURGE_MS - 1).run();

    await purgeExpired(env, now);

    const duels = await env.DB.prepare("SELECT id FROM duels WHERE id IN (?, ?, ?)").bind(played.duelId, abandoned.duelId, fresh.duelId).all<{ id: string }>();
    expect(duels.results.map((d) => d.id).sort()).toEqual([played.duelId, fresh.duelId].sort());
    // The idle guest's token no longer works (the site then issues a new one); the player's does.
    expect((await call("/v1/sets", post({ mode: "solo", draw: { kind: "random" } }, idle))).status).toBe(401);
    expect((await read(player, played.duelId)).body.state).toBe("revealed");
  });
});

describe("the multi-account network signal", () => {
  it("skips an account deleted since it was listed, and still links the rest", async () => {
    const ip = "203.0.113." + (Date.now() % 250);
    const a = await account(false, ip);
    const b = await account(false, ip);
    expect((await del(a)).status).toBe(200);
    const c = await account(false, ip);
    const [lo, hi] = [b.accountId, c.accountId].sort();
    const link = await env.DB.prepare("SELECT 1 FROM account_links WHERE account_id = ? AND linked_id = ?").bind(lo, hi).first();
    expect(link).not.toBeNull();
  });
});
