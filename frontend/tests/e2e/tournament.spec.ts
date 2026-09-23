import { expect, test, type Page } from "@playwright/test";

// F04 completion criteria: the tournament journey at 360px and by keyboard,
// deterministic shared links, the safe invalid-link screen, the assumptions,
// and the F05 analytics hooks (read from the dev-only event log in main.tsx).

type LoggedEvent = { name: string; [key: string]: unknown };

/** Replace the share sheet and clipboard with a recorder, so sharing is testable. */
async function stubSharing(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text: string) => void w.__copied.push(text) },
      configurable: true,
    });
  });
}

function events(page: Page): Promise<LoggedEvent[]> {
  return page.evaluate(() => (window as unknown as { __ctAnalytics: LoggedEvent[] }).__ctAnalytics);
}

/** Makes every pick with the keyboard: focus a choice, press Enter. Picks the top team each time. */
async function pickAllByKeyboard(page: Page) {
  const progress = page.locator(".tournament__progress");
  for (let guard = 0; guard < 20; guard++) {
    const text = (await progress.textContent()) ?? "";
    const [made, total] = text.match(/\d+/g)!.map(Number);
    if (made === total) return;
    // The first series with no pick yet, in bracket order (rounds render in order).
    const open = page.locator(".bracket__series[role=group]:not(:has([aria-pressed=true]))").first();
    const choice = open.locator("button.bracket__team--choice").first();
    await choice.focus();
    await page.keyboard.press("Enter");
    await expect(progress).toContainText(`${made + 1} of ${total}`);
  }
  throw new Error("Bracket did not complete");
}

async function modelBracketText(page: Page): Promise<string> {
  return (await page.locator(".bracket").innerText()).replace(/Your pick:[^\n]*/g, "");
}

test.describe("360px, keyboard only", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("the whole curated journey works", async ({ page }) => {
    await stubSharing(page);
    await page.goto("/tournament");

    await expect(page.getByRole("heading", { name: "The Champions Bracket" })).toBeVisible();
    await expect(page.locator(".data-table tbody tr")).toHaveCount(16);
    const assumptions = page.locator(".tournament-assumptions");
    await expect(assumptions).toContainText("neutral court");
    await expect(assumptions).toContainText("independent");
    await expect(assumptions).toContainText("model estimate");

    const start = page.getByRole("button", { name: "Make my picks" });
    await start.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("button", { name: "Reveal round by round" })).toHaveCount(0);
    await pickAllByKeyboard(page);

    const byRound = page.getByRole("button", { name: "Reveal round by round" });
    await byRound.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".bracket__verdict--right, .bracket__verdict--wrong")).toHaveCount(8);

    const rest = page.getByRole("button", { name: "Reveal the rest" });
    await rest.focus();
    await page.keyboard.press("Enter");

    const summary = page.locator(".tournament-summary");
    await expect(summary).toContainText("win the title");
    await expect(summary).toContainText("/ 320");
    await expect(page.locator(".bracket__verdict--right, .bracket__verdict--wrong")).toHaveCount(15);
    await expect(page.locator(".tournament-odds tbody tr")).toHaveCount(16);

    const share = page.getByRole("button", { name: "Share this tournament" });
    await share.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Link copied")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test("the shared link replays the same model bracket, without the picks", async ({ page, browser }) => {
  await stubSharing(page);
  await page.goto("/tournament");
  await page.getByRole("button", { name: "Make my picks" }).click();
  await pickAllByKeyboard(page);
  await page.getByRole("button", { name: "Reveal everything" }).click();
  const champion = await page.locator(".tournament-summary h2").textContent();
  const story = await modelBracketText(page);

  await page.getByRole("button", { name: "Share this tournament" }).click();
  const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
  expect(copied).toHaveLength(1);
  const url = new URL(copied[0]);
  expect(url.pathname).toMatch(/^\/t\/t1\.7\.champions-v1\./);
  expect(url.search).toBe("");

  // Refreshing keeps the local picks and the same story.
  await page.reload();
  await expect(page.locator(".tournament-summary h2")).toHaveText(champion!);
  expect(await modelBracketText(page)).toBe(story);

  // A fresh visitor on the shared link has no picks, but gets the same story.
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto(url.pathname);
  await expect(other.getByRole("button", { name: "Make my picks" })).toBeVisible();
  await other.getByRole("button", { name: "Make my picks" }).click();
  await expect(other.locator(".tournament__progress")).toContainText("0 of 15");
  await pickAllByKeyboard(other);
  await other.getByRole("button", { name: "Reveal everything" }).click();
  await expect(other.locator(".tournament-summary h2")).toHaveText(champion!);
  expect(await modelBracketText(other)).toBe(story);
  await context.close();
});

