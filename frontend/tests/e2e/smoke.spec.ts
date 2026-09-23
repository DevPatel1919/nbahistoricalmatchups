import { expect, test } from "@playwright/test";

// Acceptance checks from docs/frontend-handoff.md, "Step 3: acceptance checks".

test("search a team, pick a second, and see a probability", async ({ page }) => {
  await page.goto("/");

  const searchInput = page.locator(".search-box input");
  await searchInput.fill("98 bulls");
  await page.getByRole("option", { name: /Chicago Bulls/ }).first().click();

  await searchInput.fill("2017 warriors");
  await page.getByRole("option", { name: /Golden State Warriors/ }).first().click();

  await expect(page).toHaveURL(/\/1998-bulls-vs-2017-warriors$/);
  await expect(page.locator(".winner-card__prob")).toContainText("%");
});

test("a share URL loads the same numbers directly", async ({ page }) => {
  await page.goto("/1998-bulls-vs-2017-warriors");

  await expect(page.locator(".winner-card__prob")).toContainText("73.8%");
  await expect(page.locator(".winner-card__margin")).toContainText("wins by 0.6");
  await expect(page.locator(".stat-comparison")).toContainText("62-20");
  await expect(page.locator(".stat-comparison")).toContainText("67-15");

  // Reloading the exact same URL must show the exact same numbers.
  await page.reload();
  await expect(page.locator(".winner-card__prob")).toContainText("73.8%");
  await expect(page.locator(".winner-card__margin")).toContainText("wins by 0.6");
});

test("the reverse-order URL redirects to the canonical URL", async ({ page }) => {
  await page.goto("/2017-warriors-vs-1998-bulls");
  await expect(page).toHaveURL(/\/1998-bulls-vs-2017-warriors$/);
  await expect(page.locator(".winner-card__prob")).toContainText("73.8%");
});

test("theme toggle persists across a reload", async ({ page }) => {
  await page.goto("/");

  const initialTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  expect(initialTheme).toBe("dark");

  await page.getByRole("button", { name: /switch to light theme/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("a non-playoff team shows the missed-playoffs badge", async ({ page }) => {
  await page.goto("/1998-76ers-vs-2017-warriors");
  await expect(page.locator(".team-side__badge")).toContainText("Missed the playoffs");
});

test("A vs B equals B vs A (neutral-site symmetry)", async ({ page }) => {
  // .winner-card__prob counts up on mount, so wait for it to settle (auto-retrying
  // assertion) before reading its text, rather than racing the animation.
  await page.goto("/1998-bulls-vs-2017-warriors");
  await expect(page.locator(".winner-card__prob")).toContainText("73.8%");
  const forward = await page.locator(".winner-card__prob").textContent();

  await page.goto("/2017-warriors-vs-1998-bulls");
  await expect(page.locator(".winner-card__prob")).toContainText("73.8%");
  const reversed = await page.locator(".winner-card__prob").textContent();

  expect(forward).toBe(reversed);
});

test("/about renders without a bare accuracy figure", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByRole("heading", { name: /about court of all time/i })).toBeVisible();
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/\b7\d(\.\d+)?%\s*(accura|accur)/i);
});
