import { describe, expect, it } from "vitest";
import {
  DAILY_THREE_VAR,
  DUEL_BUILD_VARS,
  dailyThreeDefines,
  dailyThreeEnabled,
  duelEnvDefines,
  duelModeAllowed,
} from "../../buildEnv";

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

describe("Daily Three build flag", () => {
  it("is on only for 1 or true", () => {
    for (const value of ["1", "true", "TRUE", " 1 ", "True"]) expect(dailyThreeEnabled(value)).toBe(true);
    for (const value of [undefined, "", "0", "false", "no", "off", "2", "yes"]) expect(dailyThreeEnabled(value)).toBe(false);
  });

  it("hands the app exactly 1 or an empty string", () => {
    const key = "import.meta.env." + DAILY_THREE_VAR;
    expect(dailyThreeDefines({ VITE_DAILY_THREE: "1" })).toEqual({ [key]: JSON.stringify("1") });
    expect(dailyThreeDefines({ VITE_DAILY_THREE: "true" })).toEqual({ [key]: JSON.stringify("1") });
    expect(dailyThreeDefines({ VITE_DAILY_THREE: "0" })).toEqual({ [key]: JSON.stringify("") });
    expect(dailyThreeDefines({})).toEqual({ [key]: JSON.stringify("") });
  });

  it("does not depend on the branch: the Pages environment decides", () => {
    // Preview (PR builds and staging) sets it; production leaves it unset until F12 Session 5.
    for (const branch of ["main", "staging", "f12-s3-page", undefined]) {
      expect(dailyThreeDefines({ CF_PAGES_BRANCH: branch, VITE_DAILY_THREE: "1" })).toEqual({
        ["import.meta.env." + DAILY_THREE_VAR]: JSON.stringify("1"),
      });
    }
  });

  it("leaves the duel gate alone", () => {
    expect(duelEnvDefines({ CF_PAGES_BRANCH: "f12-s3-page", VITE_DAILY_THREE: "1" })).not.toHaveProperty(
      "import.meta.env." + DAILY_THREE_VAR,
    );
  });
});
