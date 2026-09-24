// F09 Session 3 acceptance: the abuse model's controls for guest play.

import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { pointsFor } from "../../frontend/src/duel";
import { fixturePoolEntries } from "../scripts/fixture-pool.mjs";
import { SET_TTL_MS } from "../src/play";
import { sign } from "../src/tokens";

const ORIGIN = "http://localhost:4317";
const ANSWERS = new Map(
  fixturePoolEntries()
    .filter((e) => e.key.includes(":puzzle:"))
    .map((e) => {
      const p = JSON.parse(e.value);
      return [p.view.puzzleId, p.answer];
    }),
);
// Words and values that must never appear in a pre-lock response.
const ANSWER_MARKERS = [
  "actualWinner",
  "modelHomeWinProbability",
  "modelInSample",
  "partition",
  "band",
  "0.871234",
  "0.691234",
  "0.541234",
  "0.128766",
  "0.308766",
  "0.458766",
];

// `wrangler types` would declare this; the cast keeps generated files out of the repo.
const worker = (exports as unknown as { default: Fetcher }).default;

let ipCounter = 0;
const freshIp = () => "203.0.113." + (++ipCounter % 250) + "-" + ipCounter;

async function call(path: string, init: RequestInit & { ip?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", init.ip ?? "198.51.100.7");
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await worker.fetch(new Request("https://duel.test" + path, { ...init, headers }));
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, body: text ? JSON.parse(text) : null };
}

async function guest(ip = freshIp()): Promise<string> {
  const r = await call("/v1/guests", { method: "POST", ip });
  expect(r.status).toBe(201);
  return r.body.guestToken;
}

const auth = (token: string) => ({ authorization: "Bearer " + token });

async function issue(token: string, mode = "solo", draw: object = { kind: "random" }) {
  return call("/v1/sets", { method: "POST", headers: auth(token), body: JSON.stringify({ mode, draw }), ip: freshIp() });
}

function honestPicks(puzzles: { puzzleId: string }[]) {
  return puzzles.map((p, i) => ({ puzzleId: p.puzzleId, side: i % 2 ? "away" : "home", confidence: "confident" }));
}

async function submit(token: string, duelId: string, body: object, key = "key-" + Math.random()) {
  return call("/v1/duels/" + duelId + "/submission", {
    method: "POST",
    headers: { ...auth(token), "idempotency-key": key },
    body: JSON.stringify(body),
  });
}

function expectNoAnswer(text: string) {
  for (const marker of ANSWER_MARKERS) expect(text, marker).not.toContain(marker);
}

describe("puzzle issuance", () => {
  it("issues five whitelisted puzzles with no answer or model probability", async () => {
    const token = await guest();
    const r = await issue(token, "bot", { kind: "era", era: "2005-2011" });
    expect(r.status).toBe(201);
    expectNoAnswer(r.text);
    expect(Object.keys(r.body).sort()).toEqual(["draw", "duelId", "expiresAt", "mode", "opponent", "puzzles", "setToken"]);
    expect(r.body.puzzles).toHaveLength(5);
    for (const p of r.body.puzzles) {
      expect(Object.keys(p).sort()).toEqual(["away", "era", "home", "isPlayoffGame", "puzzleId"]);
      expect(p.era).toBe("2005-2011");
      for (const side of [p.home, p.away]) {
        expect(Object.keys(side).sort()).toEqual([
          "backToBack",
          "city",
          "last10NetRating",
          "last10WinPct",
          "lossesEntering",
          "missingRotationStrength",
          "name",
          "restDays",
          "winsEntering",
        ]);
      }
    }
    expect(r.body.opponent).toEqual({
      kind: "bot",
      name: "Sparring Partner",
      disclosure: "Skill-matched practice opponent, not a model prediction.",
    });
  });

  it("draws the unranked composition from the sim partition only", async () => {
    const token = await guest();
    for (let n = 0; n < 5; n++) {
      const r = await issue(token);
      const bands = r.body.puzzles.map((p: { puzzleId: string }) => ANSWERS.get(p.puzzleId).band).sort();
      expect(bands).toEqual(["favorite", "favorite", "lock", "tossup", "tossup"]);
      for (const p of r.body.puzzles) expect(ANSWERS.get(p.puzzleId).partition).toBe("sim");
    }
  });

  it("rejects missing or forged guest tokens and bad bodies", async () => {
    expect((await issue("nope")).status).toBe(401);
    const forged = await sign({ v: 1, typ: "guest", sub: "g_forged" }, "wrong-secret-0123456789");
    expect((await issue(forged)).status).toBe(401);
    const unknownGuest = await sign({ v: 1, typ: "guest", sub: "g_never_created" }, env.GUEST_TOKEN_SECRET);
    expect((await issue(unknownGuest)).status).toBe(401);
    const token = await guest();
    expect((await issue(token, "ranked")).status).toBe(400);
    expect((await issue(token, "solo", { kind: "era", era: "1990-1997" })).status).toBe(400);
  });
});

