// Anti-abuse detection rules (F09 Session 7), as pure functions over rows the
// sweep reads from D1 (integrity.ts). Every rule produces findings for human
// review. None of them bans, blocks play, or touches a rating: an open flag
// only keeps an account off the leaderboard until a reviewer decides.
//
// Thresholds are owner-tunable constants. The false-positive rates quoted here
// are checked in test/integrity.test.ts.

import { CONFIDENCE_LEVELS, type Confidence } from "../../frontend/src/duel";

export type FlagKind =
  | "accuracy_ceiling"
  | "scripted_timing"
  | "win_trading"
  | "repeat_pair"
  | "forfeit_feeding"
  | "feeder_ring"
  | "linked_accounts"
  | "multi_account";

export type Finding = {
  accountId: string;
  kind: FlagKind;
  /** The other account for a pair finding, else "". */
  related: string;
  evidence: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Lookup control (owner decision, 2026-09-24): sustained accuracy above the
// honest ceiling. The model itself calls 69.5% of the ranked pool, so the rule
// asks whether accuracy is *significantly* above ~68%, not whether one hot
// streak crossed it.
// ---------------------------------------------------------------------------

/** The honest ceiling (owner decision): about the pre-game model's accuracy. */
export const ACCURACY_CEILING = 0.68;
/** No judgement on fewer rated picks than this (ten sets). */
export const ACCURACY_MIN_PICKS = 50;
/** The most recent rated sets considered (250 picks). */
export const ACCURACY_WINDOW_SETS = 50;
/** One-sided 99.9% confidence: a model-level player is flagged well under 1% of the time. */
export const ACCURACY_Z = 3.09;

/** Lower end of the Wilson score interval for a binomial proportion. */
export function wilsonLowerBound(successes: number, trials: number, z = ACCURACY_Z): number {
  if (trials <= 0) return 0;
  const p = successes / trials;
  const z2 = z * z;
  const centre = p + z2 / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
  return (centre - margin) / (1 + z2 / trials);
}

export type SetMetrics = {
  submittedAt: number;
  msToSubmit: number;
  picks: number;
  correct: number;
  lockPicks: number;
  lockCorrect: number;
};

/** Flags when the lower confidence bound on recent rated accuracy is above the ceiling. `sets` newest first. */
export function accuracyFinding(accountId: string, sets: readonly SetMetrics[]): Finding | null {
  const recent = sets.slice(0, ACCURACY_WINDOW_SETS);
  const picks = recent.reduce((n, s) => n + s.picks, 0);
  const correct = recent.reduce((n, s) => n + s.correct, 0);
  if (picks < ACCURACY_MIN_PICKS) return null;
  const lowerBound = wilsonLowerBound(correct, picks);
  if (lowerBound <= ACCURACY_CEILING) return null;
  const lockPicks = recent.reduce((n, s) => n + s.lockPicks, 0);
  const lockCorrect = recent.reduce((n, s) => n + s.lockCorrect, 0);
  return {
    accountId,
    kind: "accuracy_ceiling",
    related: "",
    evidence: {
      sets: recent.length,
      picks,
      correct,
      accuracy: round3(correct / picks),
      lowerBound: round3(lowerBound),
      ceiling: ACCURACY_CEILING,
      lockPicks,
      lockCorrect,
    },
  };
}

// ---------------------------------------------------------------------------
// Scripted submission: a set token stops replay, but not a script that reads
// five stat tables and answers in seconds. Humans take far longer.
// ---------------------------------------------------------------------------

/** Rated sets considered for timing. */
export const TIMING_WINDOW_SETS = 10;
/** No judgement on fewer sets than this. */
export const TIMING_MIN_SETS = 5;
/** Median time from issue to lock-in below this, for five games, is not human reading. */
export const TIMING_FAST_MS = 20_000;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** `sets` newest first. */
export function timingFinding(accountId: string, sets: readonly SetMetrics[]): Finding | null {
  const recent = sets.slice(0, TIMING_WINDOW_SETS);
  if (recent.length < TIMING_MIN_SETS) return null;
  const times = recent.map((s) => s.msToSubmit);
  const medianMs = median(times);
  if (medianMs >= TIMING_FAST_MS) return null;
  return {
    accountId,
    kind: "scripted_timing",
    related: "",
    evidence: { sets: recent.length, medianMs: Math.round(medianMs), fastestMs: Math.min(...times), thresholdMs: TIMING_FAST_MS },
  };
}

/** Shannon entropy (bits) of a set's confidence mix: 0 when one tier, log2(3) when evenly spread. */
export function confidenceEntropy(confidences: readonly Confidence[]): number {
  if (confidences.length === 0) return 0;
  let bits = 0;
  for (const tier of CONFIDENCE_LEVELS) {
    const p = confidences.filter((c) => c === tier).length / confidences.length;
    if (p > 0) bits -= p * Math.log2(p);
  }
  return Math.round(bits * 1e4) / 1e4;
}

// ---------------------------------------------------------------------------
// Collusion and win-trading, from the rated pairing graph (match_seats and
// match_resolutions). The matchmaker already refuses a pair twice in 24 hours,
// so repeat meetings inside the window are rare for honest players.
// ---------------------------------------------------------------------------

/** Rated matches considered. */
export const COLLUSION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** A pair meeting this often in the window is flagged, whoever wins. */
export const PAIR_REPEAT_MAX = 6;
/** A pair this one-sided over at least PAIR_ONE_SIDED_MIN meetings is flagged. */
export const PAIR_ONE_SIDED_MIN = 4;
export const PAIR_ONE_SIDED_SHARE = 0.75;
/** One account forfeiting to the same opponent this often is flagged. */
export const FORFEIT_FEED_MIN = 2;
/** A feeder: most of its rated matches are losses to one account. */
export const FEEDER_MIN_MATCHES = 2;
export const FEEDER_TARGET_SHARE = 0.6;
export const FEEDER_LOSS_SHARE = 0.75;
/** An account fed by this many feeders is a ring. */
export const RING_MIN_FEEDERS = 2;

/** One rated match between two accounts. */
export type RatedMatch = {
  matchId: string;
  creator: string;
  opponent: string;
  outcome: "creator" | "opponent" | "draw";
  settledBy: "both-locked" | "forfeit";
  resolvedAt: number;
};

/**
 * When a key was last decided by a reviewer: detectors judge only activity
 * after it, so a cleared flag comes back only on new evidence.
 */
export type SinceFn = (accountId: string, kind: FlagKind, related: string) => number;

function winnerOf(m: RatedMatch): string | null {
  return m.outcome === "draw" ? null : m.outcome === "creator" ? m.creator : m.opponent;
}

/** An unordered pair of accounts as one key. */
export function pairKey(a: string, b: string): string {
  return a < b ? a + "|" + b : b + "|" + a;
}

function pairStats(rows: readonly RatedMatch[], x: string, y: string) {
  let winsX = 0;
  let winsY = 0;
  let forfeitsByX = 0;
  let forfeitsByY = 0;
  for (const m of rows) {
    const w = winnerOf(m);
    if (w === x) winsX++;
    if (w === y) winsY++;
    // A forfeit is always the opponent seat failing to lock in.
    if (m.settledBy === "forfeit") {
      if (m.opponent === x) forfeitsByX++;
      else forfeitsByY++;
    }
  }
  return { matches: rows.length, winsX, winsY, draws: rows.length - winsX - winsY, forfeitsByX, forfeitsByY };
}

function after(rows: readonly RatedMatch[], since: number): RatedMatch[] {
  return rows.filter((m) => m.resolvedAt > since);
}

/** Pair and ring findings over the rated matches in the window. `linked` holds pairKey()s of linked accounts. */
export function collusionFindings(matches: readonly RatedMatch[], linked: ReadonlySet<string>, since: SinceFn): Finding[] {
  const findings: Finding[] = [];
  const byPair = new Map<string, RatedMatch[]>();
  for (const m of matches) {
    const key = pairKey(m.creator, m.opponent);
    const list = byPair.get(key);
    if (list) list.push(m);
    else byPair.set(key, [m]);
  }

  // Both accounts of a pair get the finding; each is judged on activity after its own last review.
  const both = (x: string, y: string, kind: FlagKind, rows: readonly RatedMatch[], test: (s: ReturnType<typeof pairStats>) => boolean, evidence: (s: ReturnType<typeof pairStats>) => Record<string, unknown>) => {
    for (const [self, other] of [[x, y], [y, x]] as const) {
      const s = pairStats(after(rows, since(self, kind, other)), self, other);
      if (test(s)) findings.push({ accountId: self, kind, related: other, evidence: evidence(s) });
    }
  };

  for (const [key, rows] of byPair) {
    const [x, y] = key.split("|");
    both(x, y, "repeat_pair", rows, (s) => s.matches >= PAIR_REPEAT_MAX, (s) => ({ matches: s.matches, windowDays: 30 }));
    both(
      x,
      y,
      "win_trading",
      rows,
      (s) => s.matches >= PAIR_ONE_SIDED_MIN && Math.max(s.winsX, s.winsY) / s.matches >= PAIR_ONE_SIDED_SHARE,
      (s) => ({ matches: s.matches, wins: s.winsX, losses: s.winsY, draws: s.draws }),
    );
    both(
      x,
      y,
      "forfeit_feeding",
      rows,
      (s) => s.forfeitsByX >= FORFEIT_FEED_MIN || s.forfeitsByY >= FORFEIT_FEED_MIN,
      (s) => ({ matches: s.matches, forfeitsGiven: s.forfeitsByX, forfeitsReceived: s.forfeitsByY }),
    );
    if (linked.has(key)) {
      both(x, y, "linked_accounts", rows, (s) => s.matches >= 1, (s) => ({ matches: s.matches, link: "created on the same network the same day" }));
    }
  }

  findings.push(...ringFindings(matches, since));
  return findings;
}

/**
 * A ring: several accounts whose rated play is mostly losing to one account,
 * the usual shape of alts feeding a main. Each alt can stay under the pair
 * thresholds; the concentration is what gives it away.
 */
function ringFindings(matches: readonly RatedMatch[], since: SinceFn): Finding[] {
  const involving = new Map<string, RatedMatch[]>();
  for (const m of matches) {
    for (const who of [m.creator, m.opponent]) {
      const list = involving.get(who);
      if (list) list.push(m);
      else involving.set(who, [m]);
    }
  }
  const findings: Finding[] = [];
  // Candidate ring centres: judged on matches after their own last review.
  const centres = new Set<string>();
  for (const m of matches) {
    const w = winnerOf(m);
    if (w) centres.add(w);
  }
  for (const centre of centres) {
    const cutoff = since(centre, "feeder_ring", "");
    const feeders: { account: string; matches: number; losses: number; total: number }[] = [];
    for (const [account, rows] of involving) {
      if (account === centre) continue;
      const own = after(rows, cutoff);
      const vs = own.filter((m) => m.creator === centre || m.opponent === centre);
      const losses = vs.filter((m) => winnerOf(m) === centre).length;
      if (own.length >= FEEDER_MIN_MATCHES && vs.length >= FEEDER_MIN_MATCHES &&
        vs.length / own.length >= FEEDER_TARGET_SHARE && losses / vs.length >= FEEDER_LOSS_SHARE) {
        feeders.push({ account, matches: vs.length, losses, total: own.length });
      }
    }
    if (feeders.length < RING_MIN_FEEDERS) continue;
    findings.push({
      accountId: centre,
      kind: "feeder_ring",
      related: "",
      evidence: { feeders: feeders.length, winsFromFeeders: feeders.reduce((n, f) => n + f.losses, 0), feederAccounts: feeders.map((f) => f.account) },
    });
    for (const f of feeders) {
      // A feeder cleared against this centre comes back only after a newer loss to it.
      const lastLoss = Math.max(...(involving.get(f.account) ?? []).filter((m) => winnerOf(m) === centre).map((m) => m.resolvedAt));
      if (lastLoss <= since(f.account, "feeder_ring", centre)) continue;
      findings.push({
        accountId: f.account,
        kind: "feeder_ring",
        related: centre,
        evidence: { matchesAgainst: f.matches, lossesTo: f.losses, ratedMatches: f.total },
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Multi-account velocity: accounts created from one network on one day. The
// hard limit is 3 per network per day (ratelimit.ts); reaching it is flagged.
// Fewer only links the accounts, which matters if they later meet in ranked.
// ---------------------------------------------------------------------------

export const MULTI_ACCOUNT_FLAG_AT = 3;

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

