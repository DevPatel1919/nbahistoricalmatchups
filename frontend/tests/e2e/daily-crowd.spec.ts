import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";
import { DUEL_API_PORT } from "../../playwright.config";
import {
  STORAGE_KEY,
  addCalendarDays,
  dayScore,
  puzzleNumber,
  simulateGame,
  type DailyCrowdStats,
  type DailyDay,
  type DailyMeta,
  type DailyPool,
  type Side,
} from "../../src/daily";
import { crowdPlayers } from "../../src/lib/dailyCrowd";
import { seasonTeamName } from "../../src/lib/dailyFormat";
import type { IndexData } from "../../src/types";

// Daily Three crowd stats (F12 Session 4). Crowd lines appear only after
// lock-in, and the game must work fully with the API failing or blocked.
//
// Most tests answer the API themselves, for a pinned puzzle and exact text.
// The last plays today's real puzzle against the local Worker, because the
// Worker only accepts puzzles within a day of today's UTC date.

const API = `http://localhost:${DUEL_API_PORT}`;
const readJson = <T>(path: string): T => JSON.parse(readFileSync(`public/data/${path}`, "utf8")) as T;
const META = readJson<DailyMeta>("daily/meta.json");
const POOL = readJson<DailyPool>("daily/teams.json");
const INDEX = readJson<IndexData>("index.json");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A puzzle well inside the schedule, for the tests that answer the API themselves. */
const N = 12;
const ZONE = "America/New_York";

// Only the last test reaches the Worker; daily.spec.ts blocks it, so its counts are this test's own.
test.use({ timezoneId: ZONE });

function winners(n: number): Side[] {
  const day = readJson<DailyDay>(`daily/days/${n}.json`);
  return day.games.map(
    (game, gameIndex) =>
      simulateGame({ engine: day.engine, n, gameIndex, game, teamA: POOL.teams[game.a], teamB: POOL.teams[game.b] }).winner,
  );
}

function teamNames(n: number): [string, string][] {
  const byKey = new Map(INDEX.teams.map((t) => [t.key, t]));
  const day = readJson<DailyDay>(`daily/days/${n}.json`);
  return day.games.map((g) => [seasonTeamName(byKey.get(g.a)!), seasonTeamName(byKey.get(g.b)!)]);
}

/** Today's puzzle number in the test's time zone. */
function todayN(): number {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return puzzleNumber(META.launchDate, date);
}

async function pickAndLock(page: Page, picks: Side[]) {
  for (const [i, side] of picks.entries()) {
    await page.locator(".daily-game").nth(i).locator(".daily-team").nth(side).click();
  }
  await page.getByRole("button", { name: "Lock in picks" }).click();
}

async function skipToResults(page: Page) {
  await page.getByRole("button", { name: "Skip all" }).click();
  await expect(page.getByRole("heading", { name: /You went/ })).toBeVisible();
}

const CORS = { "access-control-allow-origin": "*", "content-type": "application/json" };

type Seen = { posts: unknown[]; statsCalls: number };

/** Answers the crowd API in the browser: records each result, and serves `stats` for every puzzle. */
async function fakeApi(page: Page, stats: (n: number) => { status: number; body: unknown }): Promise<Seen> {
  const seen: Seen = { posts: [], statsCalls: 0 };
  await page.route(`${API}/v1/daily/**`, async (route: Route) => {
    const request = route.request();
    const match = /\/v1\/daily\/(\d+)\/(result|stats)$/.exec(request.url());
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { ...CORS, "access-control-allow-headers": "content-type" } });
    if (match?.[2] === "result" && request.method() === "POST") {
      seen.posts.push({ n: Number(match[1]), ...request.postDataJSON() });
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ ok: true }) });
    }
    if (match?.[2] === "stats") {
      seen.statsCalls++;
      const { status, body } = stats(Number(match[1]));
      return route.fulfill({ status, headers: CORS, body: typeof body === "string" ? body : JSON.stringify(body) });
    }
    return route.abort();
  });
  return seen;
}

async function openPinned(page: Page, n = N) {
  await page.clock.install({ time: new Date(`${addCalendarDays(META.launchDate, n - 1)}T12:00:00-04:00`) });
  await page.goto("/daily");
  await expect(page.getByRole("heading", { level: 1, name: `Daily Three #${n}` })).toBeVisible();
}

