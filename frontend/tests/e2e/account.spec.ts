import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { DUEL_API_PORT } from "../../playwright.config";

// F09 Session 5: optional accounts against the local Worker. The Worker runs
// with its localhost-only doubles (an email outbox and Turnstile's dummy
// token); the browser gets a stand-in for Turnstile's script.

type LoggedEvent = { name: string; [key: string]: unknown };
const API = `http://localhost:${DUEL_API_PORT}`;
const TURNSTILE = "https://challenges.cloudflare.com/**";

/** Replaces Turnstile's script with one that renders a box and returns `token`. */
async function stubTurnstile(page: Page, token = "XXXX.DUMMY.TOKEN.XXXX") {
  await page.route(TURNSTILE, (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.turnstile = {
        render(el, o) {
          const box = document.createElement("div");
          box.textContent = "Verification (test stand-in)";
          box.style.cssText = "width:300px;height:65px;border:1px solid #888;display:grid;place-items:center";
          el.appendChild(box);
          setTimeout(() => o.callback(${JSON.stringify(token)}), 0);
          return "w" + Math.random();
        },
        remove() {},
      };`,
    }),
  );
}

const freshEmail = () => `e2e.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;

async function linkFor(request: APIRequestContext, email: string): Promise<string> {
  const r = await request.get(`${API}/v1/dev/outbox?to=${encodeURIComponent(email)}`);
  expect(r.ok()).toBe(true);
  const { text } = (await r.json()) as { text: string };
  const url = /(http\S+\/account\/verify#token=ml_[A-Za-z0-9_-]+)/.exec(text)?.[1];
  expect(url).toBeTruthy();
  return new URL(url as string).pathname + new URL(url as string).hash;
}

async function requestLink(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  const send = page.getByRole("button", { name: "Email me a sign-in link" });
  await expect(send).toBeEnabled();
  await send.click();
}

function events(page: Page): Promise<LoggedEvent[]> {
  return page.evaluate(() => (window as unknown as { __ctAnalytics: LoggedEvent[] }).__ctAnalytics);
}

async function playQuickSet(page: Page): Promise<string> {
  await page.goto("/duel");
  await page.getByRole("radio", { name: /Solo/ }).check();
  await page.getByRole("button", { name: "Start a set" }).click();
  for (let i = 1; i <= 5; i++) {
    await expect(page.getByRole("heading", { name: `Game ${i} of 5` })).toBeVisible();
    await page.getByRole("group", { name: "Who won?" }).getByRole("button").first().click();
    await page.getByRole("radio", { name: /Lean/ }).check();
    await page.getByRole("button", { name: i === 5 ? "Review picks" : "Next game" }).click();
  }
  await page.getByRole("button", { name: "Lock in picks" }).click();
  await expect(page.getByTestId("model-benchmark")).toBeVisible();
  return new URL(page.url()).pathname;
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("360px account flow", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("a guest signs in by magic link, keeps their history, names themselves, and signs out", async ({ page, request }) => {
    await stubTurnstile(page);
    const duelPath = await playQuickSet(page);

    await page.goto("/duel");
    await expect(page.locator(".duel__account")).toContainText("Playing as a guest");
    await page.locator(".duel__account").getByRole("link", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByText("An account is optional")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const email = freshEmail();
    await requestLink(page, email);
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const link = await linkFor(request, email);
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
    // The link token never stays in the address bar.
    expect(page.url()).not.toContain("token");
    await expect(page.getByText("now count for this account")).toBeVisible();
    await expect(page.locator(".account__checklist")).toContainText("1 of 10");
    await expect(page.locator(".account__checklist")).toContainText("Choose a display name");
    await expectNoHorizontalOverflow(page);
    expect((await events(page)).filter((e) => e.name === "account_signed_in")).toEqual([
      { name: "account_signed_in", mergedGuest: true },
    ]);
    // The welcome is shown once; a reload does not repeat it.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
    await expect(page.getByText("now count for this account")).toHaveCount(0);

    const name = "E2E " + Math.random().toString(36).slice(2, 8);
    await page.getByLabel("Display name").fill("Admin");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByRole("alert")).toContainText("isn't allowed");
    await page.getByLabel("Display name").fill(name);
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    await expect(page.locator(".account__checklist")).toContainText("Display name chosen");
    await page.getByLabel("Display name").fill(name + "x");
    await page.getByRole("button", { name: "Change name" }).click();
    await expect(page.getByLabel("Display name")).toBeDisabled();
    await expect(page.getByText(/You can change it again on/)).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // The set played as a guest now reloads for the account.
    await page.goto(duelPath);
    await expect(page.getByTestId("model-benchmark")).toBeVisible();
    await page.goto("/duel");
    await expect(page.locator(".duel__account")).toContainText("You're signed in");

    // The link was single-use.
    await page.goto(link);
    await expect(page.getByRole("alert")).toContainText("expired or was already used");

    await page.goto("/account");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    // Guest play still works after signing out.
    await playQuickSet(page);
  });
});

test("a failed human check is reported and the widget is reset", async ({ page }) => {
  await stubTurnstile(page, "not-the-dummy-token");
  await page.goto("/account");
  await requestLink(page, freshEmail());
  await expect(page.getByRole("alert")).toContainText("verification check didn't pass");
  await expect(page.locator(".turnstile")).toHaveCount(1);
  const errors = (await events(page)).filter((e) => e.name === "app_error");
  expect(errors).toEqual([{ name: "app_error", surface: "account-link", code: "human_check_failed" }]);
});

test("a verify page without a token explains what to do", async ({ page }) => {
  await page.goto("/account/verify");
  await expect(page.getByRole("alert")).toContainText("Request a new one");
  await expect(page.getByRole("link", { name: "keep playing as a guest" })).toBeVisible();
});

test("Turnstile loads only on the sign-in form, and duel play needs no account", async ({ page }) => {
  const turnstileHits: string[] = [];
  page.on("request", (r) => {
    if (r.url().startsWith("https://challenges.cloudflare.com")) turnstileHits.push(r.url());
  });
  await stubTurnstile(page);
  await page.goto("/");
  await page.goto("/tournament");
  await playQuickSet(page);
  expect(turnstileHits).toEqual([]);
  await page.goto("/account");
  await expect(page.locator(".turnstile")).toContainText("Verification");
  expect(turnstileHits).toHaveLength(1);
});
