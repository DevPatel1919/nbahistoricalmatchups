import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { DUEL_API_PORT } from "../../playwright.config";

// F09 Session 6: a ranked duel between two accounts in two browsers and a friend
// duel by invite link between two guests. Both seats play the identical set,
// nothing about the result or the other seat reaches a browser before both have
// locked in, and the result shows the opponent, the model benchmark, and (ranked
// only) the rating change.

const API = `http://localhost:${DUEL_API_PORT}`;
const HIDDEN = ["actualWinner", "modelHomeWinProbability", "0.691234", "0.308766", '"picks"', '"confidence"'];

const unique = () => Date.now() + "-" + Math.random().toString(36).slice(2, 8);

/** An account made through the API that has completed its 10 sets and chosen a name. Returns its session token. */
async function eligibleAccount(request: APIRequestContext, name: string): Promise<string> {
  const email = `ranked.${unique()}@example.com`;
  expect((await request.post(`${API}/v1/auth/magic-link`, { data: { email, turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" } })).status()).toBe(202);
  const { text } = (await (await request.get(`${API}/v1/dev/outbox?to=${encodeURIComponent(email)}`)).json()) as { text: string };
  const token = /#token=(ml_[A-Za-z0-9_-]+)/.exec(text)?.[1];
  const signed = await request.post(`${API}/v1/auth/verify`, { data: { token } });
  const { sessionToken } = (await signed.json()) as { sessionToken: string };
  const headers = { authorization: "Bearer " + sessionToken };
  for (let i = 0; i < 10; i++) {
    const set = await (await request.post(`${API}/v1/sets`, { headers, data: { mode: "solo", draw: { kind: "random" } } })).json();
    const picks = set.puzzles.map((p: { puzzleId: string }) => ({ puzzleId: p.puzzleId, side: "home", confidence: "lean" }));
    const r = await request.post(`${API}/v1/duels/${set.duelId}/submission`, {
      headers: { ...headers, "idempotency-key": unique() },
      data: { setToken: set.setToken, picks },
    });
    expect(r.ok()).toBe(true);
  }
  expect((await request.post(`${API}/v1/account/display-name`, { headers, data: { displayName: name } })).ok()).toBe(true);
  return sessionToken;
}

async function signedInPage(browser: Browser, sessionToken: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
  await context.addInitScript((token) => localStorage.setItem("ct:duel:session:v1", token), sessionToken);
  return context.newPage();
}

function recordApi(page: Page): { bodies: string[] } {
  const log = { bodies: [] as string[] };
  page.on("response", async (response) => {
    if (!response.url().startsWith(API) || response.request().method() === "OPTIONS") return;
    try {
      log.bodies.push(await response.text());
    } catch {
      // Body unavailable; nothing to inspect.
    }
  });
  return log;
}

async function pickAll(page: Page, side: 0 | 1): Promise<string[]> {
  const games: string[] = [];
  for (let i = 1; i <= 5; i++) {
    await expect(page.getByRole("heading", { name: `Game ${i} of 5` })).toBeVisible();
    // The stats table differs for every fixture puzzle (the team names do not).
    games.push(await page.locator(".puzzle__table").innerText());
    await page.getByRole("group", { name: "Who won?" }).getByRole("button").nth(side).click();
    await page.getByRole("radio", { name: /Confident/ }).check();
    await page.getByRole("button", { name: i === 5 ? "Review picks" : "Next game" }).click();
  }
  await expect(page.getByRole("heading", { name: "Your picks" })).toBeVisible();
  return games;
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe.configure({ mode: "serial" });

test("a ranked duel between two browsers: same set, nothing early, rated result for both", async ({ browser, request }) => {
  const nameA = "Ranked A " + unique().slice(-4);
  const nameB = "Ranked B " + unique().slice(-4);
  const [tokenA, tokenB] = [await eligibleAccount(request, nameA), await eligibleAccount(request, nameB)];

  const a = await signedInPage(browser, tokenA);
  const apiA = recordApi(a);
  await a.goto("/duel");
  const rankedOption = a.getByRole("radio", { name: /Ranked/ });
  await expect(rankedOption).toBeEnabled();
  await rankedOption.check();
  await expect(a.getByLabel("Era")).toBeDisabled();
  await a.getByRole("button", { name: "Start a set" }).click();
  await expect(a.locator(".duel-play__opponent")).toContainText("an opponent gets these same five games");
  const gamesA = await pickAll(a, 0);
  await a.getByRole("button", { name: "Lock in picks" }).click();
  await expect(a.getByRole("heading", { name: "Finding a ranked opponent" })).toBeVisible();
  await expect(a.getByRole("button", { name: /Play the Sparring Partner now \(unrated\)/ })).toBeVisible();
  await expectNoHorizontalOverflow(a);
  const duelA = new URL(a.url()).pathname;

  const b = await signedInPage(browser, tokenB);
  const apiB = recordApi(b);
  await b.goto("/duel");
  await b.getByRole("radio", { name: /Ranked/ }).check();
  await b.getByRole("button", { name: "Start a set" }).click();
  await expect(b.locator(".duel-play__opponent")).toContainText("vs " + nameA);
  const gamesB = await pickAll(b, 1);
  expect(gamesB).toEqual(gamesA);

  // Before B locks in, neither browser has received an answer or the other's picks.
  for (const body of [...apiA.bodies, ...apiB.bodies]) for (const marker of HIDDEN) expect(body, marker).not.toContain(marker);
  await a.reload();
  await expect(a.getByRole("heading", { name: nameB + " is playing your set" })).toBeVisible();
  for (const body of apiA.bodies) for (const marker of HIDDEN) expect(body, marker).not.toContain(marker);

  await b.getByRole("button", { name: "Lock in picks" }).click();
  await expect(b.getByTestId("match-note")).toContainText("Rated duel. Your rating: 1,200 →");
  await expect(b.getByTestId("model-benchmark")).toBeVisible();
  await expect(b.getByTestId("bot-disclosure")).toHaveCount(0);
  await expect(b.locator(".reveal__score").filter({ hasText: nameA })).toBeVisible();
  await expect(b.locator(".reveal-pick__who").filter({ hasText: nameA })).toHaveCount(5);
  await expectNoHorizontalOverflow(b);

  await a.goto(duelA);
  await expect(a.getByTestId("match-note")).toContainText("Rated duel. Your rating: 1,200 →");
  await expect(a.locator(".reveal-pick__who").filter({ hasText: nameB })).toHaveCount(5);
  const headlineA = await a.getByRole("heading", { level: 1 }).innerText();
  const headlineB = await b.getByRole("heading", { level: 1 }).innerText();
  expect([headlineA, headlineB].some((h) => h.startsWith("You beat") || h.startsWith("A draw"))).toBe(true);

  await a.goto("/account");
  await expect(a.getByTestId("account-rating")).toContainText("after 1 rated duel (provisional for your first 10).");
  await a.context().close();
  await b.context().close();
});

test("a friend duel by invite link between two guests", async ({ browser }) => {
  const host = await (await browser.newContext({ viewport: { width: 360, height: 740 } })).newPage();
  await host.goto("/duel");
  await host.getByRole("radio", { name: /A friend/ }).check();
  await host.getByLabel("Era").selectOption({ label: "2012–2016" });
  await host.getByRole("button", { name: "Start a set" }).click();
  const gamesHost = await pickAll(host, 0);
  await host.getByRole("button", { name: "Lock in picks" }).click();
  await expect(host.getByRole("heading", { name: "Send this set to a friend" })).toBeVisible();
  const link = await host.getByLabel("Invite link").inputValue();
  expect(link).toMatch(/\/duel\/join#invite=/);
  await expectNoHorizontalOverflow(host);
  const hostDuel = new URL(host.url()).pathname;

  const pal = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const apiPal = recordApi(pal);
  await pal.goto(link);
  await expect(pal.getByRole("heading", { name: "You've been challenged" })).toBeVisible();
  await pal.getByRole("button", { name: "Start the duel" }).click();
  await expect(pal.locator(".duel-play__opponent")).toContainText("vs Your friend");
  const gamesPal = await pickAll(pal, 1);
  expect(gamesPal).toEqual(gamesHost);
  for (const body of apiPal.bodies) for (const marker of HIDDEN) expect(body, marker).not.toContain(marker);

  // The host's page notices the friend joining on its own.
  await host.reload();
  await expect(host.getByRole("heading", { name: "Your friend is playing your set" })).toBeVisible();

  await pal.getByRole("button", { name: "Lock in picks" }).click();
  await expect(pal.getByTestId("match-note")).toHaveText("Friend duels are unranked.");
  await expect(pal.locator(".reveal-pick__who").filter({ hasText: "Your friend" })).toHaveCount(5);

  await host.goto(hostDuel);
  await expect(host.getByTestId("match-note")).toHaveText("Friend duels are unranked.");
  await expect(host.locator(".reveal-pick__who").filter({ hasText: "Your friend" })).toHaveCount(5);

  // The link is spent.
  const third = await (await browser.newContext()).newPage();
  await third.goto(link);
  await third.getByRole("button", { name: "Start the duel" }).click();
  await expect(third.getByRole("alert")).toContainText("expired or was already used");
});
