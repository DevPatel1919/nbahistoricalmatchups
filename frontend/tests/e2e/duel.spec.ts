import { expect, test, type Page } from "@playwright/test";
import { DUEL_API_PORT } from "../../playwright.config";

// F09 Session 4: the guest duel loop against the local Worker (fixture pool),
// no answer in any client payload before lock, the bot disclosure and model
// benchmark on every result, and the static site working with the backend down.

type LoggedEvent = { name: string; [key: string]: unknown };
const API = `http://localhost:${DUEL_API_PORT}`;
// Field names and the fixture pool's distinctive model probabilities.
const ANSWER_MARKERS = ["actualWinner", "modelHomeWinProbability", "modelInSample", "0.871234", "0.691234", "0.541234", "0.128766", "0.308766", "0.458766"];

function events(page: Page): Promise<LoggedEvent[]> {
  return page.evaluate(() => (window as unknown as { __ctAnalytics: LoggedEvent[] }).__ctAnalytics);
}

/** Records every API response body, so tests can inspect what reached the browser. */
function recordApi(page: Page): { bodies: string[] } {
  const log = { bodies: [] as string[] };
  page.on("response", async (response) => {
    if (!response.url().startsWith(API) || response.request().method() === "OPTIONS") return;
    try {
      log.bodies.push(await response.text());
    } catch {
      // Body unavailable (navigation raced it); nothing to inspect.
    }
  });
  return log;
}

async function startSet(page: Page, opponent: "Sparring Partner" | "Solo", era = "Any era") {
  await page.goto("/duel");
  await page.getByRole("radio", { name: new RegExp(opponent) }).check();
  await page.getByLabel("Era").selectOption({ label: era });
  await page.getByRole("button", { name: "Start a set" }).click();
  await expect(page.getByRole("heading", { name: "Game 1 of 5" })).toBeVisible();
}

/** Picks every game with the keyboard: the home team at Confident, then Lean for the rest. */
async function pickAll(page: Page) {
  for (let i = 1; i <= 5; i++) {
    await expect(page.getByRole("heading", { name: `Game ${i} of 5` })).toBeVisible();
    const choices = page.getByRole("group", { name: "Who won?" }).getByRole("button");
    await choices.nth(1).focus();
    await page.keyboard.press("Enter");
    await expect(choices.nth(1)).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("radio", { name: i === 1 ? /Confident/ : /Lean/ }).check();
    await page.getByRole("button", { name: i === 5 ? "Review picks" : "Next game" }).click();
  }
  await expect(page.getByRole("heading", { name: "Your picks" })).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("360px guest play", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("a bot duel end to end: no answer before lock, disclosure and benchmark after", async ({ page }) => {
    const api = recordApi(page);
    await page.goto("/");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Duel" }).click();
    await expect(page.getByRole("heading", { name: "Call five real games" })).toBeVisible();
    await expect(page.getByText("Skill-matched practice opponent, not a model prediction.")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await startSet(page, "Sparring Partner", "2005–2011");
    await expect(page.locator(".duel-play__opponent")).toContainText("Sparring Partner");
    await expect(page.locator(".duel-play__opponent")).toContainText("not a model prediction");
    await expect(page.locator(".puzzle__meta")).toContainText("2005–2011");
    await expectNoHorizontalOverflow(page);

    await pickAll(page);
    await expectNoHorizontalOverflow(page);

    // Everything the browser has received so far is pre-lock.
    expect(api.bodies.length).toBeGreaterThanOrEqual(2);
    for (const body of api.bodies) for (const marker of ANSWER_MARKERS) expect(body, marker).not.toContain(marker);

    await page.getByRole("button", { name: "Lock in picks" }).click();
    await expect(page.locator(".reveal__headline")).toContainText(/Sparring Partner/);
    await expect(page.getByTestId("bot-disclosure")).toContainText("not a model prediction");
    await expect(page.getByTestId("model-benchmark")).toContainText("fixed benchmark");
    await expect(page.locator(".reveal-game")).toHaveCount(5);
    await expect(page.locator(".reveal-pick", { hasText: "Model" })).toHaveCount(5);
    await expectNoHorizontalOverflow(page);

    const log = await events(page);
    expect(log.filter((e) => e.name === "duel_started")).toEqual([
      { name: "duel_started", mode: "bot", drawKind: "era", era: "2005-2011" },
    ]);
    const completed = log.filter((e) => e.name === "duel_completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ mode: "bot", drawKind: "era" });
    expect(["win", "loss", "draw"]).toContain(completed[0].outcome);
  });
});

test("solo play shows the model benchmark and no bot", async ({ page }) => {
  await startSet(page, "Solo");
  await expect(page.locator(".duel-play__opponent")).toHaveCount(0);
  await pickAll(page);
  await page.getByRole("button", { name: "Lock in picks" }).click();
  await expect(page.getByTestId("model-benchmark")).toBeVisible();
  await expect(page.locator(".reveal__score--benchmark")).toContainText("Pre-game model");
  await expect(page.getByTestId("bot-disclosure")).toHaveCount(0);
  const completed = (await events(page)).filter((e) => e.name === "duel_completed");
  expect(completed).toEqual([{ name: "duel_completed", mode: "solo", drawKind: "random", outcome: "solo", beatModel: expect.any(Boolean) }]);
});

test("a reload keeps picks mid-set and shows the same result after lock", async ({ page }) => {
  await startSet(page, "Sparring Partner");
  const choices = page.getByRole("group", { name: "Who won?" }).getByRole("button");
  await choices.first().click();
  await page.getByRole("radio", { name: /Lock/ }).check();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Game 1 of 5" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Who won?" }).getByRole("button").first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("radio", { name: /Lock/ })).toBeChecked();
  await expect(page.locator(".duel-play__progress")).toHaveText("1 of 5 picked");

  await page.getByRole("button", { name: "Next game" }).click();
  for (let i = 2; i <= 5; i++) {
    await page.getByRole("group", { name: "Who won?" }).getByRole("button").first().click();
    await page.getByRole("radio", { name: /Lean/ }).check();
    await page.getByRole("button", { name: i === 5 ? "Review picks" : "Next game" }).click();
  }
  await page.getByRole("button", { name: "Lock in picks" }).click();
  const before = await page.locator(".reveal").innerText();
  await page.reload();
  await expect(page.locator(".reveal")).toBeVisible();
  expect(await page.locator(".reveal").innerText()).toBe(before);
  expect((await events(page)).filter((e) => e.name === "duel_completed")).toHaveLength(0);
});

