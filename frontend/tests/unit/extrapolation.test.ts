import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isExtrapolation } from "../../src/lib/extrapolation";
import type { IndexData } from "../../src/types";

const PLAYOFF = { madePlayoffs: true };
const MISSED = { madePlayoffs: false };
const HIST_V1 = { version: "hist-v1", purpose: "historical_entertainment", nonPlayoffExtrapolation: true };
const HIST_V2 = { version: "hist-v2", purpose: "historical_entertainment", nonPlayoffExtrapolation: false };

describe("isExtrapolation", () => {
  it("is never true for a release trained on every game type (hist-v2)", () => {
    for (const [a, b] of [[PLAYOFF, PLAYOFF], [PLAYOFF, MISSED], [MISSED, PLAYOFF], [MISSED, MISSED]]) {
      expect(isExtrapolation(HIST_V2, a, b)).toBe(false);
    }
  });

  it("flags a non-playoff team under a playoffs-only release (hist-v1)", () => {
    expect(isExtrapolation(HIST_V1, PLAYOFF, PLAYOFF)).toBe(false);
    expect(isExtrapolation(HIST_V1, PLAYOFF, MISSED)).toBe(true);
    expect(isExtrapolation(HIST_V1, MISSED, MISSED)).toBe(true);
  });

  it("treats an export without the flag as hist-v1", () => {
    expect(isExtrapolation({ version: "hist-v1", purpose: "historical_entertainment" }, PLAYOFF, MISSED)).toBe(true);
    expect(isExtrapolation(null, PLAYOFF, MISSED)).toBe(true);
  });

  it("the served export says hist-v2 does not extrapolate", () => {
    const path = fileURLToPath(new URL("../../public/data/index.json", import.meta.url));
    const index = JSON.parse(readFileSync(path, "utf8")) as IndexData;
    expect(index.release).toEqual(HIST_V2);
  });
});