describe("no answer before lock, on any path", () => {
  it("covers open reads, every error, and pool failures", async () => {
    const token = await guest();
    const set = await issue(token);
    const texts: string[] = [set.text];
    const duel = set.body.duelId;
    texts.push((await call("/v1/duels/" + duel, { headers: auth(token) })).text);
    texts.push((await submit(token, duel, { setToken: "bad", picks: [] })).text);
    texts.push((await submit(token, duel, { setToken: set.body.setToken, picks: [] })).text);
    texts.push((await submit(token, duel, { setToken: set.body.setToken, picks: "x" })).text);
    texts.push((await call("/v1/duels/" + duel + "/submission", { method: "POST", headers: auth(token), body: "{" })).text);
    texts.push((await call("/v1/duels/d_missing", { headers: auth(token) })).text);
    texts.push((await call("/v1/unknown")).text);
    const other = await guest();
    texts.push((await call("/v1/duels/" + duel, { headers: auth(other) })).text);

    // Break the pool: remove one puzzle the next draw may need.
    const victim = "pool:duel-pool-v1:puzzle:" + set.body.puzzles[0].puzzleId;
    const saved = await env.POOL.get(victim);
    await env.POOL.delete(victim);
    texts.push((await call("/v1/duels/" + duel, { headers: auth(token) })).text);
    await env.POOL.put(victim, saved as string);

    for (const text of texts) expectNoAnswer(text);
  });

  it("answers the pool-unavailable case with a fixed 503", async () => {
    const token = await guest();
    const key = "pool:duel-pool-v1:index:sim:all:lock";
    const saved = await env.POOL.get(key);
    await env.POOL.delete(key);
    const r = await issue(token);
    await env.POOL.put(key, saved as string);
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: "pool_unavailable", message: "Duel puzzles are not available right now." });
  });
});