test("lock in is unavailable until every game has a side and a confidence", async ({ page }) => {
  await startSet(page, "Solo");
  await expect(page.getByRole("button", { name: "Next game" })).toBeDisabled();
  await page.getByRole("group", { name: "Who won?" }).getByRole("button").first().click();
  await expect(page.getByRole("button", { name: "Next game" })).toBeDisabled();
  await page.getByRole("radio", { name: /Lean/ }).check();
  await expect(page.getByRole("button", { name: "Next game" })).toBeEnabled();
});

test.describe("the static site with the duel backend unavailable", () => {
  test("the explorer and tournaments never call the duel API", async ({ page }) => {
    const hits: string[] = [];
    page.on("request", (req) => {
      if (req.url().startsWith(API)) hits.push(req.url());
    });
    await page.goto("/");
    await expect(page.locator(".search-box input").first()).toBeVisible();
    await page.goto("/1998-bulls-vs-2017-warriors");
    await expect(page.locator(".winner-card__prob")).toBeVisible();
    await page.goto("/tournament");
    await expect(page.getByRole("heading", { name: "The Champions Bracket" })).toBeVisible();
    expect(hits).toEqual([]);
  });

  test("with the API unreachable, matchups and tournaments work and duel mode says so", async ({ page }) => {
    await page.route(`${API}/**`, (route) => route.abort("connectionrefused"));
    await page.goto("/1998-bulls-vs-2017-warriors");
    await expect(page.locator(".winner-card__prob")).toContainText("%");
    await page.goto("/tournament");
    await page.getByRole("button", { name: "Make my picks" }).click();
    await expect(page.locator(".tournament__progress")).toBeVisible();

    await page.goto("/duel");
    await page.getByRole("button", { name: "Start a set" }).click();
    await expect(page.getByRole("alert")).toContainText("The matchup explorer and tournaments still work");
    await page.goto("/duel/d_anything");
    await expect(page.getByRole("alert")).toContainText("unavailable");
    const errors = (await events(page)).filter((e) => e.name === "app_error");
    expect(errors.map((e) => e.surface)).toContain("duel-load");
  });
});
