import { expect, test, type Page } from "@playwright/test";

// F05 completion criteria: canonical events fire once at their transitions
// (read from the dev-only event log in main.tsx), opt-out leaves the product
// usable and silent, share images are 1200x630 original artwork, and priced
// intent actions take no payment.

type LoggedEvent = { name: string; [key: string]: unknown };

const MATCHUP = "/1998-bulls-vs-2017-warriors";
const CHAMPIONS_CODE =
  "t1.7.champions-v1.2025-thunder~2024-celtics~2017-warriors~2008-celtics~2015-warriors~1999-spurs~2007-spurs~2000-lakers~2005-spurs~2014-spurs~2013-heat~2009-lakers~1998-bulls~2002-lakers~2004-pistons~2012-heat";

async function stubClipboard(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text: string) => void w.__copied.push(text) },
      configurable: true,
    });
  });
}

function events(page: Page): Promise<LoggedEvent[]> {
  return page.evaluate(() => (window as unknown as { __ctAnalytics: LoggedEvent[] }).__ctAnalytics);
}

async function named(page: Page, ...names: string[]): Promise<LoggedEvent[]> {
  return (await events(page)).filter((e) => names.includes(e.name));
}

test("a matchup from the home search fires started, completed, and shared once each", async ({ page }) => {
  await stubClipboard(page);
  await page.goto("/");
  const input = page.locator(".search-box input").first();
  await input.fill("98 bulls");
  await input.press("Enter");
  await input.fill("2017 warriors");
  await input.press("Enter");
  await expect(page.locator(".winner-card__prob")).toContainText("%");

  await page.getByRole("button", { name: /Copy link/ }).click();
  await expect(page.getByText("Copied!")).toBeVisible();

  const all = await events(page);
  expect(all[0]).toMatchObject({ name: "visit_started", visitKind: "first", daysSinceFirstVisit: "0", firstReturn: false });
  expect(all[0].cohortWeek).toMatch(/^\d{4}-W\d{2}$/);

  const funnel = await named(page, "matchup_started", "matchup_completed", "matchup_shared");
  expect(funnel).toHaveLength(3);
  expect(funnel[0]).toEqual({ name: "matchup_started", entrySurface: "home-search" });
  expect(funnel[1]).toEqual({ name: "matchup_completed", teamA: "1998-bulls", teamB: "2017-warriors", extrapolationWarning: false });
  expect(funnel[2]).toMatchObject({ name: "matchup_shared", surface: "result-page", shareMethod: "copy" });

  // The copied link carries the sharer's experiment arm, and nothing personal.
  const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
  const url = new URL(copied[0]);
  expect(url.pathname).toBe(MATCHUP);
  expect(url.search).toBe(funnel[2].variant === "challenge" ? "?via=challenge" : "?via=share");

  // No property carries an email-like or URL-like value.
  for (const e of all) {
    for (const v of Object.values(e)) expect(String(v)).not.toMatch(/@|https?:/);
  }
});

test("the extrapolation warning is reported for a non-playoff team", async ({ page }) => {
  await page.goto("/1998-76ers-vs-2017-warriors");
  await expect(page.locator(".winner-card__prob")).toContainText("%");
  expect(await named(page, "matchup_completed")).toEqual([
    { name: "matchup_completed", teamA: "1998-76ers", teamB: "2017-warriors", extrapolationWarning: true },
  ]);
});

test("a challenge link asks for a pick before revealing the model", async ({ page }) => {
  await page.goto(`${MATCHUP}?via=challenge`);
  await expect(page.getByRole("heading", { name: "Who wins on a neutral court?" })).toBeVisible();
  await expect(page.locator(".winner-card")).toHaveCount(0);
  expect(await named(page, "matchup_completed")).toEqual([]);

  await page.getByRole("button", { name: /1998 Chicago Bulls/ }).click();
  await expect(page.locator(".challenge__verdict")).toContainText("You picked the 1998 Bulls.");
  await expect(page.locator(".challenge__verdict")).toContainText("The model disagrees.");
  await expect(page.locator(".winner-card__prob")).toContainText("73.8%");

  expect(await named(page, "matchup_started", "challenge_answered", "matchup_completed")).toEqual([
    { name: "matchup_started", entrySurface: "shared-challenge" },
    { name: "challenge_answered", agreedWithModel: false },
    { name: "matchup_completed", teamA: "1998-bulls", teamB: "2017-warriors", extrapolationWarning: false },
  ]);
});

test("attribution survives the reverse-order redirect", async ({ page }) => {
  await page.goto("/2017-warriors-vs-1998-bulls?via=share");
  await expect(page).toHaveURL(`${MATCHUP}?via=share`);
  await expect(page.locator(".winner-card__prob")).toContainText("73.8%");
  expect(await named(page, "matchup_started")).toEqual([{ name: "matchup_started", entrySurface: "shared-plain" }]);
});

test("opting out silences analytics and changes nothing else", async ({ page }) => {
  await page.goto("/about");
  await page.getByRole("button", { name: "Turn off analytics" }).click();
  await expect(page.getByText("Analytics events are off in this browser.")).toBeVisible();

  await page.goto(MATCHUP);
  await expect(page.locator(".winner-card__prob")).toContainText("73.8%");
  await page.goto("/tournament");
  await page.getByRole("button", { name: "Make my picks" }).click();
  await expect(page.locator(".tournament__progress")).toContainText("0 of 15");
  expect(await events(page)).toEqual([]);

  await page.goto("/about");
  await page.getByRole("button", { name: "Turn analytics back on" }).click();
  await page.goto(MATCHUP);
  await expect(page.locator(".winner-card__prob")).toContainText("73.8%");
  expect((await named(page, "matchup_completed")).length).toBe(1);
});

