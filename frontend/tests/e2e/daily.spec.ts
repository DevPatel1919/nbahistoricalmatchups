import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { DAILY_OFF_PORT, DUEL_API_PORT } from "../../playwright.config";
import {
  addCalendarDays,
  buildShareText,
  computeStats,
  emptyStore,
  recordDay,
  simulateGame,
  type DailyDay,
  type DailyMeta,
  type DailyPool,
  type DailyStore,
  type Side,
} from "../../src/daily";
import type { IndexData } from "../../src/types";

// Daily Three (F12 Session 3). The date is pinned with Playwright's clock, in
// a fixed time zone, and every expected result is recomputed here from the
// committed data with the same engine, so the tests follow a rebuilt schedule.
//
// The pinned dates are outside the Worker's window around the real date, so
// crowd stats (Session 4) are blocked here; daily-crowd.spec.ts tests them.

const readJson = <T>(path: string): T => JSON.parse(readFileSync(`public/data/${path}`, "utf8")) as T;
const META = readJson<DailyMeta>("daily/meta.json");
const POOL = readJson<DailyPool>("daily/teams.json");
const INDEX = readJson<IndexData>("index.json");

/** A puzzle well inside the schedule. */
const N = 12;

/** Noon (or 11:00 in winter) in New York on puzzle n's date. */
function noonOf(n: number): Date {
  return new Date(`${addCalendarDays(META.launchDate, n - 1)}T12:00:00-04:00`);
}

function expected(n: number) {
  const day = readJson<DailyDay>(`daily/days/${n}.json`);
  const sims = day.games.map((game, gameIndex) =>
    simulateGame({ engine: day.engine, n, gameIndex, game, teamA: POOL.teams[game.a], teamB: POOL.teams[game.b] }),
  );
  const teams = Object.fromEntries(INDEX.teams.map((t) => [t.key, { season: t.season, name: t.name }]));
  return { day, sims, winners: sims.map((s) => s.winner), teams };
}

/** Picks that get exactly the first `right` games right. */
function picksScoring(n: number, right: number): Side[] {
  return expected(n).winners.map((w, i) => (i < right ? w : ((1 - w) as Side)));
}

test.use({ timezoneId: "America/New_York" });

test.beforeEach(async ({ page }) => {
  await page.route(`http://localhost:${DUEL_API_PORT}/v1/daily/**`, (route) => route.abort());
  // Share falls back to the clipboard; capture what would be copied.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          (window as unknown as { __copied: string }).__copied = text;
        },
      },
      configurable: true,
    });
  });
});

async function openDay(page: Page, n: number) {
  await page.clock.install({ time: noonOf(n) });
  await page.goto("/daily");
  await expect(page.getByRole("heading", { level: 1, name: `Daily Three #${n}` })).toBeVisible();
}

async function pick(page: Page, picks: Side[]) {
  for (const [i, side] of picks.entries()) {
    await page.locator(".daily-game").nth(i).locator(".daily-team").nth(side).click();
  }
}

async function lockIn(page: Page) {
  await page.getByRole("button", { name: "Lock in picks" }).click();
}

async function playDay(page: Page, picks: Side[]) {
  await pick(page, picks);
  await lockIn(page);
  await page.getByRole("button", { name: "Skip all" }).click();
  await expect(page.getByRole("heading", { name: /You went/ })).toBeVisible();
}

async function streaks(page: Page) {
  const text = await page.locator(".daily-results__streaks").innerText();
  const play = Number(/Play streak\s+(\d+)/.exec(text)?.[1]);
  const hot = Number(/Hot streak\s+(\d+)/.exec(text)?.[1]);
  return { play, hot };
}