describe("submission", () => {
  it("scores server-side, reveals, ignores client-supplied scores, and records served answers", async () => {
    const token = await guest();
    const set = await issue(token);
    const picks = honestPicks(set.body.puzzles).map((p) => ({ ...p, points: 999, correct: true }));
    const r = await submit(token, set.body.duelId, { setToken: set.body.setToken, picks });
    expect(r.status).toBe(200);
    const expected = picks.reduce((sum, p) => {
      const correct = ANSWERS.get(p.puzzleId).actualWinner === p.side;
      return sum + pointsFor(correct ? 0.7 : 0.3);
    }, 0);
    expect(r.body.you.total).toBe(expected);
    expect(r.body.opponent).toBeNull();
    expect(r.body.model.label).toBe("Pre-game model");
    expect(r.body.model.picks).toHaveLength(5);
    expect(r.body.model.trainedThroughSeason).toBe(2021);
    for (const [i, p] of r.body.puzzles.entries()) {
      expect(p.actualWinner).toBe(ANSWERS.get(p.puzzleId).actualWinner);
      const m = ANSWERS.get(p.puzzleId).modelHomeWinProbability;
      expect(r.body.model.picks[i].points).toBe(pointsFor(p.actualWinner === "home" ? m : 1 - m));
    }
    const served = await env.DB.prepare("SELECT COUNT(*) AS n FROM served_answers WHERE puzzle_id IN (?, ?, ?, ?, ?)")
      .bind(...set.body.puzzles.map((p: { puzzleId: string }) => p.puzzleId))
      .first<{ n: number }>();
    expect(served?.n).toBe(5);
    const row = await env.DB.prepare("SELECT ms_to_submit FROM submissions WHERE duel_id = ?").bind(set.body.duelId).first<{ ms_to_submit: number }>();
    expect(row?.ms_to_submit).toBeGreaterThanOrEqual(0);
  });

  it("bot duels reveal a disclosed Sparring Partner beside the model benchmark", async () => {
    const token = await guest();
    const set = await issue(token, "bot");
    const r = await submit(token, set.body.duelId, { setToken: set.body.setToken, picks: honestPicks(set.body.puzzles) });
    expect(r.status).toBe(200);
    expect(r.body.opponent.name).toBe("Sparring Partner");
    expect(r.body.opponent.disclosure).toMatch(/not a model prediction/);
    expect(["you", "opponent", "draw"]).toContain(r.body.opponent.outcome);
    expect(r.body.opponent.picks).toHaveLength(5);
    expect(r.body.model.label).toBe("Pre-game model");
  });

  it("rejects submissions without a matching issued token", async () => {
    const token = await guest();
    const a = await issue(token);
    const b = await issue(token);
    const picks = honestPicks(a.body.puzzles);
    expect((await submit(token, a.body.duelId, { picks })).status).toBe(403);
    expect((await submit(token, a.body.duelId, { setToken: b.body.setToken, picks })).status).toBe(403);
    const tampered = a.body.setToken.slice(0, -2) + (a.body.setToken.endsWith("AA") ? "BB" : "AA");
    expect((await submit(token, a.body.duelId, { setToken: tampered, picks })).status).toBe(403);
    const other = await guest();
    expect((await submit(other, a.body.duelId, { setToken: a.body.setToken, picks })).status).toBe(403);
    const forgedForOther = await sign(
      { v: 1, typ: "set", sub: "g:" + "someone", duel: a.body.duelId, exp: Date.now() + 60_000 },
      env.SET_TOKEN_SECRET,
    );
    expect((await submit(token, a.body.duelId, { setToken: forgedForOther, picks })).status).toBe(403);
  });

  it("validates picks: exactly one per issued puzzle", async () => {
    const token = await guest();
    const set = await issue(token);
    const picks = honestPicks(set.body.puzzles);
    const bad = [
      picks.slice(0, 4),
      [...picks.slice(0, 4), picks[0]],
      [...picks.slice(0, 4), { ...picks[4], puzzleId: "pz_other" }],
      [...picks.slice(0, 4), { ...picks[4], confidence: "certain" }],
      [...picks.slice(0, 4), { ...picks[4], side: "neutral" }],
    ];
    for (const b of bad) expect((await submit(token, set.body.duelId, { setToken: set.body.setToken, picks: b })).status).toBe(400);
    const noKey = await call("/v1/duels/" + set.body.duelId + "/submission", {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ setToken: set.body.setToken, picks }),
    });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error).toBe("missing_idempotency_key");
  });

  it("blocks double submission; a same-key retry gets the original result", async () => {
    const token = await guest();
    const set = await issue(token);
    const body = { setToken: set.body.setToken, picks: honestPicks(set.body.puzzles) };
    const first = await submit(token, set.body.duelId, body, "k1");
    const retry = await submit(token, set.body.duelId, body, "k1");
    const second = await submit(token, set.body.duelId, { ...body, picks: body.picks.map((p) => ({ ...p, confidence: "lock" })) }, "k2");
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect(second.status).toBe(409);
  });

  it("lets only one of many concurrent submissions through", async () => {
    const token = await guest();
    const set = await issue(token);
    const body = { setToken: set.body.setToken, picks: honestPicks(set.body.puzzles) };
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => submit(token, set.body.duelId, body, "race-" + i)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE duel_id = ?").bind(set.body.duelId).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("the database itself rejects a second submission row", async () => {
    const token = await guest();
    const set = await issue(token);
    await submit(token, set.body.duelId, { setToken: set.body.setToken, picks: honestPicks(set.body.puzzles) }, "db");
    const participant = (await env.DB.prepare("SELECT issued_to FROM duels WHERE id = ?").bind(set.body.duelId).first<{ issued_to: string }>())?.issued_to;
    await expect(
      env.DB.prepare(
        "INSERT INTO submissions (duel_id, participant, idempotency_key, submitted_at, ms_to_submit, total_points, result) VALUES (?, ?, 'other', 0, 0, 0, '{}')",
      ).bind(set.body.duelId, participant).run(),
    ).rejects.toThrow(/UNIQUE|PRIMARY KEY/);
  });

  it("enforces the set token TTL", async () => {
    const token = await guest();
    const set = await issue(token);
    expect(set.body.expiresAt - Date.now()).toBeLessThanOrEqual(SET_TTL_MS);
    const participant = (await env.DB.prepare("SELECT issued_to FROM duels WHERE id = ?").bind(set.body.duelId).first<{ issued_to: string }>())?.issued_to;
    const picks = honestPicks(set.body.puzzles);

    const expiredToken = await sign({ v: 1, typ: "set", sub: participant, duel: set.body.duelId, exp: Date.now() - 1 }, env.SET_TOKEN_SECRET);
    const r1 = await submit(token, set.body.duelId, { setToken: expiredToken, picks });
    expect(r1.status).toBe(403);
    expect(r1.body.error).toBe("set_expired");

    // A still-valid token cannot outlive the issued set either.
    await env.DB.prepare("UPDATE duels SET expires_at = ? WHERE id = ?").bind(Date.now() - 1, set.body.duelId).run();
    const r2 = await submit(token, set.body.duelId, { setToken: set.body.setToken, picks });
    expect(r2.body.error).toBe("set_expired");
    expect((await call("/v1/duels/" + set.body.duelId, { headers: auth(token) })).body.state).toBe("expired");
  });

  it("serves the revealed result on reload to its owner only", async () => {
    const token = await guest();
    const set = await issue(token, "bot");
    const open = await call("/v1/duels/" + set.body.duelId, { headers: auth(token) });
    expect(open.body.state).toBe("open");
    expect(open.body.set.puzzles).toEqual(set.body.puzzles);
    const r = await submit(token, set.body.duelId, { setToken: set.body.setToken, picks: honestPicks(set.body.puzzles) });
    const again = await call("/v1/duels/" + set.body.duelId, { headers: auth(token) });
    expect(again.body).toEqual({ state: "revealed", result: r.body });
    expect((await call("/v1/duels/" + set.body.duelId, { headers: auth(await guest()) })).status).toBe(404);
  });
});

