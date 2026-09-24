// F09 Session 5 acceptance: accounts. Creation is Turnstile-gated and rate
// limited, magic links are single-use and short-lived (a D1 constraint), names
// pass moderation, a guest upgrade keeps its history, and nothing ranks early.

import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { RANKED_MIN_COMPLETED_DUELS, canonicalEmail } from "../src/accounts";
import type { Env } from "../src/env";
import { handle } from "../src/index";
import { checkDisplayName, foldName } from "../src/names";
import { DummyTokenCheck, MemoryMailer, TURNSTILE_DUMMY_TOKEN, servicesFor, testDoublesEnabled } from "../src/services";

const APP = "http://localhost:4317";
let mailer: MemoryMailer;
beforeEach(() => {
  mailer = new MemoryMailer();
});

let counter = 0;
const unique = () => ++counter + "-" + Math.random().toString(36).slice(2, 8);
const freshIp = () => "192.0.2." + (counter % 250) + "-" + unique();
const freshEmail = () => "player." + unique() + "@example.com";

type CallInit = RequestInit & { ip?: string; env?: Env };

async function call(path: string, init: CallInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", init.ip ?? freshIp());
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const request = new Request("https://duel.test" + path, { ...init, headers });
  const response = await handle(request, init.env ?? env, { mailer, humanCheck: new DummyTokenCheck() });
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, body: text ? JSON.parse(text) : null };
}

const auth = (token: string) => ({ authorization: "Bearer " + token });
const post = (body: unknown, extra: CallInit = {}): CallInit => ({ method: "POST", body: JSON.stringify(body), ...extra });

async function requestLink(email: string, ip = freshIp(), turnstileToken = TURNSTILE_DUMMY_TOKEN) {
  return call("/v1/auth/magic-link", post({ email, turnstileToken }, { ip }));
}

function lastLinkToken(to: string): string {
  const message = [...mailer.sent].reverse().find((m) => m.to === to);
  expect(message, "a link was mailed to " + to).toBeTruthy();
  const match = /#token=(ml_[A-Za-z0-9_-]+)/.exec(message!.text);
  expect(match).toBeTruthy();
  return match![1];
}

async function signIn(email = freshEmail(), guestToken?: string) {
  expect((await requestLink(email)).status).toBe(202);
  const r = await call("/v1/auth/verify", post({ token: lastLinkToken(email), guestToken }));
  expect(r.status).toBe(200);
  return r.body as { sessionToken: string; account: { completedDuels: number; displayName: string | null; ranked: { eligible: boolean } } };
}

async function newGuest(): Promise<string> {
  const r = await call("/v1/guests", { method: "POST" });
  expect(r.status).toBe(201);
  return r.body.guestToken;
}

/** Plays and submits one solo set as whoever holds `token`. */
async function playSet(token: string): Promise<string> {
  const set = await call("/v1/sets", post({ mode: "solo", draw: { kind: "random" } }, { headers: auth(token) }));
  expect(set.status).toBe(201);
  const picks = set.body.puzzles.map((p: { puzzleId: string }) => ({ puzzleId: p.puzzleId, side: "home", confidence: "lean" }));
  const r = await call(
    "/v1/duels/" + set.body.duelId + "/submission",
    post({ setToken: set.body.setToken, picks }, { headers: { ...auth(token), "idempotency-key": unique() } }),
  );
  expect(r.status).toBe(200);
  return set.body.duelId;
}

async function setName(session: string, displayName: string) {
  return call("/v1/account/display-name", post({ displayName }, { headers: auth(session) }));
}