test("run another story gets a new seed and link and keeps the picks", async ({ page }) => {
  await page.goto("/tournament");
  await page.getByRole("button", { name: "Make my picks" }).click();
  await pickAllByKeyboard(page);
  await page.getByRole("button", { name: "Reveal everything" }).click();
  await page.getByRole("button", { name: "Run another story" }).click();

  await expect(page).toHaveURL(/\/t\/t1\.7\.[a-z2-9]{10}\./);
  await expect(page.locator(".tournament__progress")).toContainText("15 of 15");
  await expect(page.getByRole("button", { name: "Reveal everything" })).toBeVisible();
});

test("invalid shared links fail to a safe explanation", async ({ page }) => {
  for (const bad of [
    "/t/garbage",
    "/t/t1.7.abc.1998-bulls~2017-warriors",
    "/t/t1.7.abc.1998-bulls~1998-bulls~2000-lakers~2001-lakers~2002-lakers~2003-spurs~2004-pistons~2005-spurs",
    "/t/t1.7.abc.1998-bulls~1999-spurs~2000-lakers~2001-lakers~2002-lakers~2003-spurs~2004-pistons~1850-nobody",
  ]) {
    await page.goto(bad);
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("This tournament link doesn't work");
    await expect(alert.getByRole("link", { name: "Open the Champions bracket" })).toBeVisible();
  }
});

test("analytics hooks fire once at each tournament transition", async ({ page }) => {
  await stubSharing(page);
  await page.goto("/tournament");
  await page.getByRole("button", { name: "Make my picks" }).click();
  await pickAllByKeyboard(page);

  // Un-completing and re-completing the bracket is not a second completion.
  await page.locator(".bracket__series[role=group]").first().locator("button[aria-pressed=false]").click();
  await pickAllByKeyboard(page);

  await page.getByRole("button", { name: "Reveal round by round" }).click();
  await page.getByRole("button", { name: "Reveal the rest" }).click();
  await page.getByRole("button", { name: "Share this tournament" }).click();

  const tournamentEvents = (await events(page)).filter((e) => e.name.startsWith("tournament") || e.name.startsWith("bracket"));
  expect(tournamentEvents).toEqual([
    { name: "tournament_started", tournamentId: "champions-v1", entrantCount: 16 },
    { name: "bracket_predictions_completed", tournamentId: "champions-v1" },
    { name: "tournament_revealed", tournamentId: "champions-v1", revealMode: "round" },
    { name: "tournament_shared", tournamentId: "champions-v1", shareMethod: "copy" },
  ]);
});

test("an eight-team custom tournament can be built and played", async ({ page }) => {
  await page.goto("/tournament/new");
  const input = page.locator(".search-box input");
  for (const query of ["98 bulls", "2017 warriors", "2008 celtics", "2013 heat", "2004 pistons", "2014 spurs", "2001 lakers", "2016 cavaliers"]) {
    await input.fill(query);
    await expect(page.getByRole("option").first()).toBeVisible();
    await input.press("Enter");
  }
  await expect(page.locator(".builder__item")).toHaveCount(8);
  await page.getByLabel("Best-of-5").check();
  await page.getByRole("button", { name: "Create tournament" }).click();

  await expect(page).toHaveURL(/\/t\/t1\.5\./);
  await expect(page.getByRole("heading", { name: "Custom 8-team tournament" })).toBeVisible();
  await page.getByRole("button", { name: "Make my picks" }).click();
  await pickAllByKeyboard(page);
  await page.getByRole("button", { name: "Reveal everything" }).click();
  await expect(page.locator(".tournament-summary")).toContainText("/ 120");
  expect((await events(page)).find((e) => e.name === "tournament_started")).toEqual({
    name: "tournament_started",
    tournamentId: "custom-8",
    entrantCount: 8,
  });
});