const CROWD_WORDS = /crowd|picked the|went 3\/3|so far/i;

test("crowd lines show only after lock-in, and the day is sent once", async ({ page }) => {
  const crowd: DailyCrowdStats = { n: N, players: 100, picks: [[62, 38], [30, 70], [50, 50]], scores: [10, 20, 29, 41] };
  const seen = await fakeApi(page, (n) => ({ status: 200, body: { ...crowd, n } }));
  const picks: Side[] = [0, 1, 0];
  const score = picks.filter((p, i) => p === winners(N)[i]).length;
  await openPinned(page);

  // Before lock-in: no crowd line, and the stats were never asked for.
  await expect(page.locator(".daily-crowd")).toHaveCount(0);
  expect(await page.locator("main").innerText()).not.toMatch(CROWD_WORDS);
  expect(seen.statsCalls).toBe(0);
  expect(seen.posts).toEqual([]);

  await pickAndLock(page, picks);
  // Sent at lock-in, with a random browser id and nothing else.
  await expect.poll(() => seen.posts.length).toBe(1);
  const post = seen.posts[0] as { n: number; clientId: string; picks: Side[]; score: number };
  expect(Object.keys(post).sort()).toEqual(["clientId", "n", "picks", "score"]);
  expect(post).toMatchObject({ n: N, picks, score });
  expect(post.clientId).toMatch(UUID);
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), STORAGE_KEY);
  expect(stored.clientId).toBe(post.clientId);

  // During the reveal: still no crowd line.
  await expect(page.getByRole("heading", { name: /Game 1 of 3/ })).toBeVisible();
  expect(await page.locator("main").innerText()).not.toMatch(CROWD_WORDS);
  expect(seen.statsCalls).toBe(0);

  await skipToResults(page);
  const panel = page.locator(".daily-crowd");
  await expect(panel).toBeVisible();
  const names = teamNames(N);
  await expect(panel.getByRole("heading", { name: "Today's crowd" })).toBeVisible();
  await expect(panel).toContainText("100 players so far.");
  const lines = panel.locator("li");
  await expect(lines).toHaveText([
    `Game 1: 62% picked the ${names[0][0]}.`,
    `Game 2: 70% picked the ${names[1][1]}.`,
    `Game 3 ⭐: The crowd split evenly between the ${names[2][0]} and the ${names[2][1]}.`,
    "41% went 3/3.",
  ]);
  await expect(panel).toContainText("Scores are self-reported.");

  // Coming back the same day shows the crowd again, and sends nothing new.
  await page.reload();
  await expect(page.getByRole("heading", { name: /You went/ })).toBeVisible();
  await expect(page.locator(".daily-crowd")).toContainText("62% picked the");
  expect(seen.posts).toHaveLength(1);

  // Watch again hides the crowd until the results are back.
  await page.getByRole("button", { name: "Watch again" }).click();
  await expect(page.getByRole("heading", { name: /Game 1 of 3/ })).toBeVisible();
  await expect(page.locator(".daily-crowd")).toHaveCount(0);
  await skipToResults(page);
  await expect(page.locator(".daily-crowd")).toBeVisible();
  expect(seen.posts).toHaveLength(1);
});

