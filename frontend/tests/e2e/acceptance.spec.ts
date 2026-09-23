import { expect, test } from "@playwright/test";

// F02 completion criteria that the smoke suite does not cover:
// "The app works at 360px width, by keyboard, and with reduced motion", plus
// the data-loading integration contract ("loads index.json once and a team
// opponent file on demand").

const MATCHUP = "/1998-bulls-vs-2017-warriors";

test.describe("360px width", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("the result page fits without horizontal scroll", async ({ page }) => {
    await page.goto(MATCHUP);
    await expect(page.locator(".winner-card__prob")).toContainText("73.8%");

    // The document must never be wider than the viewport: a horizontal
    // scrollbar at phone width is the failure this criterion guards against.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await expect(page.locator(".stat-comparison")).toBeVisible();
    await expect(page.locator(".series-odds")).toBeVisible();
  });

  test("the home picker is usable at 360px", async ({ page }) => {
    await page.goto("/");
    const input = page.locator(".search-box input").first();
    await expect(input).toBeVisible();

    const box = await input.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(360);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test("a matchup can be built with the keyboard alone", async ({ page }) => {
  await page.goto("/");

  const input = page.locator(".search-box input").first();
  await input.focus();
  await expect(input).toBeFocused();

  // Type, walk the listbox with the arrow keys, commit with Enter -- no mouse.
  await input.pressSequentially("98 bulls");
  await expect(page.getByRole("option").first()).toBeVisible();

  // The highlighted option is reported to assistive tech via aria-activedescendant.
  const activeId = await input.getAttribute("aria-activedescendant");
  expect(activeId).toBeTruthy();
  await expect(page.locator(`#${activeId}`)).toHaveAttribute("aria-selected", "true");

  await input.press("ArrowDown");
  await input.press("ArrowUp");
  await input.press("Enter");

  await input.pressSequentially("2017 warriors");
  await expect(page.getByRole("option").first()).toBeVisible();
  await input.press("Enter");

  await expect(page).toHaveURL(/-vs-/);
  await expect(page.locator(".winner-card__prob")).toContainText("%");
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the win probability skips the count-up and shows its final value", async ({ page }) => {
    await page.goto(MATCHUP);

    // With prefers-reduced-motion the number must HOLD its final value, never
    // animating up from zero. A single immediate read would pass vacuously:
    // CountUpPercent initialises its state to the target before the effect
    // starts animating, so the first paint shows 73.8% either way. Sample
    // repeatedly across the animation window instead and require every frame
    // to be the settled value.
    const prob = page.locator(".winner-card__prob");
    await prob.waitFor({ state: "visible" });

    const samples: string[] = [];
    for (let i = 0; i < 25; i++) {
      samples.push(((await prob.textContent()) ?? "").trim());
      await page.waitForTimeout(40);
    }

    expect(samples.length).toBeGreaterThan(0);
    const deviating = samples.filter((s) => s !== "73.8%");
    expect(deviating, `probability animated under reduced motion: ${samples.join(", ")}`).toEqual([]);
  });
});

test("index.json loads once; a team file only when that team is chosen", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.includes("/data/")) requested.push(url.pathname);
  });

  await page.goto("/");
  await expect(page.locator(".search-box input").first()).toBeVisible();

  const indexHits = () => requested.filter((p) => p.endsWith("index.json")).length;
  const teamHits = () => requested.filter((p) => p.includes("/data/teams/")).length;

  expect(indexHits()).toBe(1);
  // No matchup is on screen yet, so no 30KB team file should have been fetched.
  expect(teamHits()).toBe(0);

  await page.goto(MATCHUP);
  await expect(page.locator(".winner-card__prob")).toContainText("73.8%");

  // Exactly one team file backs a matchup: the pair is stored on one side.
  expect(teamHits()).toBe(1);
  expect(requested.some((p) => p.endsWith("/data/teams/1998-bulls.json"))).toBe(true);
});

test("/about names the served model release and its limitations", async ({ page }) => {
  await page.goto("/about");
  // The tag comes from index.json, which verify_static_export.py pins to the
  // active release, so this line cannot drift from what is actually served.
  await expect(page.locator(".about-release")).toContainText("hist-v1");

  const text = await page.locator("article").innerText();
  expect(text).toMatch(/trained on playoff games only/i);
  expect(text).toMatch(/not betting advice/i);
  expect(text).toMatch(/don't publish\s+an accuracy figure/i);
  expect(text).not.toMatch(/\d+(\.\d+)?%/);
});

test("the margin is rounded, never shown to a decimal", async ({ page }) => {
  await page.goto("/2001-lakers-vs-2008-celtics");
  const margin = page.locator(".winner-card__margin");
  await expect(margin).toContainText(/wins by (about \d+ pts?|under 1 pt)/);
  await expect(margin).not.toContainText(/\d\.\d/);
});

test("team sides use the independent palette, not team colors", async ({ page }) => {
  // F00 has not approved team-associated colors, so both sides must resolve
  // to the site's own --side-a / --side-b accents whatever teams are shown.
  await page.goto("/1998-bulls-vs-2017-warriors");
  await expect(page.locator(".winner-card__prob")).toContainText("%");
  const [barA, barB, sideA, sideB] = await page.evaluate(() => {
    const bars = document.querySelectorAll<HTMLElement>(".team-side__bar");
    const probe = document.createElement("div");
    document.body.appendChild(probe);
    const resolve = (v: string) => {
      probe.style.background = `var(${v})`;
      return getComputedStyle(probe).backgroundColor;
    };
    return [
      getComputedStyle(bars[0]).backgroundColor,
      getComputedStyle(bars[1]).backgroundColor,
      resolve("--side-a"),
      resolve("--side-b"),
    ];
  });
  expect(barA).toBe(sideA);
  expect(barB).toBe(sideB);
});
