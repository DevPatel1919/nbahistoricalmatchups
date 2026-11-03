// The grounding check for Ask the Court (F13): the port of src/rag/grounding.py.
// Every number in an answer must be found in a fact or chunk its sentence
// cites. Numbers are exact decimals (Dec below), as Python's Decimal, so "about
// 7 points" matches 6.9 and 57.4% matches .574 without float error.
// tests/fixtures/rag/worker_parity.json holds real answers and Python's verdicts.

import { DASH } from "./textfmt";

const CITATION = /\[((?:[FC]\d+)(?:\s*[,;]\s*[FC]?\d+)*)\]/g;
const LABEL = /([FC]?)(\d+)/g;
const LEADING_CITE = /^((?:\s*\[(?:[FC]\d+)(?:\s*[,;]\s*[FC]?\d+)*\])+)\s*/;
const STAT_NAMES = /(?<![\w.])(?:three|3|two|2)[- ]point(?:ers?)?\b/gi;
const SPELLED: Record<string, number> = {
  three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

type Kind = "decade" | "season" | "short" | "record" | "percent" | "number" | "spelled";
const PATTERNS: [Kind, RegExp][] = [
  ["decade", /(?<![\w.])'?(\d{4}|\d0)'?s\b/g],
  ["season", /(?<![\w.])(\d{4})\s*-\s*(\d{4}|\d{2})(?!\d)/g],
  ["short", /(?<![\w.])'(\d{2})(?![\d%])/g],
  ["record", /(?<![\w.])(\d{1,3})\s*-\s*(\d{1,3})(?!\d|\.\d|%)/g],
  ["percent", /(?<![\w.])[+-]?(\d+(?:\.\d+)?)\s*(?:%|percent\b|per cent\b)/g],
  ["number", /(?<![\w.])[+-]?(\d+(?:\.\d+)?|\.\d+)(?:st|nd|rd|th)?(?!\w)/g],
  ["spelled", new RegExp("\\b(" + Object.keys(SPELLED).join("|") + ")\\b", "g")],
];

// ---------------------------------------------------------------------------
// Exact decimals
// ---------------------------------------------------------------------------

class Dec {
  readonly unscaled: bigint;
  readonly scale: number;

  constructor(unscaled: bigint, scale: number) {
    this.unscaled = unscaled;
    this.scale = scale;
  }

  static parse(text: string): Dec {
    const dot = text.indexOf(".");
    if (dot < 0) return new Dec(BigInt(text), 0);
    return new Dec(BigInt((text.slice(0, dot) || "0") + text.slice(dot + 1)), text.length - dot - 1);
  }

  static of(n: number): Dec {
    return new Dec(BigInt(n), 0);
  }

  times100(): Dec {
    return new Dec(this.unscaled * 100n, this.scale);
  }

  over100(): Dec {
    return new Dec(this.unscaled, this.scale + 2);
  }

  /** Rounded half up to `places` decimals; values here are never negative. */
  rounded(places: number): Dec {
    if (this.scale <= places) return new Dec(this.unscaled * 10n ** BigInt(places - this.scale), places);
    const divisor = 10n ** BigInt(this.scale - places);
    const quotient = this.unscaled / divisor;
    const remainder = this.unscaled % divisor;
    return new Dec(remainder * 2n >= divisor ? quotient + 1n : quotient, places);
  }

  equals(other: Dec): boolean {
    const scale = Math.max(this.scale, other.scale);
    return (
      this.unscaled * 10n ** BigInt(scale - this.scale) === other.unscaled * 10n ** BigInt(scale - other.scale)
    );
  }

  atMostOne(): boolean {
    return this.unscaled <= 10n ** BigInt(this.scale);
  }

  isInteger(n: number): boolean {
    return this.equals(Dec.of(n));
  }
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

type Num =
  | { kind: "decade"; raw: string }
  | { kind: "season" | "year"; value: number; raw: string }
  | { kind: "record"; wins: number; losses: number; raw: string }
  | { kind: "percent" | "fraction" | "number"; value: Dec; places: number; raw: string };

function normalize(text: string): string {
  return text
    .replace(/−/g, "-")
    .replaceAll(DASH, "-")
    .replace(/—/g, "-")
    .replace(/[’‘]/g, "'")
    .replace(/[  ]/g, " ");
}

function placesOf(digits: string): number {
  const dot = digits.indexOf(".");
  return dot < 0 ? 0 : digits.length - dot - 1;
}

const blank = (m: string) => " ".repeat(m.length);

export function extract(input: string): Num[] {
  const text = normalize(input).replace(CITATION, blank).replace(STAT_NAMES, blank);
  const lower = text.toLowerCase();
  const taken = new Array<boolean>(text.length).fill(false);
  const found: { at: number; num: Num }[] = [];
  for (const [kind, pattern] of PATTERNS) {
    for (const m of (kind === "spelled" ? lower : text).matchAll(pattern)) {
      const start = m.index;
      const end = start + m[0].length;
      if (taken.slice(start, end).some(Boolean)) continue;
      let num: Num | null = null;
      if (kind === "decade") {
        num = { kind: "decade", raw: m[0] };
      } else if (kind === "season") {
        const first = Number(m[1]);
        const second = Number(m[2]);
        if (second === first + 1 || second === (first + 1) % 100) num = { kind: "season", value: first + 1, raw: m[0] };
      } else if (kind === "short") {
        const yy = Number(m[1]);
        num = { kind: "season", value: yy >= 46 ? 1900 + yy : 2000 + yy, raw: m[0] };
      } else if (kind === "record") {
        num = { kind: "record", wins: Number(m[1]), losses: Number(m[2]), raw: m[0] };
      } else if (kind === "percent") {
        num = { kind: "percent", value: Dec.parse(m[1]), places: placesOf(m[1]), raw: m[0] };
      } else if (kind === "number") {
        const digits = m[1];
        const value = Number(digits);
        if (digits.startsWith(".") || digits.startsWith("0.")) {
          num = { kind: "fraction", value: Dec.parse(digits), places: placesOf(digits), raw: m[0] };
        } else if (!digits.includes(".") && value >= 1946 && value <= 2035) {
          num = { kind: "year", value, raw: m[0] };
        } else {
          num = { kind: "number", value: Dec.parse(digits), places: placesOf(digits), raw: m[0] };
        }
      } else {
        num = { kind: "number", value: Dec.of(SPELLED[m[1]]), places: 0, raw: m[0] };
      }
      if (num) {
        found.push({ at: start, num });
        taken.fill(true, start, end);
      }
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.num);
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

class Pool {
  private readonly records = new Set<string>();
  private readonly seasons = new Set<number>();
  private readonly years = new Set<number>();
  private readonly percents: Dec[] = [];
  private readonly fractions: Dec[] = [];
  private readonly values: Dec[] = [];

  static of(texts: string[]): Pool {
    const pool = new Pool();
    for (const text of texts) for (const n of extract(text)) pool.add(n);
    return pool;
  }

  private add(n: Num): void {
    switch (n.kind) {
      case "record":
        this.records.add(n.wins + "-" + n.losses);
        this.values.push(Dec.of(n.wins), Dec.of(n.losses));
        break;
      case "season":
        this.seasons.add(n.value);
        this.years.add(n.value).add(n.value - 1);
        break;
      case "year":
        this.years.add(n.value);
        this.seasons.add(n.value);
        this.values.push(Dec.of(n.value));
        break;
      case "percent":
        this.percents.push(n.value);
        this.fractions.push(n.value.over100());
        this.values.push(n.value);
        break;
      case "fraction":
        this.fractions.push(n.value);
        this.percents.push(n.value.times100());
        this.values.push(n.value);
        break;
      case "number":
        this.values.push(n.value);
        if (n.value.atMostOne()) {
          this.fractions.push(n.value);
          this.percents.push(n.value.times100());
        }
        break;
    }
  }

  supports(n: Num): boolean {
    switch (n.kind) {
      case "decade":
        return true;
      case "record":
        return this.records.has(n.wins + "-" + n.losses);
      case "season":
        return this.seasons.has(n.value) || this.years.has(n.value);
      case "year":
        return this.years.has(n.value) || this.seasons.has(n.value + 1);
      case "percent":
        return this.percents.some((p) => p.rounded(n.places).equals(n.value));
      case "fraction":
        return this.fractions.some((f) => f.rounded(n.places).equals(n.value));
      default:
        return this.values.some((v) => v.rounded(n.places).equals(n.value));
    }
  }
}

function exempt(n: Num, questionPool: Pool): boolean {
  if (n.kind === "decade") return true;
  if (n.kind === "number" && n.places === 0 && (n.value.isInteger(100) || n.value.isInteger(48))) return true;
  return questionPool.supports(n);
}

// ---------------------------------------------------------------------------
// Sentences and the check
// ---------------------------------------------------------------------------

export function labelsIn(text: string): string[] {
  const out: string[] = [];
  for (const group of text.matchAll(CITATION)) {
    let letter = "F";
    for (const m of group[1].matchAll(LABEL)) {
      letter = m[1] || letter;
      const label = letter + m[2];
      if (!out.includes(label)) out.push(label);
    }
  }
  return out;
}

export function sentences(answer: string): string[] {
  const out: string[] = [];
  for (const line of answer.split("\n")) {
    for (let part of line.trim().split(/(?<=[.!?])\s+/)) {
      if (!part) continue;
      const m = LEADING_CITE.exec(part);
      if (m && out.length) {
        out[out.length - 1] = out[out.length - 1] + " " + m[1].trim();
        part = part.slice(m[0].length);
      }
      if (part.trim()) out.push(part.trim());
    }
  }
  return out;
}

export type ProblemKind = "label" | "uncited" | "unsupported";
export type Problem = { index: number; sentence: string; message: string; kind: ProblemKind };
export type Report = { ok: boolean; problems: Problem[]; sentences: string[]; citations: string[]; numbers: number };

export function check(answer: string, sources: Record<string, string>, question = ""): Report {
  const pools = new Map<string, Pool>();
  const questionPool = Pool.of([question]);
  const parts = sentences(answer);
  const problems: Problem[] = [];
  const cited: string[] = [];
  let checked = 0;
  parts.forEach((sentence, index) => {
    const labels = labelsIn(sentence);
    for (const label of labels) if (!cited.includes(label)) cited.push(label);
    for (const label of labels) {
      if (!(label in sources)) {
        problems.push({ index, sentence, message: "cites [" + label + "], which doesn't exist", kind: "label" });
      }
    }
    const claims = extract(sentence).filter((n) => !exempt(n, questionPool));
    checked += claims.length;
    const known = labels.filter((label) => label in sources);
    if (claims.length && !known.length) {
      const raws = claims.map((n) => n.raw.trim()).join(", ");
      problems.push({ index, sentence, message: "has numbers (" + raws + ") but cites no source", kind: "uncited" });
      return;
    }
    for (const label of known) if (!pools.has(label)) pools.set(label, Pool.of([sources[label]]));
    for (const n of claims) {
      if (!known.some((label) => (pools.get(label) as Pool).supports(n))) {
        const names = known.map((label) => "[" + label + "]").join(", ");
        problems.push({ index, sentence, message: "says " + n.raw.trim() + ", which isn't in " + names, kind: "unsupported" });
      }
    }
  });
  return { ok: problems.length === 0, problems, sentences: parts, citations: cited, numbers: checked };
}

function dropLabels(sentence: string, known: Set<string>): string {
  const kept = sentence.replace(CITATION, (m) => {
    const labels = labelsIn(m).filter((label) => known.has(label));
    return labels.length ? "[" + labels.join(", ") + "]" : "";
  });
  return kept.replace(/\s+([.!?])/g, "$1").trim();
}

/** The answer without the sentences that failed, and how many were removed. */
export function stripUnsupported(report: Report, sources: Record<string, string>): { text: string; removed: number } {
  const kinds = new Map<number, Set<ProblemKind>>();
  for (const p of report.problems) {
    if (!kinds.has(p.index)) kinds.set(p.index, new Set());
    (kinds.get(p.index) as Set<ProblemKind>).add(p.kind);
  }
  const kept: string[] = [];
  let removed = 0;
  report.sentences.forEach((sentence, i) => {
    const k = kinds.get(i);
    if (!k) kept.push(sentence);
    else if (k.size === 1 && k.has("label")) kept.push(dropLabels(sentence, new Set(Object.keys(sources))));
    else removed += 1;
  });
  return { text: kept.join(" "), removed };
}

export function feedback(report: Report): string {
  return report.problems.map((p) => '- Sentence "' + p.sentence + '" ' + p.message + ".").join("\n");
}