test.describe("Global Privacy Control", () => {
  test.use({ extraHTTPHeaders: { "Sec-GPC": "1" } });

  test("is honored without any action", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "globalPrivacyControl", { value: true }));
    await page.goto(MATCHUP);
    await expect(page.locator(".winner-card__prob")).toContainText("73.8%");
    expect(await events(page)).toEqual([]);
    await page.goto("/about");
    await expect(page.getByText(/sends a privacy signal/)).toBeVisible();
  });
});

async function cardPixels(page: Page) {
  const canvas = page.locator("canvas[data-card-state]");
  await expect(canvas).toHaveAttribute("data-card-state", "ready");
  return page.evaluate(() => {
    const c = document.querySelector("canvas")!;
    const ctx = c.getContext("2d")!;
    const colors = new Set<string>();
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < data.length; i += 4 * 97) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    return { width: c.width, height: c.height, colors: colors.size, box: c.getBoundingClientRect().toJSON() };
  });
}

test("matchup and tournament share cards render at 1200x630", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 630 });
  for (const path of [`/card/m${MATCHUP}`, `/card/t/${CHAMPIONS_CODE}`]) {
    await page.goto(path);
    const px = await cardPixels(page);
    expect(px.width).toBe(1200);
    expect(px.height).toBe(630);
    expect(px.box.width).toBe(1200);
    expect(px.box.height).toBe(630);
    // Real artwork, not a blank or single-color canvas.
    expect(px.colors).toBeGreaterThan(20);
  }
  // No header or footer on the render route.
  await expect(page.locator(".site-header")).toHaveCount(0);
});

test("a broken card route reports an error state instead of hanging", async ({ page }) => {
  await page.goto("/card/t/garbage");
  await expect(page.locator("canvas")).toHaveAttribute("data-card-state", "error");
  await page.goto("/card/m/1998-bulls-vs-1850-nobody");
  await expect(page.locator("canvas")).toHaveAttribute("data-card-state", "error");
});

test("the result page downloads a 1200x630 PNG share image", async ({ page }) => {
  await stubClipboard(page);
  await page.goto(MATCHUP);
  await expect(page.locator(".winner-card__prob")).toContainText("73.8%");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Share image" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("1998-bulls-vs-2017-warriors.png");
  const bytes = await (await download.createReadStream()).toArray();
  const png = Buffer.concat(bytes);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
  await expect.poll(async () => (await named(page, "matchup_shared")).length).toBe(1);
  expect((await named(page, "matchup_shared"))[0]).toMatchObject({ shareMethod: "image" });
});

test("price intent is recorded, qualified only after a core job, and takes no payment", async ({ page }) => {
  await page.goto("/plans");
  await expect(page.getByText("Not on sale yet", { exact: false }).first()).toBeVisible();
  await expect(page.locator(".offer__price .scoreboard")).toHaveText(["$49", "$9.99", "$99"]);
  expect(await named(page, "offer_viewed")).toEqual([
    { name: "offer_viewed", surface: "plans", audience: "fan" },
    { name: "offer_viewed", surface: "plans", audience: "creator" },
  ]);

  await page.getByRole("button", { name: "I'd buy this for $49" }).click();
  await expect(page.getByText("Sign-ups aren't open yet")).toBeVisible();

  // Complete a core job, then come back.
  await page.goto(MATCHUP);
  await expect(page.locator(".winner-card__prob")).toContainText("73.8%");
  await page.goto("/plans");
  await page.getByRole("button", { name: "I'd buy this for $9.99" }).click();
  await page.getByRole("button", { name: "I'd pay $99 for this" }).click();

  // Each page load has its own log; collect the intent from both visits.
  const second = await named(page, "price_intent_clicked");
  expect(second).toEqual([
    { name: "price_intent_clicked", audience: "fan", offerId: "tournament-pass-999", displayedPrice: "$9.99", qualified: true },
    { name: "price_intent_clicked", audience: "creator", offerId: "creator-pilot-99", displayedPrice: "$99", qualified: true },
  ]);
  // No form, card field, or checkout anywhere: no email endpoint is configured in dev.
  await expect(page.locator("input[type=email], input[autocomplete^=cc]")).toHaveCount(0);
});

test("the first price click on a fresh browser is unqualified", async ({ page }) => {
  await page.goto("/plans");
  await page.getByRole("button", { name: "I'd buy this for $49" }).click();
  expect(await named(page, "price_intent_clicked")).toEqual([
    { name: "price_intent_clicked", audience: "fan", offerId: "fan-annual-49", displayedPrice: "$49", qualified: false },
  ]);
});

test("the tournament summary offers a share image and the fan plans", async ({ page }) => {
  await stubClipboard(page);
  await page.goto("/tournament");
  await page.getByRole("button", { name: "Make my picks" }).click();
  for (let i = 0; i < 15; i++) {
    await page.locator(".bracket__series[role=group]:not(:has([aria-pressed=true]))").first().locator("button").first().click();
  }
  await page.getByRole("button", { name: "Reveal everything" }).click();
  await expect(page.locator(".tournament-summary")).toBeVisible();
  await expect(page.getByRole("region", { name: "Run one for your group?" })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Share image" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("champions-v1.png");
  await expect.poll(async () => named(page, "tournament_shared", "offer_viewed")).toEqual([
    { name: "offer_viewed", surface: "tournament-summary", audience: "fan" },
    { name: "tournament_shared", tournamentId: "champions-v1", shareMethod: "image" },
  ]);
});