test("a full play-through: cards, picks, lock-in, the reveal, and results", async ({ page }) => {
  const { day, sims } = expected(N);
  const picks = picksScoring(N, 2);
  await openDay(page, N);

  // Before lock-in: three games, the featured one marked, and nothing the model says.
  await expect(page.locator(".daily-game")).toHaveCount(3);
  await expect(page.locator(".daily-game").nth(2)).toContainText("Featured");
  const before = await page.locator("main").innerText();
  expect(before).not.toMatch(/\d%|by about|Final|Upset|favourites/);
  for (const g of day.games) {
    expect(before).not.toContain(String(Math.round(g.p * 100)) + "%");
  }
  await expect(page.locator(".daily-starter")).toHaveCount(30);

  const lock = page.getByRole("button", { name: "Lock in picks" });
  await expect(lock).toBeDisabled();
  await pick(page, [1, 1]);
  await expect(page.getByText("2 of 3 picked")).toBeVisible();
  await expect(lock).toBeDisabled();
  // Picks can change until lock-in.
  await pick(page, picks);
  await expect(lock).toBeEnabled();
  await lock.click();

  // Game 1 plays on a clock; Skip jumps to its final.
  await expect(page.getByRole("heading", { name: /Game 1 of 3/ })).toBeVisible();
  await page.clock.runFor(5_000);
  await expect(page.locator(".daily-board__clock")).toHaveText(/^Q\d \d+:\d\d$/);
  await expect(page.locator(".daily-board")).not.toContainText("Final");
  await expect(page.locator(".daily-reveal")).toContainText("One simulated game");
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.locator(".daily-board__clock")).toHaveText("Final");
  await expect(page.locator(".daily-board")).toContainText(String(sims[0].final[0]));
  await expect(page.locator(".daily-reveal__verdict")).toContainText("right");
  await expect(page.locator(".daily-reveal .daily-final__odds")).toContainText("The model");
  await page.getByRole("button", { name: "Next game" }).click();

  // Game 2 runs its ~20 seconds and moves on to game 3 on its own.
  await expect(page.getByRole("heading", { name: /Game 2 of 3/ })).toBeVisible();
  await page.clock.runFor(20_500);
  await expect(page.locator(".daily-board__clock")).toHaveText("Final");
  await page.clock.runFor(3_000);
  await expect(page.getByRole("heading", { name: /Game 3 of 3/ })).toBeVisible();
  await page.clock.runFor(23_500);

  // Results.
  await expect(page.getByRole("heading", { name: "You went 2/3" })).toBeVisible();
  await expect(page.locator(".daily-final")).toHaveCount(3);
  await expect(page.locator(".daily-final__verdict")).toHaveText([/Right/, /Right/, /Wrong/]);
  for (const [i, g] of day.games.entries()) {
    const final = page.locator(".daily-final").nth(i);
    await expect(final).toContainText("One simulated game");
    await expect(final).toContainText(/The model (gave|made|had)/);
    // The final score as text for screen readers.
    await expect(final.locator(".visually-hidden")).toContainText(`${sims[i].final[0]},`);
    await expect(final.getByRole("link", { name: /in the matchup explorer/ })).toHaveAttribute("href", `/${g.a}-vs-${g.b}`);
  }
  const after = await page.locator("main").innerText();
  expect(after).not.toMatch(/by about|\d+\.\d+ ?pts/);
  expect(after).not.toMatch(/\b(0|100)%/);
  await expect(page.locator(".daily-stats")).toContainText("Played");
  await expect(page.locator(".daily-countdown")).toContainText(/Next puzzle in \d+:\d\d:\d\d/);
  expect(await streaks(page)).toEqual({ play: 1, hot: 0 });
});

test("a refresh during the reveal lands on the results", async ({ page }) => {
  await openDay(page, N);
  await pick(page, picksScoring(N, 3));
  await lockIn(page);
  await expect(page.getByRole("heading", { name: /Game 1 of 3/ })).toBeVisible();
  await page.clock.runFor(3_000);

  await page.reload();
  await expect(page.getByRole("heading", { name: "You went 3/3" })).toBeVisible();
  await expect(page.locator(".daily-game")).toHaveCount(0);
  const stored = await page.evaluate(() => localStorage.getItem("ct:daily:v1"));
  expect(JSON.parse(stored ?? "{}").days[String(N)].picks).toEqual(picksScoring(N, 3));

  // Watch again replays the stored day without changing it.
  await page.getByRole("button", { name: "Watch again" }).click();
  await expect(page.getByRole("heading", { name: /Game 1 of 3/ })).toBeVisible();
  await page.getByRole("button", { name: "Skip all" }).click();
  await expect(page.getByRole("heading", { name: "You went 3/3" })).toBeVisible();
});

test("a second day in a row extends the play streak", async ({ page }) => {
  const first = picksScoring(N - 1, 3);
  const second = picksScoring(N, 1);
  await openDay(page, N - 1);
  await playDay(page, first);
  expect(await streaks(page)).toEqual({ play: 1, hot: 3 });

  await page.clock.setSystemTime(noonOf(N));
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: `Daily Three #${N}` })).toBeVisible();
  // Before playing, yesterday's streak is still alive.
  await expect(page.locator(".daily__streaks")).toContainText(/Play streak\s*1/);
  await playDay(page, second);

  let store: DailyStore = emptyStore();
  store = recordDay(store, N - 1, first, expected(N - 1).winners);
  store = recordDay(store, N, second, expected(N).winners);
  const stats = computeStats(store, N);
  expect(stats.playStreak.current).toBe(2);
  expect(await streaks(page)).toEqual({ play: 2, hot: stats.hotStreak.current });
  await expect(page.locator(".daily-stats")).toContainText(/Played\s*2/);
});

