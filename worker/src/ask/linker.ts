// Entity linking for Ask the Court (F13): the port of src/rag/linker.py. Finds
// the team-seasons, seasons and decades a question is about. Both must pass
// tests/fixtures/rag/linker.json and the questions in worker_parity.json.

export type IndexTeam = { key: string; season: number; city: string; name: string };

export type Link = {
  keys: string[];
  seasons: number[];
  range: [number, number] | null;
  franchises: string[];
  unresolved: string[];
};

const MIN_SEASON = 1986;
const MAX_SEASON = 2026;

const NICKNAME_ALIASES: Record<string, string> = {
  sixers: "76ers",
  blazers: "trail blazers",
  sonics: "supersonics",
  cavs: "cavaliers",
  mavs: "mavericks",
  wolves: "timberwolves",
  "t-wolves": "timberwolves",
  dubs: "warriors",
  pels: "pelicans",
  grizz: "grizzlies",
};

const DECADES: Record<number, [number, number]> = {
  1980: [1986, 1989],
  1990: [1990, 1999],
  2000: [2000, 2009],
  2010: [2010, 2019],
  2020: [2020, 2026],
};
const DECADE_WORDS: Record<string, number> = { eighties: 1980, nineties: 1990 };

const OPEN_RANGE = /\b(since|after|before)\s+(?:the\s+)?$/;
const BRIDGE_BEFORE = new Set(["the", "season", "seasons"]);
const BRIDGE_AFTER = new Set(["of", "in", "from", "the", "season", "during"]);
const NO_WORDS = new Set<string>();

type Year = { start: number; end: number; season: number; twoDigit: boolean };

export function expandTwoDigit(token: string): number | null {
  const n = Number(token);
  for (const year of [1900 + n, 2000 + n]) {
    if (year >= MIN_SEASON && year <= MAX_SEASON) return year;
  }
  return null;
}

