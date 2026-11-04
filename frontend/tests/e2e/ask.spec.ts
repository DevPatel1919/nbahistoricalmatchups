import { expect, test, type Page, type Route } from "@playwright/test";
import { DAILY_OFF_PORT, DUEL_API_PORT } from "../../playwright.config";

// Ask the Court (F13 Session 6). The API is answered here: the Worker's own tests
// cover the pipeline, and no test may spend Workers AI neurons.

const API = `http://localhost:${DUEL_API_PORT}/v1/ask`;
const MATCHUP = "/1996-bulls-vs-2017-warriors";

const SOURCES = [
  { label: "F1", id: null, title: "From the site's data", kind: "fact", text: "The simulator gives the 2016–17 Warriors a 53.1% chance." },
  { label: "C1", id: "method:neutral-court", title: "Neutral court", kind: "method", text: "Neither team gets home court." },
];

function stream(text: string, done: Record<string, unknown> = {}): string {
  const events = [
    ["meta", { askId: "x", linked: [], sources: SOURCES }],
    ["token", { text }],
    ["done", { grounded: true, removed: 0, citations: [], fallback: false, ...done }],
  ] as const;
  return events.map(([event, data]) => "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n").join("");
}

async function answerWith(page: Page, handler: (route: Route, body: Record<string, unknown>) => Promise<void>) {
  await page.route(API, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    await handler(route, route.request().postDataJSON() as Record<string, unknown>);
  });
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const sse = (body: string) => ({ status: 200, headers: { ...CORS, "content-type": "text/event-stream" }, body });
const fail = (status: number, error: string) => ({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify({ error, message: "x" }) });

test.describe("on a matchup page", () => {
  test("a suggested question sends the matchup and shows a template answer", async ({ page }) => {
    let sent: Record<string, unknown> = {};
    await answerWith(page, async (route, body) => {
      sent = body;
      await route.fulfill(sse(stream("The simulator favours the Warriors at 53.1% [F1].", { fallback: true })));
    });
    await page.goto(MATCHUP);
    const panel = page.getByRole("region", { name: "Ask the Court" });
    await panel.getByRole("button", { name: "Why this pick?" }).click();
    await expect(panel.getByText("The simulator favours the Warriors at 53.1%")).toBeVisible();
    expect(sent.suggested).toBe("why");
    expect(sent.context).toEqual({ a: "1996-bulls", b: "2017-warriors" });
    await expect(panel.getByText("Built directly from the site's data")).toBeVisible();
  });

  test("a free-text question streams an answer with citations that open", async ({ page }) => {
    let sent: Record<string, unknown> = {};
    await answerWith(page, async (route, body) => {
      sent = body;
      await route.fulfill(sse(stream("It gives them 53.1% [F1], on a neutral court [C1].")));
    });
    await page.goto(MATCHUP);
    const panel = page.getByRole("region", { name: "Ask the Court" });
    await panel.getByLabel(/ask your own question/i).fill("How sure is it?");
    await panel.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(panel.getByText("It gives them 53.1%")).toBeVisible();
    expect(sent).toEqual({ question: "How sure is it?", context: { a: "1996-bulls", b: "2017-warriors" } });

    await expect(panel.getByText("Neither team gets home court.")).toHaveCount(0);
    await panel.getByRole("button", { name: "Source 2: Neutral court" }).click();
    await expect(panel.getByText("Neither team gets home court.")).toBeVisible();
    await panel.getByRole("button", { name: "Source 2: Neutral court" }).click();
    await expect(panel.getByText("Neither team gets home court.")).toHaveCount(0);
    await expect(panel.getByText("can still be wrong")).toBeVisible();
  });

  test("says when details were removed", async ({ page }) => {
    await answerWith(page, async (route) => route.fulfill(sse(stream("It gives them 53.1% [F1].", { grounded: false, removed: 1 }))));
    await page.goto(MATCHUP);
    const panel = page.getByRole("region", { name: "Ask the Court" });
    await panel.getByLabel(/ask your own question/i).fill("Why?");
    await panel.getByLabel(/ask your own question/i).press("Enter");
    await expect(panel.getByText("Some details were removed")).toBeVisible();
  });

  for (const [status, code, message] of [
    [503, "ask_budget", "resting until tomorrow"],
    [503, "ask_disabled", "taking a break"],
    [429, "rate_limited", "Give it a minute"],
    [503, "ask_unavailable", "isn't available right now"],
  ] as const) {
    test("explains " + code, async ({ page }) => {
      await answerWith(page, async (route) => route.fulfill(fail(status, code)));
      await page.goto(MATCHUP);
      const panel = page.getByRole("region", { name: "Ask the Court" });
      await panel.getByLabel(/ask your own question/i).fill("Why?");
      await panel.getByRole("button", { name: "Ask", exact: true }).click();
      await expect(panel.getByText(message)).toBeVisible();
    });
  }

  test("an error partway through the stream replaces the answer", async ({ page }) => {
    const body = "event: meta\ndata: " + JSON.stringify({ askId: "x", linked: [], sources: SOURCES }) + "\n\nevent: error\ndata: " + JSON.stringify({ code: "internal" }) + "\n\n";
    await answerWith(page, async (route) => route.fulfill(sse(body)));
    await page.goto(MATCHUP);
    const panel = page.getByRole("region", { name: "Ask the Court" });
    await panel.getByLabel(/ask your own question/i).fill("Why?");
    await panel.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(panel.getByText("isn't available right now")).toBeVisible();
  });

  test("the matchup page keeps working when the API is blocked", async ({ page }) => {
    await page.route(API, (route) => route.abort());
    await page.goto(MATCHUP);
    const panel = page.getByRole("region", { name: "Ask the Court" });
    await panel.getByRole("button", { name: "Why this pick?" }).click();
    await expect(panel.getByText("Everything else on the site still works")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  });

  test("won't send an empty question, and works by keyboard at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await answerWith(page, async (route) => route.fulfill(sse(stream("It gives them 53.1% [F1]."))));
    await page.goto(MATCHUP);
    const panel = page.getByRole("region", { name: "Ask the Court" });
    await expect(panel.getByRole("button", { name: "Ask", exact: true })).toBeDisabled();
    const input = panel.getByLabel(/ask your own question/i);
    await input.focus();
    await page.keyboard.type("How sure?");
    await page.keyboard.press("Enter");
    await expect(panel.getByText("It gives them 53.1%")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("/ask", () => {
  test("asks without a matchup, from the nav", async ({ page }) => {
    let sent: Record<string, unknown> = {};
    await answerWith(page, async (route, body) => {
      sent = body;
      await route.fulfill(sse(stream("The 1992–93 Knicks [C1].")));
    });
    await page.goto("/");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Ask" }).click();
    await expect(page).toHaveURL(/\/ask$/);
    const panel = page.getByRole("region", { name: "Ask the Court" });
    await expect(panel.getByRole("button", { name: "Why this pick?" })).toHaveCount(0);
    await panel.getByLabel(/ask about any team-season/i).fill("Best defence of the 1990s?");
    await panel.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(panel.getByText("The 1992–93 Knicks")).toBeVisible();
    expect(sent).toEqual({ question: "Best defence of the 1990s?" });
  });
});

test.describe("with the flag off", () => {
  test("there is no panel, no nav link, and no /ask page", async ({ page }) => {
    const base = `http://localhost:${DAILY_OFF_PORT}`;
    await page.goto(base + MATCHUP);
    await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Ask the Court" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Ask" })).toHaveCount(0);
    await page.goto(base + "/ask");
    await expect(page.getByRole("region", { name: "Ask the Court" })).toHaveCount(0);
  });
});
