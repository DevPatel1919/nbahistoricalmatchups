// F12 Session 4: Daily Three crowd stats. One result per browser per puzzle,
// validated, rate-limited, tallied by a trigger, and read back as one row.

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import meta from "../../frontend/public/data/daily/meta.json";
import { DAILY_LAUNCH_DATE, DAILY_WINDOW, openPuzzle, utcPuzzleNumber } from "../src/daily";
import { LIMITS } from "../src/ratelimit";
import { call, freshIp, post, type CallInit } from "./helpers";
import { measure } from "./meter";

const ORIGIN = "http://localhost:4317";
const today = () => utcPuzzleNumber(Date.now());
const result = (n: number, body: unknown, init: Partial<CallInit> = {}) => call(`/v1/daily/${n}/result`, { ...post(body), ...init });
const stats = (n: number | string, init: CallInit = {}) => call(`/v1/daily/${n}/stats`, init);
const clientId = () => crypto.randomUUID();

async function rowsFor(id: string) {
  const rows = await env.DB.prepare("SELECT n, picks, score FROM daily_results WHERE client_id = ? ORDER BY n").bind(id).all();
  return rows.results;
}

describe("puzzle numbers", () => {
  it("counts from the launch date the site serves", () => {
    expect(DAILY_LAUNCH_DATE).toBe(meta.launchDate);
    expect(utcPuzzleNumber(Date.parse("2026-10-01T00:00:00Z"), "2026-10-01")).toBe(1);
    expect(utcPuzzleNumber(Date.parse("2026-10-01T23:59:59Z"), "2026-10-01")).toBe(1);
    expect(utcPuzzleNumber(Date.parse("2026-10-12T00:00:01Z"), "2026-10-01")).toBe(12);
  });

  it("accepts today's UTC puzzle and one either side", () => {
    const now = Date.parse("2026-10-12T15:00:00Z");
    for (const n of [11, 12, 13]) expect(openPuzzle(String(n), now, "2026-10-01")).toBe(n);
    for (const n of ["10", "14", "0", "-1", "012", "1e1", "abc", "12.0", "1234567"]) {
      expect(() => openPuzzle(n, now, "2026-10-01")).toThrow();
    }
    expect(DAILY_WINDOW).toBe(1);
  });

  it("opens nothing before launch day", () => {
    const now = Date.parse("2026-09-29T12:00:00Z");
    expect(() => openPuzzle("1", now, "2026-10-01")).toThrow("puzzle_closed");
    expect(openPuzzle("1", Date.parse("2026-09-30T12:00:00Z"), "2026-10-01")).toBe(1);
  });
});

