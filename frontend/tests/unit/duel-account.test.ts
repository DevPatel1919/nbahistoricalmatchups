import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// F09 Session 5: the client's account handling. An account is optional, so a
// lapsed session must fall back to guest play rather than block it.

type Call = { url: string; method: string; auth: string | null; body: unknown };

function mockApi(respond: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call = { url, method: init.method ?? "GET", auth: headers.authorization ?? null, body: init.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    const { status, body } = respond(call);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return calls;
}

async function load() {
  const api = await import("../../src/lib/duelApi");
  const storage = await import("../../src/lib/duelStorage");
  return { api, storage };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_DUEL_API", "https://api.test/");
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("duel account client", () => {
  it("plays as the account while signed in", async () => {
    const { api, storage } = await load();
    storage.writeSessionToken("s_live");
    const calls = mockApi(() => ({ status: 201, body: { duelId: "d1" } }));
    await api.startSet("bot", { kind: "random" });
    expect(calls.map((c) => [c.url, c.auth])).toEqual([["https://api.test/v1/sets", "Bearer s_live"]]);
  });

  it("drops a rejected session and carries on as a guest", async () => {
    const { api, storage } = await load();
    storage.writeSessionToken("s_old");
    const calls = mockApi((c) => {
      if (c.auth === "Bearer s_old") return { status: 401, body: { error: "unauthorized", message: "" } };
      if (c.url.endsWith("/v1/guests")) return { status: 201, body: { guestToken: "g.tok" } };
      return { status: 201, body: { duelId: "d2" } };
    });
    const set = await api.startSet("solo", { kind: "random" });
    expect(set.duelId).toBe("d2");
    expect(storage.readSessionToken()).toBeNull();
    expect(storage.readGuestToken()).toBe("g.tok");
    expect(calls.map((c) => [c.url.replace("https://api.test", ""), c.auth])).toEqual([
      ["/v1/sets", "Bearer s_old"],
      ["/v1/guests", null],
      ["/v1/sets", "Bearer g.tok"],
    ]);
  });

  it("redeems a link with this browser's guest token, then retires the guest", async () => {
    const { api, storage } = await load();
    storage.writeGuestToken("g.mine");
    const account = { displayName: null, createdAt: 1, completedDuels: 3, nextRenameAt: null, ranked: { eligible: false, minCompletedDuels: 10, needsDisplayName: true } };
    const calls = mockApi(() => ({ status: 200, body: { sessionToken: "s_new", account } }));
    expect(await api.redeemSignInLink("ml_x")).toEqual(account);
    expect(calls[0].body).toEqual({ token: "ml_x", guestToken: "g.mine" });
    expect(calls[0].auth).toBeNull();
    expect(storage.readSessionToken()).toBe("s_new");
    expect(storage.readGuestToken()).toBeNull();
    expect(api.isSignedIn()).toBe(true);
  });

  it("keeps the guest when a link fails", async () => {
    const { api, storage } = await load();
    storage.writeGuestToken("g.mine");
    mockApi(() => ({ status: 400, body: { error: "link_invalid", message: "" } }));
    await expect(api.redeemSignInLink("ml_used")).rejects.toMatchObject({ code: "link_invalid" });
    expect(storage.readGuestToken()).toBe("g.mine");
    expect(storage.readSessionToken()).toBeNull();
  });

  it("reads a lapsed session as signed out, and signs out locally even offline", async () => {
    const { api, storage } = await load();
    expect(await api.fetchAccount()).toBeNull();
    storage.writeSessionToken("s_gone");
    mockApi(() => ({ status: 401, body: { error: "unauthorized", message: "" } }));
    expect(await api.fetchAccount()).toBeNull();
    expect(storage.readSessionToken()).toBeNull();

    storage.writeSessionToken("s_live");
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    await api.signOut();
    expect(storage.readSessionToken()).toBeNull();
  });

  it("describes every account error in plain language", async () => {
    const { api } = await load();
    const generic = api.describeDuelError(new api.DuelApiError("something_new", 400));
    for (const code of ["invalid_email", "human_check_failed", "link_invalid", "auth_unavailable", "name_invalid", "name_not_allowed", "name_taken", "rename_too_soon"]) {
      const text = api.describeDuelError(new api.DuelApiError(code, 400));
      expect(text, code).not.toBe(generic);
      expect(text).not.toMatch(/_/);
    }
  });
});