describe("requesting a magic link", () => {
  it("is Turnstile-gated and mails a single link to the app origin", async () => {
    const email = freshEmail();
    for (const bad of ["", "wrong-token", undefined]) {
      const r = await call("/v1/auth/magic-link", post({ email, turnstileToken: bad }));
      expect(r.status).toBe(403);
      expect(r.body.error).toBe("human_check_failed");
    }
    expect(mailer.sent).toHaveLength(0);

    const r = await requestLink(email);
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ ok: true });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe(email);
    // The token rides in the fragment, never the query string.
    expect(mailer.sent[0].text).toMatch(new RegExp("^" + APP + "/account/verify#token=ml_[A-Za-z0-9_-]{43}$", "m"));
    expect(mailer.sent[0].text).toContain("expires in 15 minutes");
  });

  it("rejects malformed addresses before doing anything else", async () => {
    for (const email of ["", "no-at-sign", "a@b", "two@@example.com", "x".repeat(65) + "@example.com", 42, null]) {
      const r = await call("/v1/auth/magic-link", post({ email, turnstileToken: TURNSTILE_DUMMY_TOKEN }));
      expect(r.status, String(email)).toBe(400);
      expect(r.body.error).toBe("invalid_email");
    }
    expect(mailer.sent).toHaveLength(0);
  });

  it("answers identically for new and existing accounts", async () => {
    const existing = freshEmail();
    await signIn(existing);
    const a = await requestLink(existing);
    const b = await requestLink(freshEmail());
    expect([a.status, a.text]).toEqual([b.status, b.text]);
  });

  it("stores no email address, only hashes", async () => {
    const email = freshEmail();
    await requestLink(email);
    const linkToken = lastLinkToken(email);
    const { sessionToken } = (await call("/v1/auth/verify", post({ token: linkToken }))).body;
    const tables = ["accounts", "magic_links", "magic_link_redemptions", "sessions"];
    for (const table of tables) {
      const rows = await env.DB.prepare("SELECT * FROM " + table).all();
      const dump = JSON.stringify(rows.results);
      expect(dump, table).not.toContain("@");
      expect(dump, table).not.toContain(email.split("@")[0]);
      expect(dump, table).not.toContain(linkToken.slice(3));
      expect(dump, table).not.toContain(sessionToken.slice(2));
    }
    const keys = await env.RATE_LIMITS.list();
    for (const k of keys.keys) expect(k.name).not.toContain(email.split("@")[0]);
  });

  it("rate-limits per IP and per address with 429 and Retry-After", async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) expect((await requestLink(freshEmail(), ip)).status).toBe(202);
    const perIp = await requestLink(freshEmail(), ip);
    expect(perIp.status).toBe(429);
    expect(Number(perIp.headers.get("retry-after"))).toBeGreaterThan(0);

    // Aliases of one inbox share a limit: +tags and Gmail dots are folded.
    const n = String(counter);
    const variants = [`Ann.Lee${n}+a@gmail.com`, `annlee${n}+b@gmail.com`, `ANN.LEE${n}@googlemail.com`, `a.n.n.l.e.e${n}+c@gmail.com`];
    const results = [];
    for (const v of variants) results.push((await requestLink(v)).status);
    expect(results).toEqual([202, 202, 202, 429]);
  });

  it("fails closed with a fixed 503 when email or Turnstile is unavailable", async () => {
    mailer.failNext = true;
    const r = await requestLink(freshEmail());
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("auth_unavailable");

    // The production wiring with no secrets configured.
    const request = new Request("https://duel.test/v1/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": freshIp() },
      body: JSON.stringify({ email: freshEmail(), turnstileToken: TURNSTILE_DUMMY_TOKEN }),
    });
    const response = await handle(request, env, servicesFor(env));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "auth_unavailable" });

    // A link must never point outside the allowed origins.
    const offsite = { ...env, APP_ORIGIN: "https://evil.example" };
    expect((await call("/v1/auth/magic-link", post({ email: freshEmail(), turnstileToken: TURNSTILE_DUMMY_TOKEN }, { env: offsite }))).status).toBe(503);
  });
});

describe("canonical email", () => {
  it("folds case, +tags, and Gmail dots, and nothing else", () => {
    expect(canonicalEmail("Ann.Lee+duel@GMail.com")).toBe("annlee@gmail.com");
    expect(canonicalEmail("ann.lee@googlemail.com")).toBe("annlee@gmail.com");
    expect(canonicalEmail("Ann.Lee+x@example.com")).toBe("ann.lee@example.com");
  });
});