export function normalizeQuestion(text: string): string {
  return text.toLowerCase().replace(/[’‘`]/g, "'").replace(/[–—]/g, "-");
}

function words(text: string): string[] {
  return text.match(/[a-z]+/g) ?? [];
}

function findYears(text: string): Year[] {
  const found: Year[] = [];
  const taken: [number, number][] = [];
  const free = (s: number, e: number) => taken.every(([a, b]) => e <= a || s >= b);
  const add = (start: number, end: number, season: number, twoDigit: boolean) => {
    found.push({ start, end, season, twoDigit });
    taken.push([start, end]);
  };

  // 1995-96, 1995-1996, 95-96
  for (const m of text.matchAll(/(?<![\d'])'?(\d{2}|\d{4})\s*-\s*(\d{2}|\d{4})(?!\d)/g)) {
    const startYear = m[1].length === 4 ? Number(m[1]) : expandTwoDigit(m[1]);
    if (startYear === null) continue;
    const endYear = startYear + 1;
    const second = Number(m[2]);
    if (second !== endYear && second !== endYear % 100) continue;
    if (endYear >= MIN_SEASON && endYear <= MAX_SEASON) add(m.index, m.index + m[0].length, endYear, false);
  }
  // 1996
  for (const m of text.matchAll(/(?<![\d'])(\d{4})(?!\d|s\b|'s)/g)) {
    const year = Number(m[1]);
    if (year >= MIN_SEASON && year <= MAX_SEASON && free(m.index, m.index + m[0].length)) {
      add(m.index, m.index + m[0].length, year, false);
    }
  }
  // '96 (apostrophe) and 96 (bare, only usable right next to a nickname)
  for (const m of text.matchAll(/(?<!\d)('?)(\d{2})(?!\d|s\b|'s|%)/g)) {
    const year = expandTwoDigit(m[2]);
    if (year !== null && free(m.index, m.index + m[0].length)) {
      add(m.index, m.index + m[0].length, year, m[1] !== "'");
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

function findDecade(text: string): [number, number] | null {
  const m = /(?<!\d)'?(\d{2}|\d{4})'?s\b/.exec(text);
  if (m) {
    const value = Number(m[1]);
    const decade = m[1].length === 4 ? value : value >= 80 ? 1900 + value : 2000 + value;
    if (DECADES[decade]) return DECADES[decade];
  }
  for (const [word, decade] of Object.entries(DECADE_WORDS)) {
    if (new RegExp("\\b" + word + "\\b").test(text)) return DECADES[decade];
  }
  return null;
}

export class Linker {
  private readonly byNameSeason = new Map<string, string>();
  private readonly display = new Map<string, string>();
  private readonly cityWords = new Map<string, Set<string>>();
  private readonly namePattern: RegExp;

  constructor(teams: IndexTeam[]) {
    for (const t of teams) {
      const name = t.name.toLowerCase();
      this.byNameSeason.set(name + "|" + t.season, t.key);
      this.display.set(name, t.name);
      const city = this.cityWords.get(name) ?? new Set<string>();
      for (const word of words(t.city.toLowerCase())) city.add(word);
      this.cityWords.set(name, city);
    }
    const spellings = [...new Set([...this.display.keys(), ...Object.keys(NICKNAME_ALIASES)])].sort(
      (a, b) => b.length - a.length || (a < b ? -1 : 1),
    );
    const escaped = spellings.map((s) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&"));
    this.namePattern = new RegExp("(?<![a-z0-9])(" + escaped.join("|") + ")(?![a-z])", "g");
  }

  private bridgeOk(gap: string, allowed: Set<string>, name: string | null): boolean {
    if (/[^a-z\s,']/.test(gap)) return false;
    const city = name ? (this.cityWords.get(name) ?? NO_WORDS) : NO_WORDS;
    const list = words(gap);
    return list.length <= 4 && list.every((w) => allowed.has(w) || city.has(w));
  }

  link(question: string): Link {
    const text = normalizeQuestion(question);
    const years = findYears(text);
    const used = new Set<number>();
    const result: Link = { keys: [], seasons: [], range: null, franchises: [], unresolved: [] };

    for (const m of text.matchAll(this.namePattern)) {
      const spelled = m[1];
      const name = NICKNAME_ALIASES[spelled] ?? spelled;
      const start = m.index;
      const end = m.index + m[0].length;
      let bound: number | null = null;

      // The nearest unused year before the nickname. A bare "96" may only be followed by city words.
      const before = years.flatMap((y, i) => (!used.has(i) && y.end <= start ? [i] : []));
      if (before.length) {
        const i = before[before.length - 1];
        const allowed = years[i].twoDigit ? NO_WORDS : BRIDGE_BEFORE;
        if (this.bridgeOk(text.slice(years[i].end, start), allowed, name)) bound = i;
      }
      // Else the nearest unused year after it.
      if (bound === null) {
        const after = years.flatMap((y, i) => (!used.has(i) && y.start >= end ? [i] : []));
        if (after.length) {
          const i = after[0];
          const gap = text.slice(end, years[i].start);
          const ok = years[i].twoDigit ? !gap.trim() : this.bridgeOk(gap, BRIDGE_AFTER, null);
          if (ok) bound = i;
        }
      }
      if (bound === null) {
        const label = this.display.get(name) as string;
        if (!result.franchises.includes(label)) result.franchises.push(label);
        continue;
      }
      used.add(bound);
      const season = years[bound].season;
      const key = this.byNameSeason.get(name + "|" + season);
      if (key === undefined) result.unresolved.push(this.display.get(name) + " " + season);
      else if (!result.keys.includes(key)) result.keys.push(key);
    }

    // Franchises later given a year elsewhere are not ambiguous.
    const linked = new Set(result.keys.map((k) => k.slice(k.indexOf("-") + 1)));
    result.franchises = result.franchises.filter((f) => !linked.has(f.toLowerCase().replace(" ", "-")));

    const free = years.filter((y, i) => !used.has(i) && !y.twoDigit);
    const ranges: [number, number][] = [];
    for (const y of free) {
      const open = OPEN_RANGE.exec(text.slice(0, y.start));
      if (open) {
        if (open[1] === "since") ranges.push([y.season, MAX_SEASON]);
        else if (open[1] === "after") ranges.push([y.season + 1, MAX_SEASON]);
        else ranges.push([MIN_SEASON, y.season - 1]);
      }
    }
    const seasons = free.filter((y) => !OPEN_RANGE.test(text.slice(0, y.start))).map((y) => y.season);
    result.seasons = [...new Set(seasons)].sort((a, b) => a - b);
    result.range = ranges.length ? ranges[0] : findDecade(text);
    return result;
  }
}