describe("POST /v1/daily/:n/result", () => {
  it("records a result and the stats count it", async () => {
    const n = today();
    const before = (await stats(n)).body;
    const id = clientId();
    const r = await result(n, { clientId: id, picks: [0, 1, 1], score: 2 });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(await rowsFor(id)).toEqual([{ n, picks: "011", score: 2 }]);

    const after = await stats(n);
    expect(after.status).toBe(200);
    expect(after.headers.get("cache-control")).toBe("no-store");
    expect(after.body.n).toBe(n);
    expect(after.body.players).toBe(before.players + 1);
    expect(after.body.picks).toEqual([
      [before.picks[0][0] + 1, before.picks[0][1]],
      [before.picks[1][0], before.picks[1][1] + 1],
      [before.picks[2][0], before.picks[2][1] + 1],
    ]);
    expect(after.body.scores).toEqual(before.scores.map((s: number, i: number) => s + (i === 2 ? 1 : 0)));
  });

  it("counts a browser once per puzzle, keeping its first result", async () => {
    const n = today();
    const id = clientId();
    expect((await result(n, { clientId: id, picks: [1, 1, 1], score: 3 })).status).toBe(200);
    const once = (await stats(n)).body;
    const again = await result(n, { clientId: id, picks: [0, 0, 0], score: 0 });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ ok: true });
    expect((await stats(n)).body).toEqual(once);
    expect(await rowsFor(id)).toEqual([{ n, picks: "111", score: 3 }]);

    // The same browser on the next puzzle is a new result.
    expect((await result(n + 1, { clientId: id, picks: [0, 0, 0], score: 1 })).status).toBe(200);
    expect((await rowsFor(id)).map((r) => r.n)).toEqual([n, n + 1]);
  });

  it("refuses puzzles outside today's UTC number +- 1, and malformed numbers", async () => {
    const n = today();
    for (const bad of [n - 2, n + 2, 0]) {
      const id = clientId();
      const r = await result(bad, { clientId: id, picks: [0, 0, 0], score: 0 });
      expect(r.status).toBe(404);
      expect(r.body.error).toBe(bad === 0 ? "not_found" : "puzzle_closed");
      expect(await rowsFor(id)).toEqual([]);
    }
    expect((await call("/v1/daily/abc/result", post({ clientId: clientId(), picks: [0, 0, 0], score: 0 }))).status).toBe(404);
    expect((await call("/v1/daily//result", post({}))).status).toBe(404);
  });

  it("validates the body", async () => {
    const n = today();
    const good = { clientId: clientId(), picks: [0, 1, 0], score: 1 };
    const bad: unknown[] = [
      null,
      [],
      "x",
      {},
      { ...good, clientId: undefined },
      { ...good, clientId: "not-a-uuid" },
      { ...good, clientId: good.clientId.toUpperCase() },
      { ...good, clientId: good.clientId + "0" },
      { ...good, clientId: 42 },
      { ...good, picks: [0, 1] },
      { ...good, picks: [0, 1, 0, 1] },
      { ...good, picks: [0, 2, 0] },
      { ...good, picks: [0, "1", 0] },
      { ...good, picks: [true, false, true] },
      { ...good, picks: "010" },
      { ...good, score: -1 },
      { ...good, score: 4 },
      { ...good, score: 1.5 },
      { ...good, score: "1" },
      { ...good, score: undefined },
    ];
    for (const body of bad) {
      const r = await result(n, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error).toBe("bad_request");
    }
    expect(await rowsFor(good.clientId)).toEqual([]);
    const notJson = await call(`/v1/daily/${n}/result`, { method: "POST", body: "{", headers: { "content-type": "application/json" } });
    expect(notJson.status).toBe(400);
    const tooBig = await result(n, { ...good, pad: "x".repeat(2000) });
    expect(tooBig.status).toBe(400);
    // Unknown fields are ignored.
    expect((await result(n, { ...good, extra: true })).status).toBe(200);
    expect(await rowsFor(good.clientId)).toEqual([{ n, picks: "010", score: 1 }]);
  });

  it("is rate-limited per network address", async () => {
    const n = today();
    const ip = freshIp();
    const max = LIMITS.dailyResultPerIp.max;
    for (let i = 0; i < max; i++) {
      expect((await result(n, { clientId: clientId(), picks: [0, 0, 1], score: 1 }, { ip })).status).toBe(200);
    }
    const id = clientId();
    const limited = await result(n, { clientId: id, picks: [0, 0, 1], score: 1 }, { ip });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe("rate_limited");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await rowsFor(id)).toEqual([]);
    // Another network is unaffected.
    expect((await result(n, { clientId: id, picks: [0, 0, 1], score: 1 })).status).toBe(200);
  });

  it("answers the site's origin, including the preflight", async () => {
    const n = today();
    const preflight = await call(`/v1/daily/${n}/result`, { method: "OPTIONS", headers: { origin: ORIGIN } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("content-type");
    const r = await call(`/v1/daily/${n}/result`, {
      ...post({ clientId: clientId(), picks: [1, 0, 0], score: 0 }),
      headers: { origin: ORIGIN },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const s = await stats(n, { headers: { origin: ORIGIN } });
    expect(s.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const other = await stats(n, { headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("GET /v1/daily/:n/stats", () => {
  it("answers zeros for a puzzle nobody has played, and nothing about any browser", async () => {
    const n = today() - 1;
    await env.DB.prepare("DELETE FROM daily_tallies WHERE n = ?").bind(n).run();
    const empty = await stats(n);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ n, players: 0, picks: [[0, 0], [0, 0], [0, 0]], scores: [0, 0, 0, 0] });

    const id = clientId();
    await result(n, { clientId: id, picks: [1, 0, 1], score: 3 });
    const one = await stats(n);
    expect(one.body).toEqual({ n, players: 1, picks: [[0, 1], [1, 0], [0, 1]], scores: [0, 0, 0, 1] });
    expect(one.text).not.toContain(id);
  });

  it("refuses puzzles that aren't open", async () => {
    const n = today();
    for (const bad of [n + 2, n - 2]) {
      const r = await stats(bad);
      expect(r.status).toBe(404);
      expect(r.body.error).toBe("puzzle_closed");
    }
    expect((await stats("x")).status).toBe(404);
    expect((await call(`/v1/daily/${n}/stats`, { method: "POST" })).status).toBe(404);
    expect((await call(`/v1/daily/${n}/result`)).status).toBe(404);
  });

  it("reads one stored row, however many have played", async () => {
    const n = today();
    for (let i = 0; i < 5; i++) await result(n, { clientId: clientId(), picks: [0, 1, 0], score: i % 4 });
    const read = await measure((metered) => stats(n, { env: metered }));
    expect(read.d1Queries).toBe(1);
    expect(read.rowsRead).toBe(1);
    expect(read.kvReads + read.kvWrites).toBe(0);
    const write = await measure((metered) => result(n, { clientId: clientId(), picks: [0, 1, 0], score: 1 }, { env: metered }));
    expect(write.d1Queries).toBe(1);
    // The result row, its index entry, and the tally the trigger updates.
    expect(write.rowsWritten).toBeLessThanOrEqual(4);
    expect(write.kvReads).toBe(1);
    expect(write.kvWrites).toBe(1);
  });

  it("is edge-cached when DAILY_STATS_CACHE_SECONDS is set", async () => {
    const n = today() + 1;
    const cached = { ...env, DAILY_STATS_CACHE_SECONDS: "60" };
    const first = await stats(n, { env: cached });
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("public, max-age=60");
    await result(n, { clientId: clientId(), picks: [1, 1, 1], score: 2 });
    const second = await stats(n, { env: cached });
    expect(second.body).toEqual(first.body);
    // Uncached, the new result shows at once.
    expect((await stats(n)).body.players).toBe(first.body.players + 1);
  });
});
