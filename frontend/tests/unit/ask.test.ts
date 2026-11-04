import { describe, expect, it } from "vitest";
import { askCourtDefines, askCourtEnabled } from "../../buildEnv";
import { askErrorMessage, parseSse, splitCitations } from "../../src/lib/askApi";

// F13 Session 6: Ask the Court in the browser. Reading the event stream in
// whatever pieces it arrives, splitting citations out of an answer, the flag.

describe("parseSse", () => {
  it("reads complete events and keeps the rest", () => {
    const { events, rest } = parseSse('event: meta\ndata: {"a":1}\n\nevent: token\ndata: {"te');
    expect(events).toEqual([{ event: "meta", data: { a: 1 } }]);
    expect(rest).toBe('event: token\ndata: {"te');
  });

  it("gets the same events however the stream is cut", () => {
    const stream = 'event: meta\ndata: {"sources":[]}\n\nevent: token\ndata: {"text":"Hi \\u2013 there [F1]."}\n\nevent: done\ndata: {"grounded":true}\n\n';
    const whole = parseSse(stream).events;
    expect(whole.map((e) => e.event)).toEqual(["meta", "token", "done"]);
    for (let cut = 1; cut < stream.length; cut++) {
      const first = parseSse(stream.slice(0, cut));
      const second = parseSse(first.rest + stream.slice(cut));
      expect([...first.events, ...second.events]).toEqual(whole);
    }
  });

  it("ignores an empty buffer", () => {
    expect(parseSse("")).toEqual({ events: [], rest: "" });
  });
});

describe("splitCitations", () => {
  it("separates text and citations", () => {
    expect(splitCitations("They won 72 games [F1]. Pace was slow [C2].")).toEqual([
      { text: "They won 72 games " },
      { labels: ["F1"] },
      { text: ". Pace was slow " },
      { labels: ["C2"] },
      { text: "." },
    ]);
  });

  it("expands grouped labels, keeping the letter before a bare number", () => {
    expect(splitCitations("[F1, C2]")).toEqual([{ labels: ["F1", "C2"] }]);
    expect(splitCitations("[F1, 2; C3]")).toEqual([{ labels: ["F1", "F2", "C3"] }]);
  });

  it("leaves other brackets alone", () => {
    expect(splitCitations("See [note] and [12].")).toEqual([{ text: "See [note] and [12]." }]);
  });

  it("handles an answer with no citations", () => {
    expect(splitCitations("Sorry, I can't help with that.")).toEqual([{ text: "Sorry, I can't help with that." }]);
  });
});

describe("error messages", () => {
  it("gives every code a message and points to what still works", () => {
    expect(askErrorMessage("ask_budget")).toContain("tomorrow");
    expect(askErrorMessage("ask_budget")).toContain("suggested questions");
    expect(askErrorMessage("rate_limited")).toContain("minute");
    expect(askErrorMessage("network")).toContain("Everything else");
    expect(askErrorMessage("anything else")).toContain("Everything else");
  });
});

describe("build flag", () => {
  it("is on only for 1 or true", () => {
    expect(askCourtEnabled("1")).toBe(true);
    expect(askCourtEnabled(" TRUE ")).toBe(true);
    for (const value of [undefined, "", "0", "false", "yes"]) expect(askCourtEnabled(value)).toBe(false);
  });

  it("hands the app exactly 1 or nothing", () => {
    expect(askCourtDefines({ VITE_ASK_COURT: "true" })).toEqual({ "import.meta.env.VITE_ASK_COURT": '"1"' });
    expect(askCourtDefines({})).toEqual({ "import.meta.env.VITE_ASK_COURT": '""' });
  });
});