test("the game works fully with the API blocked", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(`${API}/**`, (route) => route.abort());
  const picks = winners(N);
  await openPinned(page);
  await pickAndLock(page, picks);
  await skipToResults(page);
  await expect(page.getByRole("heading", { name: "You went 3/3" })).toBeVisible();
  await expect(page.locator(".daily-results__finals .daily-final")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "Your stats" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share" })).toBeVisible();
  await expect(page.locator(".daily-crowd")).toHaveCount(0);
  expect(await page.locator("main").innerText()).not.toMatch(/crowd|couldn't|error/i);

  // The day was saved even though nothing reached the server.
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), STORAGE_KEY);
  expect(dayScore(stored.days[String(N)])).toBe(3);
  await page.reload();
  await expect(page.getByRole("heading", { name: "You went 3/3" })).toBeVisible();
  await expect(page.locator(".daily-crowd")).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const [label, status, body] of [
  ["a server error", 500, { error: "internal", message: "Something went wrong." }],
  ["a closed puzzle", 404, { error: "puzzle_closed", message: "x" }],
  ["counts that don't add up", 200, { n: N, players: 3, picks: [[1, 1], [2, 1], [0, 3]], scores: [0, 1, 1, 1] }],
  ["another puzzle's stats", 200, { n: N + 1, players: 1, picks: [[1, 0], [1, 0], [1, 0]], scores: [0, 1, 0, 0] }],
  ["no players yet", 200, { n: N, players: 0, picks: [[0, 0], [0, 0], [0, 0]], scores: [0, 0, 0, 0] }],
  ["a body that isn't JSON", 200, "<html>"],
] as const) {
  test(`crowd lines are hidden on ${label}`, async ({ page }) => {
    const seen = await fakeApi(page, () => ({ status, body }));
    await openPinned(page);
    await pickAndLock(page, [0, 0, 0]);
    await skipToResults(page);
    await expect.poll(() => seen.statsCalls).toBeGreaterThan(0);
    await expect(page.getByRole("heading", { name: "Your stats" })).toBeVisible();
    await expect(page.locator(".daily-crowd")).toHaveCount(0);
  });
}

test("the About page says what Daily Three sends", async ({ page }) => {
  await page.goto("/about");
  const section = page.getByRole("heading", { name: "Daily Three" });
  await expect(section).toBeVisible();
  await expect(page.locator("article")).toContainText("random id this browser made for Daily Three and nothing else");
  await expect(page.locator("article")).toContainText("Scores are self-reported and not checked");
});

test("against the local Worker, each browser counts once a day", async ({ browser, request }) => {
  const n = todayN();
  test.skip(n < 1 || n > META.lastDay, "today is outside the committed schedule");
  const statsNow = async (): Promise<DailyCrowdStats> => {
    const r = await request.get(`${API}/v1/daily/${n}/stats`);
    expect(r.status()).toBe(200);
    return r.json();
  };
  const before = await statsNow();
  const picks: Side[] = [0, 0, 0];
  const score = picks.filter((p, i) => p === winners(n)[i]).length;

  async function play() {
    const context = await browser.newContext({ timezoneId: ZONE });
    const page = await context.newPage();
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/v1/daily/")) posts.push(r.url());
    });
    await page.goto("/daily");
    await expect(page.getByRole("heading", { level: 1, name: `Daily Three #${n}` })).toBeVisible();
    await expect(page.locator(".daily-crowd")).toHaveCount(0);
    const sent = page.waitForResponse((r) => r.url() === `${API}/v1/daily/${n}/result` && r.request().method() === "POST");
    await pickAndLock(page, picks);
    expect((await sent).status()).toBe(200);
    await skipToResults(page);
    return { context, page, posts };
  }

  const a = await play();
  await expect(a.page.locator(".daily-crowd")).toContainText(`${crowdPlayers(before.players + 1)} so far.`);
  await expect(a.page.locator(".daily-crowd li")).toHaveCount(4);
  const afterA = await statsNow();
  expect(afterA.players).toBe(before.players + 1);
  expect(afterA.scores[score]).toBe(before.scores[score] + 1);
  expect(afterA.picks.map((p) => p[0])).toEqual(before.picks.map((p) => p[0] + 1));

  // A reload sends nothing, and a repeat of the same browser's result is ignored.
  await a.page.reload();
  await expect(a.page.getByRole("heading", { name: /You went/ })).toBeVisible();
  await expect(a.page.locator(".daily-crowd")).toBeVisible();
  expect(a.posts).toHaveLength(1);
  const clientId = await a.page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null").clientId as string, STORAGE_KEY);
  const repeat = await request.post(`${API}/v1/daily/${n}/result`, { data: { clientId, picks: [1, 1, 1], score: 3 } });
  expect(repeat.status()).toBe(200);
  expect(await statsNow()).toEqual(afterA);

  // A second browser counts as a second player.
  const b = await play();
  await expect(b.page.locator(".daily-crowd")).toContainText(`${crowdPlayers(before.players + 2)} so far.`);
  expect((await statsNow()).players).toBe(before.players + 2);
  await a.context.close();
  await b.context.close();
});