test("a skipped day resets the play streak", async ({ page }) => {
  await openDay(page, N - 2);
  await playDay(page, picksScoring(N - 2, 3));
  expect((await streaks(page)).play).toBe(1);

  await page.clock.setSystemTime(noonOf(N));
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: `Daily Three #${N}` })).toBeVisible();
  await expect(page.locator(".daily__streaks")).toContainText(/Play streak\s*0/);
  // A missed day does not reset the hot streak (Q3).
  await expect(page.locator(".daily__streaks")).toContainText(/Hot streak\s*3/);
  await playDay(page, picksScoring(N, 3));
  expect(await streaks(page)).toEqual({ play: 1, hot: 6 });
  await expect(page.locator(".daily-stats")).toContainText(/Best play streak\s*1/);
});

test("the share text names each winner and final score, with no odds or margin", async ({ page }) => {
  const { day, sims, teams, winners } = expected(N);
  const picks = picksScoring(N, 2);
  await openDay(page, N);
  await playDay(page, picks);
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByText("Copied to the clipboard")).toBeVisible();

  const copied = await page.evaluate(() => (window as unknown as { __copied?: string }).__copied);
  const stats = computeStats(recordDay(emptyStore(), N, picks, winners), N);
  expect(copied).toBe(
    buildShareText({
      n: N,
      games: day.games,
      teams,
      record: { picks, winners },
      finals: sims.map((s) => s.final),
      playStreak: stats.playStreak.current,
      hotStreak: stats.hotStreak.current,
    }),
  );
  expect(copied).toMatch(new RegExp(`^Daily Three #${N} · 2/3\\n🟩 .+ beat .+ \\d+–\\d+\\n`));
  expect(copied).not.toMatch(/%|by about|\d\.\d/);
  expect(copied!.endsWith("courtofalltime.win/daily")).toBe(true);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("shows the finals at once", async ({ page }) => {
    await openDay(page, N);
    await pick(page, picksScoring(N, 0));
    await lockIn(page);
    await expect(page.getByRole("heading", { name: "You went 0/3" })).toBeVisible();
    await expect(page.locator(".daily-reveal")).toHaveCount(0);
    await expect(page.locator(".daily-final")).toHaveCount(3);
  });
});

test.describe("at 375px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("fits without sideways scrolling in both themes, and plays by keyboard", async ({ page }) => {
    await openDay(page, N);
    const noOverflow = async () =>
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await noOverflow();
    await page.getByRole("button", { name: /switch to light theme/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await noOverflow();

    // Keyboard only: Space picks, Tab moves to the next game, Enter locks in.
    const picks = picksScoring(N, 3);
    await page.getByRole("radio").first().focus();
    for (const [i, side] of picks.entries()) {
      if (side === 1) await page.keyboard.press("ArrowRight");
      else await page.keyboard.press("Space");
      await expect(page.getByRole("group", { name: `Pick the winner of game ${i + 1}` }).getByRole("radio").nth(side)).toBeChecked();
      await page.keyboard.press("Tab");
    }
    await expect(page.getByRole("button", { name: "Lock in picks" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /Game 1 of 3/ })).toBeFocused();
    await noOverflow();

    await page.getByRole("button", { name: "Skip all" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "You went 3/3" })).toBeFocused();
    await noOverflow();
    await page.getByRole("button", { name: /switch to dark theme/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await noOverflow();
  });
});

test("the home card and the nav link lead to /daily", async ({ page }) => {
  await page.clock.install({ time: noonOf(N) });
  await page.goto("/");
  await page.getByRole("link", { name: "Play today's three" }).click();
  await expect(page).toHaveURL(/\/daily$/);
  await page.goto("/about");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Daily Three" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Daily Three #${N}` })).toBeVisible();
});

test("with the flag off, /daily is absent", async ({ page }) => {
  const base = `http://localhost:${DAILY_OFF_PORT}`;
  await page.goto(`${base}/daily`);
  await expect(page.getByText("We couldn't find that matchup.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Daily Three" })).toHaveCount(0);
  await page.goto(`${base}/`);
  await expect(page.getByRole("heading", { name: /Any two teams/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daily Three" })).toHaveCount(0);
});
