import { expect, test } from "@playwright/test";

// F03 completion criterion: one 10,000-run 16-team title-odds calculation
// completes comfortably in a desktop browser. Runs the real engine and the
// real exported team files inside Chromium, the way F04 will.

test("16-team title odds, 10,000 runs, completes comfortably in the browser", async ({ page }) => {
  await page.goto("/");

  const measured = await page.evaluate(async () => {
    // Served as ES modules by the Vite dev server. Paths are held in variables
    // so TypeScript does not try to resolve them from the test's own context.
    const enginePath = "/src/tournament/index.ts";
    const loaderPath = "/src/lib/dataLoader.ts";
    const engine = await import(/* @vite-ignore */ enginePath);
    const loader = await import(/* @vite-ignore */ loaderPath);

    const index = await loader.loadIndex();
    // The 16 best team-seasons by net rating: a realistic, competitive field.
    const field: string[] = [...index.teams]
      .sort((a: { netRating: number }, b: { netRating: number }) => b.netRating - a.netRating)
      .slice(0, 16)
      .map((t: { key: string }) => t.key);
    const files = await Promise.all(field.map((key) => loader.loadTeamFile(key)));

    const table = engine.buildMatchupTable(files).value;
    const entrants = engine.seedByStrength(field, table).value;
    const definition = { version: 1, entrants, seed: "benchmark", seriesBestOf: 7 };

    engine.runTitleOdds(definition, table, 1000); // warm-up
    const timings: number[] = [];
    let titleSum = 0;
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const result = engine.runTitleOdds(definition, table, 10_000);
      timings.push(performance.now() - start);
      titleSum = result.value.entrants.reduce((acc: number, e: { titleProbability: number }) => acc + e.titleProbability, 0);
    }
    timings.sort((a, b) => a - b);
    return { median: timings[2], max: timings[4], titleSum, userAgent: navigator.userAgent };
  });

  console.log(
    `title-odds 10,000 x 16 teams: median ${measured.median.toFixed(1)} ms, ` +
      `max ${measured.max.toFixed(1)} ms (${measured.userAgent})`,
  );
  expect(measured.titleSum).toBeCloseTo(1, 9);
  // "Comfortably": well under a second even on the slowest of five runs.
  expect(measured.max).toBeLessThan(500);
});
