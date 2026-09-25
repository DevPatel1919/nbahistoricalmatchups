// Shared helpers for the ranked and integrity suites: accounts made through the
// real sign-in flow, ranked sets played through the API, and the fixture pool's
// answers for building right or wrong picks.

import { env } from "cloudflare:test";
import { expect } from "vitest";
import { RANKED_MIN_COMPLETED_DUELS } from "../src/accounts";
import { handle } from "../src/index";
import { DummyTokenCheck, MemoryMailer, TURNSTILE_DUMMY_TOKEN } from "../src/services";
import { sha256Hex } from "../src/tokens";
import { fixturePoolEntries } from "../scripts/fixture-pool.mjs";

export const mailer = new MemoryMailer();
let counter = 0;
export const unique = () => ++counter + "-" + Math.random().toString(36).slice(2, 8);
export const freshIp = () => "198.18.0." + (counter % 250) + "-" + unique();

export const ANSWERS = new Map(
  fixturePoolEntries()
    .filter((e) => e.key.includes(":puzzle:"))
    .map((e) => {
      const p = JSON.parse(e.value);
      return [p.view.puzzleId as string, p.answer];
    }),
);
export const RANKED_IDS = [...ANSWERS.values()].filter((a) => a.partition === "ranked").map((a) => a.puzzleId as string);

export type CallInit = RequestInit & { ip?: string; env?: typeof env };

export async function call(path: string, init: CallInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", init.ip ?? freshIp());
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await handle(new Request("https://duel.test" + path, { ...init, headers }), init.env ?? env, {
    mailer,
    humanCheck: new DummyTokenCheck(),
  });
  const text = await response.text();
  return { status: response.status, text, body: text ? JSON.parse(text) : null, headers: response.headers };
}

export const auth = (token: string) => ({ authorization: "Bearer " + token });
export const post = (body: unknown, token?: string, ip?: string): CallInit => ({
  method: "POST",
  body: JSON.stringify(body),
  headers: token ? auth(token) : {},
  ip,
});

export type Player = { token: string; accountId: string; participant: string; name: string };

/**
 * A signed-in account. `eligible` fast-tracks the Session 5 gate (tested in
 * accounts.test.ts) with completed sets written directly. `ip` is the network
 * the account is created from.
 */
export async function account(eligible = true, ip?: string): Promise<Player> {
  const email = "ranked." + unique() + "@example.com";
  expect((await call("/v1/auth/magic-link", post({ email, turnstileToken: TURNSTILE_DUMMY_TOKEN }, undefined, ip))).status).toBe(202);
  const link = /#token=(ml_[A-Za-z0-9_-]+)/.exec([...mailer.sent].reverse().find((m) => m.to === email)!.text)![1];
  const signed = await call("/v1/auth/verify", post({ token: link }, undefined, ip));
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

export async function guest(): Promise<string> {
  const r = await call("/v1/guests", { method: "POST" });
  expect(r.status).toBe(201);
  return r.body.guestToken;
}

export const ranked = (p: Player) => call("/v1/sets", post({ mode: "ranked" }, p.token));
export const friend = (token: string, draw: object = { kind: "random" }) => call("/v1/sets", post({ mode: "friend", draw }, token));
export const read = (token: string, duelId: string) => call("/v1/duels/" + duelId, { headers: auth(token) });

export type Side = "home" | "away";
export type Conf = "lean" | "confident" | "lock";
export type PuzzleRef = { puzzleId: string };

export function picksFor(puzzles: PuzzleRef[], side: (i: number) => Side = (i) => (i % 2 ? "away" : "home"), conf: Conf = "confident") {
  return puzzles.map((p, i) => ({ puzzleId: p.puzzleId, side: side(i), confidence: conf }));
}
export function rightPicks(puzzles: PuzzleRef[]) {
  return puzzles.map((p) => ({ puzzleId: p.puzzleId, side: ANSWERS.get(p.puzzleId).actualWinner as Side, confidence: "lock" as Conf }));
}
export function wrongPicks(puzzles: PuzzleRef[]) {
  return puzzles.map((p) => ({
    puzzleId: p.puzzleId,
    side: (ANSWERS.get(p.puzzleId).actualWinner === "home" ? "away" : "home") as Side,
    confidence: "lock" as Conf,
  }));
}
/** The first `right` picks correct, the rest wrong, all at "confident". */
export function mixedPicks(puzzles: PuzzleRef[], right: number) {
  return puzzles.map((p, i) => {
    const winner = ANSWERS.get(p.puzzleId).actualWinner as Side;
    return { puzzleId: p.puzzleId, side: (i < right ? winner : winner === "home" ? "away" : "home") as Side, confidence: "confident" as Conf };
  });
}

export async function lock(token: string, set: { duelId: string; setToken: string }, picks: object[], key = unique()) {
  return call("/v1/duels/" + set.duelId + "/submission", {
    method: "POST",
    headers: { ...auth(token), "idempotency-key": key },
    body: JSON.stringify({ setToken: set.setToken, picks }),
  });
}

/** Moves a set's issue time back, so its lock-in is measured as a human-paced one. */
export async function thinkFor(duelId: string, ms: number) {
  await env.DB.prepare("UPDATE duels SET issued_at = issued_at - ? WHERE id = ?").bind(ms, duelId).run();
}

export async function matchOf(duelId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT match_id FROM duels WHERE id = ?").bind(duelId).first<{ match_id: string }>();
  return row!.match_id;
}

/** Closes every open match so a test's queue holds only what it creates. */
export async function emptyQueue() {
  await env.DB.prepare("UPDATE matches SET open_until = 1 WHERE open_until > 1").run();
}

/** A creator's ranked set, locked in and waiting. */
export async function queued(creator: Player, picks: (p: PuzzleRef[]) => object[] = picksFor) {
  const set = await ranked(creator);
  expect(set.status).toBe(201);
  expect(set.body.opponent).toBeNull();
  const locked = await lock(creator.token, set.body, picks(set.body.puzzles));
  expect(locked.status).toBe(200);
  expect(locked.body.state).toBe("waiting");
  return set.body;
}
