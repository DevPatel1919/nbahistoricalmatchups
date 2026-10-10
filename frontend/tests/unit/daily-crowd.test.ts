import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyStore, parseStore, recordDay, serializeStore } from "../../src/daily/stats";
import {
  crowdPercent,
  crowdPerfectLine,
  crowdPickLine,
  crowdPlayers,
  newClientId,
  parseCrowdStats,
  withClientId,
} from "../../src/lib/dailyCrowd";

// F12 Session 4: Daily Three crowd stats in the browser. The browser id, the
// checks on a stats answer (anything odd hides the crowd lines), the lines
// themselves, and the two API calls.

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("the browser id", () => {
  it("is a random v4 UUID, with or without crypto.randomUUID", () => {
    expect(newClientId()).toMatch(UUID_V4);
    expect(newClientId()).not.toBe(newClientId());
    const noRandomUUID = { getRandomValues: crypto.getRandomValues.bind(crypto) };
    for (let i = 0; i < 50; i++) expect(newClientId(noRandomUUID)).toMatch(UUID_V4);
    const zeros = { getRandomValues: ((a: Uint8Array) => a) as Crypto["getRandomValues"] };
    expect(newClientId(zeros)).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("is made once and kept in ct:daily:v1", () => {
    let made = 0;
    const make = () => `id-${++made}`;
    const first = withClientId(emptyStore(), make);
    expect(first.clientId).toBe("id-1");
    const again = withClientId(recordDay(first, 3, [0, 1, 0], [0, 0, 0]), make);
    expect(again.clientId).toBe("id-1");
    expect(made).toBe(1);
    expect(parseStore(serializeStore(again)).clientId).toBe("id-1");
  });
});

describe("a stats answer", () => {
  const good = { n: 7, players: 10, picks: [[6, 4], [0, 10], [5, 5]], scores: [1, 2, 3, 4] };

  it("is accepted when it adds up", () => {
    expect(parseCrowdStats(good, 7)).toEqual(good);
  });

  it("is refused when it is for another puzzle, empty, or doesn't add up", () => {
    const bad: unknown[] = [
      null,
      "x",
      [],
      { ...good, n: 8 },
      { ...good, n: "7" },
      { ...good, players: 0, picks: [[0, 0], [0, 0], [0, 0]], scores: [0, 0, 0, 0] },
      { ...good, players: -1 },
      { ...good, players: 10.5 },
      { ...good, picks: [[6, 4], [0, 10]] },
      { ...good, picks: [[6, 4], [0, 10], [5, 4]] },
      { ...good, picks: [[6, 4], [0, 10], [5, "5"]] },
      { ...good, picks: [[6, 4], [0, 10], [5, 5, 0]] },
      { ...good, scores: [1, 2, 3] },
      { ...good, scores: [1, 2, 3, 5] },
      { ...good, scores: [1, 2, 3, -4] },
      { ...good, scores: undefined },
    ];
    for (const value of bad) expect(parseCrowdStats(value, 7), JSON.stringify(value)).toBeNull();
  });
});

describe("crowd lines", () => {
  const names: [string, string] = ["1995–96 Bulls", "2016–17 Warriors"];

  it("name the side most players picked", () => {
    expect(crowdPickLine([62, 38], 100, names)).toBe("62% picked the 1995–96 Bulls.");
    expect(crowdPickLine([1, 2], 3, names)).toBe("67% picked the 2016–17 Warriors.");
    expect(crowdPickLine([0, 1], 1, names)).toBe("100% picked the 2016–17 Warriors.");
    expect(crowdPickLine([5, 5], 10, names)).toBe("The crowd split evenly between the 1995–96 Bulls and the 2016–17 Warriors.");
  });

  it("give the share that went 3/3, and the player count", () => {
    expect(crowdPerfectLine({ players: 100, scores: [10, 20, 29, 41] })).toBe("41% went 3/3.");
    expect(crowdPerfectLine({ players: 3, scores: [1, 2, 0, 0] })).toBe("0% went 3/3.");
    expect(crowdPercent(1, 3)).toBe("33%");
    expect(crowdPlayers(1)).toBe("1 player");
    expect(crowdPlayers(1234)).toBe("1,234 players");
  });

  it("never carry a decimal or the model's numbers", () => {
    for (const [a, b] of [[1, 2], [2, 7], [333, 667]] as [number, number][]) {
      expect(crowdPickLine([a, b], a + b, names)).not.toMatch(/\d\.\d/);
    }
  });
});

describe("the crowd calls", () => {
  type Call = { url: string; method: string; body: unknown; keepalive: boolean | undefined };
  let calls: Call[];

  beforeEach(() => {
    vi.resetModules();
    calls = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function mockFetch(status: number, body: unknown) {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null, keepalive: init.keepalive });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    });
  }

  it("post the day once at lock-in, with no token, and read the stats", async () => {
    vi.stubEnv("VITE_DUEL_API", "https://api.test/");
    const api = await import("../../src/lib/duelApi");
    mockFetch(200, { ok: true });
    const clientId = "0b6e6e8a-1c1e-4b7e-9d43-3f2a7c1d9e10";
    await api.postDailyResult(12, { clientId, picks: [0, 1, 1], score: 2 });
    mockFetch(200, { n: 12, players: 1, picks: [[1, 0], [0, 1], [0, 1]], scores: [0, 0, 1, 0] });
    expect((await api.fetchDailyStats(12)).players).toBe(1);
    expect(calls).toEqual([
      { url: "https://api.test/v1/daily/12/result", method: "POST", body: { clientId, picks: [0, 1, 1], score: 2 }, keepalive: true },
      { url: "https://api.test/v1/daily/12/stats", method: "GET", body: null, keepalive: undefined },
    ]);
  });

  it("fail without a network call when the API is not configured", async () => {
    vi.stubEnv("VITE_DUEL_API", "");
    const api = await import("../../src/lib/duelApi");
    mockFetch(200, {});
    await expect(api.fetchDailyStats(12)).rejects.toMatchObject({ code: "not_configured" });
    await expect(api.postDailyResult(12, { clientId: "x", picks: [0, 0, 0], score: 0 })).rejects.toMatchObject({ code: "not_configured" });
    expect(calls).toEqual([]);
  });

  it("reject on errors and an unreachable API", async () => {
    vi.stubEnv("VITE_DUEL_API", "https://api.test");
    const api = await import("../../src/lib/duelApi");
    mockFetch(404, { error: "puzzle_closed", message: "x" });
    await expect(api.fetchDailyStats(99)).rejects.toMatchObject({ code: "puzzle_closed", status: 404 });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(api.postDailyResult(12, { clientId: "x", picks: [0, 0, 0], score: 0 })).rejects.toMatchObject({ code: "network" });
  });
});
