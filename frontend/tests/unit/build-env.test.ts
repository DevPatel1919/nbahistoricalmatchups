import { describe, expect, it } from "vitest";
import { DUEL_BUILD_VARS, duelEnvDefines, duelModeAllowed } from "../../buildEnv";

describe("duel build gate", () => {
  it("keeps duel mode on production, staging, and local builds", () => {
    expect(duelModeAllowed("main")).toBe(true);
    expect(duelModeAllowed("staging")).toBe(true);
    expect(duelModeAllowed(undefined)).toBe(true);
    expect(duelModeAllowed("")).toBe(true);
  });

  it("turns duel mode off on every other Pages branch", () => {
    for (const branch of ["deploy-p2-staging", "staging-2", "Main", "main-fix", "f10-usability"]) {
      expect(duelModeAllowed(branch)).toBe(false);
    }
  });

  it("blanks both duel variables on a PR preview, whatever the environment sets", () => {
    const defines = duelEnvDefines({
      CF_PAGES_BRANCH: "f10-usability",
      VITE_DUEL_API: "https://api-staging.courtofalltime.win",
      VITE_TURNSTILE_SITE_KEY: "0x4AAA",
    });
    expect(Object.keys(defines).sort()).toEqual(DUEL_BUILD_VARS.map((n) => "import.meta.env." + n).sort());
    for (const value of Object.values(defines)) expect(JSON.parse(value)).toBe("");
  });

  it("defines nothing where duel mode is allowed", () => {
    expect(duelEnvDefines({ CF_PAGES_BRANCH: "staging", VITE_DUEL_API: "https://api-staging.courtofalltime.win" })).toEqual({});
    expect(duelEnvDefines({ CF_PAGES_BRANCH: "main" })).toEqual({});
    expect(duelEnvDefines({})).toEqual({});
  });
});