describe("redeeming a magic link", () => {
  it("creates the account once and opens a working session", async () => {
    const email = freshEmail();
    const first = await signIn(email);
    expect(first.sessionToken).toMatch(/^s_/);
    expect(first.account).toMatchObject({ displayName: null, completedDuels: 0, ranked: { eligible: false } });
    const me = await call("/v1/account", { headers: auth(first.sessionToken) });
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.body)).not.toContain("@");

    // Signing in again with an alias of the same inbox reaches the same account.
    const again = await signIn(email.toUpperCase().replace("@", "+again@"));
    await setName(first.sessionToken, "Same Inbox " + (counter % 1000));
    const view = await call("/v1/account", { headers: auth(again.sessionToken) });
    expect(view.body.displayName).toMatch(/^Same Inbox/);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts WHERE display_name = ?").bind(view.body.displayName).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("is single-use", async () => {
    const email = freshEmail();
    await requestLink(email);
    const token = lastLinkToken(email);
    expect((await call("/v1/auth/verify", post({ token }))).status).toBe(200);
    const reuse = await call("/v1/auth/verify", post({ token }));
    expect(reuse.status).toBe(400);
    expect(reuse.body.error).toBe("link_invalid");
  });

  it("lets exactly one of many concurrent redemptions through", async () => {
    const email = freshEmail();
    await requestLink(email);
    const token = lastLinkToken(email);
    const results = await Promise.all(Array.from({ length: 6 }, () => call("/v1/auth/verify", post({ token }))));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400, 400, 400, 400]);
    const sessions = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM sessions s JOIN accounts a ON a.id = s.account_id JOIN magic_links l ON l.email_hash = a.email_hash WHERE l.token_hash IN (SELECT token_hash FROM magic_link_redemptions)",
    ).first<{ n: number }>();
    expect(sessions?.n).toBeGreaterThan(0);
  });

  it("the database itself rejects a second redemption", async () => {
    const email = freshEmail();
    await requestLink(email);
    await call("/v1/auth/verify", post({ token: lastLinkToken(email) }));
    const row = await env.DB.prepare("SELECT token_hash FROM magic_link_redemptions LIMIT 1").first<{ token_hash: string }>();
    await expect(
      env.DB.prepare("INSERT INTO magic_link_redemptions (token_hash, redeemed_at) VALUES (?, ?)").bind(row!.token_hash, Date.now()).run(),
    ).rejects.toThrow(/UNIQUE|PRIMARY/);
  });

  it("expires after 15 minutes", async () => {
    const email = freshEmail();
    await requestLink(email);
    const token = lastLinkToken(email);
    const now = Date.now();
    const row = await env.DB.prepare("SELECT expires_at, created_at FROM magic_links ORDER BY created_at DESC LIMIT 1").first<{ expires_at: number; created_at: number }>();
    expect(row!.expires_at - row!.created_at).toBe(15 * 60 * 1000);
    await env.DB.prepare("UPDATE magic_links SET expires_at = ? WHERE created_at = ?").bind(now - 1, row!.created_at).run();
    const r = await call("/v1/auth/verify", post({ token }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("link_invalid");
  });

  it("rejects malformed and unknown tokens with the same answer", async () => {
    const shapes = ["", "ml_short", "ml_" + "A".repeat(43), "s_" + "A".repeat(43), 7, null];
    for (const token of shapes) {
      const r = await call("/v1/auth/verify", post({ token }));
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("link_invalid");
    }
  });

  it("rate-limits new accounts per IP", async () => {
    const ip = freshIp();
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const email = freshEmail();
      await requestLink(email);
      statuses.push((await call("/v1/auth/verify", post({ token: lastLinkToken(email) }, { ip }))).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});

describe("sessions", () => {
  it("signs out, rejects forged and expired sessions", async () => {
    const { sessionToken } = await signIn();
    expect((await call("/v1/account", { headers: auth(sessionToken) })).status).toBe(200);
    expect((await call("/v1/account", { headers: auth("s_" + "A".repeat(43)) })).status).toBe(401);
    expect((await call("/v1/account", {})).status).toBe(401);

    expect((await call("/v1/auth/sign-out", { method: "POST", headers: auth(sessionToken) })).status).toBe(200);
    expect((await call("/v1/account", { headers: auth(sessionToken) })).status).toBe(401);
    expect((await call("/v1/sets", post({ mode: "solo", draw: { kind: "random" } }, { headers: auth(sessionToken) }))).status).toBe(401);

    const other = await signIn();
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE revoked_at IS NULL").bind(Date.now() - 1).run();
    expect((await call("/v1/account", { headers: auth(other.sessionToken) })).status).toBe(401);
  });

  it("a guest token is not an account", async () => {
    const guest = await newGuest();
    expect((await call("/v1/account", { headers: auth(guest) })).status).toBe(401);
  });

  it("an account plays unranked sets under its own participant key", async () => {
    const { sessionToken } = await signIn();
    const duelId = await playSet(sessionToken);
    const row = await env.DB.prepare("SELECT issued_to FROM duels WHERE id = ?").bind(duelId).first<{ issued_to: string }>();
    expect(row?.issued_to).toMatch(/^a:a_/);
    expect((await call("/v1/account", { headers: auth(sessionToken) })).body.completedDuels).toBe(1);
  });
});

describe("guest upgrade", () => {
  it("keeps unranked history by re-keying g: rows to a: in one batch", async () => {
    const guest = await newGuest();
    const duels = [await playSet(guest), await playSet(guest)];
    const guestId = JSON.parse(atob(guest.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))).sub as string;

    const { sessionToken, account } = await signIn(freshEmail(), guest);
    expect(account.completedDuels).toBe(2);

    for (const table of [["duels", "issued_to"], ["submissions", "participant"], ["scored_picks", "participant"]]) {
      const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table[0]} WHERE ${table[1]} = ?`).bind("g:" + guestId).first<{ n: number }>();
      expect(left?.n, table[0]).toBe(0);
    }
    // The revealed results now belong to the account, and reload for it.
    for (const id of duels) {
      const r = await call("/v1/duels/" + id, { headers: auth(sessionToken) });
      expect(r.status).toBe(200);
      expect(r.body.state).toBe("revealed");
    }
    // The merged guest identity is retired.
    expect((await call("/v1/sets", post({ mode: "solo", draw: { kind: "random" } }, { headers: auth(guest) }))).status).toBe(401);
    // Presenting it again merges nothing and does not block sign-in.
    const second = await signIn(freshEmail(), guest);
    expect(second.account.completedDuels).toBe(0);
  });

  it("an invalid guest token never blocks sign-in", async () => {
    const r = await signIn(freshEmail(), "not-a-token");
    expect(r.account.completedDuels).toBe(0);
  });
});

describe("display names", () => {
  it("accepts ordinary names and tidies spacing", () => {
    for (const name of ["Ann Lee", "hoops_fan-98", "D.J. Hoops", "José Calderón", "Trae3"]) {
      expect(checkDisplayName(name).ok, name).toBe(true);
    }
    expect(checkDisplayName("  Big   Shot  ")).toMatchObject({ ok: true, name: "Big Shot" });
  });

  it("rejects bad shapes, reserved names, look-alikes, and blocked words", () => {
    const cases: [unknown, string][] = [
      ["ab", "length"],
      ["x".repeat(21), "length"],
      [42, "characters"],
      ["-lead", "characters"],
      ["two__marks", "characters"],
      ["<script>", "characters"],
      ["аdmin", "characters"], // Cyrillic "а"
      ["Admin", "reserved"],
      ["Sparring Partner", "reserved"],
      ["sparring.partner2", "reserved"],
      ["Pre-game Model", "reserved"],
      ["N B A fan", "reserved"],
      ["N8A", "reserved"],
      ["b0t", "reserved"],
      ["Official Scores", "reserved"],
      ["ａｄｍｉｎ", "reserved"], // full-width "admin"
      ["Court Of All Time", "reserved"],
      ["sh1thead", "blocked"],
      ["rape", "blocked"],
    ];
    for (const [raw, reason] of cases) expect(checkDisplayName(raw), String(raw)).toEqual({ ok: false, reason });
    // Innocent names containing short blocked words as fragments pass.
    for (const name of ["Grapefruit", "Botswana", "Modesto"]) expect(checkDisplayName(name).ok, name).toBe(true);
    expect(foldName("Guard_D0g")).toBe(foldName("guard dog"));
  });

  it("maps moderation outcomes to fixed errors", async () => {
    const { sessionToken } = await signIn();
    expect((await setName(sessionToken, "a")).body.error).toBe("name_invalid");
    expect((await setName(sessionToken, "Moderator")).body.error).toBe("name_not_allowed");
    expect((await setName(sessionToken, "fuckface")).body.error).toBe("name_not_allowed");
  });

  it("keeps names unique by folded form, enforced by D1", async () => {
    const a = await signIn();
    const b = await signIn();
    const base = "Guard Dog " + (counter % 1000);
    expect((await setName(a.sessionToken, base)).status).toBe(200);
    for (const lookalike of [base.toUpperCase(), base.replace(/ /g, "_"), base.replace("o", "0")]) {
      const r = await setName(b.sessionToken, lookalike);
      expect(r.status, lookalike).toBe(409);
      expect(r.body.error).toBe("name_taken");
    }
    const key = await env.DB.prepare("SELECT display_name_key FROM accounts WHERE display_name = ?").bind(base).first<{ display_name_key: string }>();
    await expect(
      env.DB.prepare("UPDATE accounts SET display_name_key = ? WHERE display_name IS NULL").bind(key!.display_name_key).run(),
    ).rejects.toThrow(/UNIQUE/);
  });

  it("allows the first name and one free rename, then one rename per 30 days", async () => {
    const { sessionToken } = await signIn();
    const n = counter % 1000;
    expect((await setName(sessionToken, "First " + n)).body.nextRenameAt).toBeNull();
    const renamed = await setName(sessionToken, "Second " + n);
    expect(renamed.status).toBe(200);
    expect(renamed.body.nextRenameAt).toBeGreaterThan(Date.now() + 29 * 86400_000);
    const tooSoon = await setName(sessionToken, "Third " + n);
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error).toBe("rename_too_soon");
    expect(Number(tooSoon.headers.get("retry-after"))).toBeGreaterThan(29 * 86400);
    // Resubmitting the current name is not a rename.
    expect((await setName(sessionToken, "Second " + n)).status).toBe(200);

    await env.DB.prepare("UPDATE accounts SET name_changed_at = ? WHERE display_name = ?").bind(Date.now() - 31 * 86400_000, "Second " + n).run();
    expect((await setName(sessionToken, "Third " + n)).status).toBe(200);
    // The freed name is available to others.
    const other = await signIn();
    expect((await setName(other.sessionToken, "First " + n)).status).toBe(200);
  });

  it("rate-limits rename attempts per account", async () => {
    const { sessionToken } = await signIn();
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await setName(sessionToken, "x")).status);
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("ranked eligibility", () => {
  const ranked = (token: string) => call("/v1/sets", post({ mode: "ranked" }, { headers: auth(token) }));

  it("guests never reach ranked", async () => {
    const r = await ranked(await newGuest());
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("account_required");
  });

  it(`accounts unlock only after ${RANKED_MIN_COMPLETED_DUELS} completed sets and a display name`, async () => {
    const { sessionToken } = await signIn();
    for (let i = 0; i < RANKED_MIN_COMPLETED_DUELS - 1; i++) await playSet(sessionToken);
    expect((await ranked(sessionToken)).body.error).toBe("ranked_locked");
    await playSet(sessionToken);
    let me = await call("/v1/account", { headers: auth(sessionToken) });
    expect(me.body).toMatchObject({ completedDuels: RANKED_MIN_COMPLETED_DUELS, ranked: { eligible: false, needsDisplayName: true } });
    expect((await ranked(sessionToken)).body.error).toBe("ranked_locked");

    await setName(sessionToken, "Ready " + (counter % 1000));
    me = await call("/v1/account", { headers: auth(sessionToken) });
    expect(me.body.ranked).toEqual({ eligible: true, minCompletedDuels: RANKED_MIN_COMPLETED_DUELS, needsDisplayName: false });
    // The gate passes; ranked duels themselves are Session 6.
    const r = await ranked(sessionToken);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("ranked_unavailable");
  });

  it("an issued set is never needed to probe eligibility", async () => {
    const { sessionToken } = await signIn();
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM duels").first<{ n: number }>();
    await ranked(sessionToken);
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM duels").first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });
});

describe("test doubles", () => {
  it("are only ever enabled for localhost-only deployments", () => {
    const local = { ...env, AUTH_TEST_DOUBLES: "1", ALLOWED_ORIGINS: "http://localhost:4317,http://127.0.0.1:5173" };
    expect(testDoublesEnabled(local)).toBe(true);
    expect(testDoublesEnabled({ ...local, ALLOWED_ORIGINS: "http://localhost:4317,https://courtofalltime.com" })).toBe(false);
    expect(testDoublesEnabled({ ...local, ALLOWED_ORIGINS: "" })).toBe(false);
    expect(testDoublesEnabled({ ...local, AUTH_TEST_DOUBLES: "true" })).toBe(false);
    expect(servicesFor({ ...local, ALLOWED_ORIGINS: "https://courtofalltime.com" }).mailer.constructor.name).not.toBe("KvOutboxMailer");
  });

  it("the dev outbox does not exist without them", async () => {
    const worker = (exports as unknown as { default: Fetcher }).default;
    const r = await worker.fetch(new Request("https://duel.test/v1/dev/outbox?to=a@example.com"));
    expect(r.status).toBe(404);
  });
});

describe("configuration", () => {
  it("ships wrangler.jsonc without test doubles and with the app origin allowed", () => {
    expect(env.AUTH_TEST_DOUBLES).toBeUndefined();
    expect(env.ALLOWED_ORIGINS.split(",")).toContain(env.APP_ORIGIN);
  });
});