describe("rate limits", () => {
  it("limits guest creation per IP with 429 and Retry-After", async () => {
    const ip = "192.0.2.55";
    for (let i = 0; i < 10; i++) expect((await call("/v1/guests", { method: "POST", ip })).status).toBe(201);
    const limited = await call("/v1/guests", { method: "POST", ip });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe("rate_limited");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await call("/v1/guests", { method: "POST", ip: "192.0.2.56" })).status).toBe(201);
  });

  it("limits set issuance per participant", async () => {
    const token = await guest();
    for (let i = 0; i < 40; i++) expect((await issue(token)).status).toBe(201);
    const limited = await issue(token);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await issue(await guest())).status).toBe(201);
  });

  it("stores no raw IP address in rate-limit keys", async () => {
    await call("/v1/guests", { method: "POST", ip: "192.0.2.201" });
    const keys = await env.RATE_LIMITS.list();
    expect(keys.keys.length).toBeGreaterThan(0);
    for (const k of keys.keys) expect(k.name).not.toContain("192.0.2");
  });
});

describe("CORS and health", () => {
  it("allows only configured origins", async () => {
    const ok = await call("/v1/health", { headers: { origin: ORIGIN } });
    expect(ok.body).toEqual({ ok: true, poolVersion: "duel-pool-v1" });
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const evil = await call("/v1/health", { headers: { origin: "https://evil.example" } });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    const preflight = await call("/v1/sets", { method: "OPTIONS", headers: { origin: ORIGIN } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("idempotency-key");
  });
});

describe("configuration", () => {
  it("ships with unscaled rate limits", () => {
    expect(env.RATE_LIMIT_SCALE).toBe("1");
  });
});

describe("rate limit scale", () => {
  it("treats a missing or malformed scale as 1", async () => {
    const { enforce } = await import("../src/ratelimit");
    const limit = { name: "scale-test", max: 2, windowSeconds: 3600 };
    for (const [i, scale] of [Number(undefined), Number("abc"), 0].entries()) {
      const subject = "scale-subject-" + i;
      await enforce(env.RATE_LIMITS, limit, subject, scale);
      await enforce(env.RATE_LIMITS, limit, subject, scale);
      await expect(enforce(env.RATE_LIMITS, limit, subject, scale)).rejects.toThrow("rate_limited");
    }
  });
});
