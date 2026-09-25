// Anti-abuse enforcement (F09 Session 7): anomaly metrics for rated play, the
// scheduled detection sweep, and flag storage. The rules themselves are pure
// functions in integrity-rules.ts.
//
// Flags never auto-ban. An account with an open flag keeps playing, ranking,
// and moving its rating; it is only left off the leaderboard until a reviewer
// clears it (admin.ts). An upheld flag keeps it off. A cleared flag is judged
// again only on activity after the review, so a false positive is not raised
// again on the same evidence.

import type { DuelResult, Pick } from "../../frontend/src/duel";
import type { Env } from "./env";
import {
  ACCURACY_WINDOW_SETS,
  COLLUSION_WINDOW_MS,
  MULTI_ACCOUNT_FLAG_AT,
  accuracyFinding,
  collusionFindings,
  confidenceEntropy,
  pairKey,
  timingFinding,
  type FlagKind,
  type Finding,
  type RatedMatch,
  type SetMetrics,
  type SinceFn,
} from "./integrity-rules";
import type { StoredPuzzle } from "./pool";
import { randomId } from "./tokens";

/** Accounts with rated play this recent are re-checked by each sweep. */
export const SWEEP_LOOKBACK_MS = 24 * 60 * 60 * 1000;
/** Expired sign-in links and sessions are deleted this long after they stop working. */
export const PURGE_GRACE_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Anomaly metrics, written with every rated submission
// ---------------------------------------------------------------------------

/** The per-set anomaly row for a ranked seat. It joins the submission's D1 batch. */
export function metricsStatement(
  env: Env,
  duelId: string,
  participant: string,
  accountId: string,
  now: number,
  msToSubmit: number,
  picks: readonly Pick[],
  stored: readonly StoredPuzzle[],
  result: DuelResult,
): D1PreparedStatement {
  const scored = result.you.picks;
  const count = (tier: Pick["confidence"]) => picks.filter((p) => p.confidence === tier).length;
  const lockCorrect = scored.filter((s, i) => s.correct && picks[i].confidence === "lock").length;
  const modelAgree = picks.filter((p, i) => (stored[i].answer.modelHomeWinProbability >= 0.5 ? "home" : "away") === p.side).length;
  return env.DB.prepare(
    `INSERT INTO play_metrics (duel_id, participant, account_id, submitted_at, ms_to_submit, picks, correct, lock_picks, lock_correct,
       confident_picks, lean_picks, model_agree, confidence_entropy, points, model_points)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    duelId,
    participant,
    accountId,
    now,
    msToSubmit,
    picks.length,
    scored.filter((s) => s.correct).length,
    count("lock"),
    lockCorrect,
    count("confident"),
    count("lean"),
    modelAgree,
    confidenceEntropy(picks.map((p) => p.confidence)),
    result.you.total,
    result.model.total,
  );
}

// ---------------------------------------------------------------------------
// Flag storage
// ---------------------------------------------------------------------------

type ReviewRow = { account_id: string; kind: FlagKind; related: string; status: "cleared" | "upheld"; reviewed_at: number };

function flagKey(accountId: string, kind: FlagKind, related: string): string {
  return accountId + "|" + kind + "|" + related;
}

/**
 * The latest review decision for every flag key (optionally only for some
 * accounts). Activity at or before a cleared review is not judged again; an
 * upheld key is not judged again at all (it is already off the board).
 */
export async function reviewState(env: Env, accountIds?: readonly string[]): Promise<SinceFn> {
  const base =
    `SELECT f.account_id, f.kind, f.related, f.status, f.reviewed_at FROM integrity_flags f
     WHERE f.reviewed_at IS NOT NULL AND f.reviewed_at = (
       SELECT MAX(g.reviewed_at) FROM integrity_flags g WHERE g.account_id = f.account_id AND g.kind = f.kind AND g.related = f.related)`;
  const rows = accountIds
    ? accountIds.length === 0
      ? []
      : (await env.DB.prepare(base + " AND f.account_id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(accountIds)).all<ReviewRow>()).results
    : (await env.DB.prepare(base).all<ReviewRow>()).results;
  const since = new Map<string, number>();
  for (const r of rows) since.set(flagKey(r.account_id, r.kind, r.related), r.status === "upheld" ? Number.POSITIVE_INFINITY : r.reviewed_at);
  return (accountId, kind, related) => since.get(flagKey(accountId, kind, related)) ?? 0;
}

/**
 * Opens a flag per finding, or refreshes the evidence on the one already open.
 * At most one open flag per (account, kind, related) is the partial unique
 * index; two sweeps racing both land on the same row.
 */
export async function raiseFlags(env: Env, findings: readonly Finding[], now: number): Promise<number> {
  if (findings.length === 0) return 0;
  const statements = findings.map((f) =>
    env.DB.prepare(
      `INSERT INTO integrity_flags (id, account_id, kind, related, status, evidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?)
       ON CONFLICT (account_id, kind, related) WHERE status = 'open'
       DO UPDATE SET evidence = excluded.evidence, updated_at = excluded.updated_at`,
    ).bind(randomId("f"), f.accountId, f.kind, f.related, JSON.stringify(f.evidence), now, now),
  );
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
  return findings.length;
}

/** True while an open or upheld flag keeps the account off the leaderboard. */
export async function hiddenFromBoard(env: Env, accountId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 FROM integrity_flags WHERE account_id = ? AND status IN ('open', 'upheld') LIMIT 1")
    .bind(accountId)
    .first();
  return row !== null;
}

// ---------------------------------------------------------------------------
// The sweep (scheduled with the match settler; also POST /v1/admin/sweep)
// ---------------------------------------------------------------------------

type MetricsRow = {
  submitted_at: number;
  ms_to_submit: number;
  picks: number;
  correct: number;
  lock_picks: number;
  lock_correct: number;
};

function toSetMetrics(r: MetricsRow): SetMetrics {
  return {
    submittedAt: r.submitted_at,
    msToSubmit: r.ms_to_submit,
    picks: r.picks,
    correct: r.correct,
    lockPicks: r.lock_picks,
    lockCorrect: r.lock_correct,
  };
}

/** Accuracy-ceiling and scripted-timing findings for every account with recent rated play. */
async function playerFindings(env: Env, since: SinceFn, now: number, lookbackMs: number): Promise<Finding[]> {
  const active = await env.DB.prepare("SELECT DISTINCT account_id FROM play_metrics WHERE submitted_at > ?")
    .bind(now - lookbackMs)
    .all<{ account_id: string }>();
  const findings: Finding[] = [];
  for (const { account_id: accountId } of active.results) {
    const sinceAccuracy = since(accountId, "accuracy_ceiling", "");
    const sinceTiming = since(accountId, "scripted_timing", "");
    const from = Math.min(sinceAccuracy, sinceTiming);
    if (!Number.isFinite(from)) continue;
    const rows = await env.DB.prepare(
      `SELECT submitted_at, ms_to_submit, picks, correct, lock_picks, lock_correct FROM play_metrics
       WHERE account_id = ? AND submitted_at > ? ORDER BY submitted_at DESC LIMIT ?`,
    )
      .bind(accountId, from, ACCURACY_WINDOW_SETS)
      .all<MetricsRow>();
    const sets = rows.results.map(toSetMetrics);
    const accuracy = accuracyFinding(accountId, sets.filter((s) => s.submittedAt > sinceAccuracy));
    const timing = timingFinding(accountId, sets.filter((s) => s.submittedAt > sinceTiming));
    if (accuracy) findings.push(accuracy);
    if (timing) findings.push(timing);
  }
  return findings;
}

type MatchRowOut = { match_id: string; creator: string; opponent: string; outcome: RatedMatch["outcome"]; settled_by: RatedMatch["settledBy"]; resolved_at: number };

/** Pair and ring findings over the last COLLUSION_WINDOW_MS of rated matches. */
async function pairFindings(env: Env, since: SinceFn, now: number): Promise<Finding[]> {
  const from = now - COLLUSION_WINDOW_MS;
  const [rows, links] = await Promise.all([
    env.DB.prepare(
      `SELECT r.match_id, substr(c.participant, 3) AS creator, substr(o.participant, 3) AS opponent, r.outcome, r.settled_by, r.resolved_at
       FROM match_resolutions r
       JOIN match_seats c ON c.match_id = r.match_id AND c.seat = 'creator'
       JOIN match_seats o ON o.match_id = r.match_id AND o.seat = 'opponent'
       WHERE r.rated = 1 AND r.resolved_at > ?`,
    )
      .bind(from)
      .all<MatchRowOut>(),
    // Only linked pairs that actually met in a rated match matter.
    env.DB.prepare(
      `SELECT DISTINCT l.account_id, l.linked_id FROM account_links l
       JOIN match_seats a ON a.participant = 'a:' || l.account_id
       JOIN match_seats b ON b.match_id = a.match_id AND b.participant = 'a:' || l.linked_id
       JOIN match_resolutions r ON r.match_id = a.match_id AND r.rated = 1 AND r.resolved_at > ?`,
    )
      .bind(from)
      .all<{ account_id: string; linked_id: string }>(),
  ]);
  const matches: RatedMatch[] = rows.results.map((r) => ({
    matchId: r.match_id,
    creator: r.creator,
    opponent: r.opponent,
    outcome: r.outcome,
    settledBy: r.settled_by,
    resolvedAt: r.resolved_at,
  }));
  const linked = new Set(links.results.map((l) => pairKey(l.account_id, l.linked_id)));
  return collusionFindings(matches, linked, since);
}

export type SweepReport = { findings: number; purged: number };

/** One pass of every detector, then the housekeeping purge. Safe to run any number of times. */
export async function runIntegritySweep(env: Env, now: number, lookbackMs = SWEEP_LOOKBACK_MS): Promise<SweepReport> {
  const since = await reviewState(env);
  const findings = [...(await playerFindings(env, since, now, lookbackMs)), ...(await pairFindings(env, since, now))];
  await raiseFlags(env, findings, now);
  return { findings: findings.length, purged: await purgeExpired(env, now) };
}

/** Deletes sign-in links and sessions that stopped working more than PURGE_GRACE_MS ago. */
export async function purgeExpired(env: Env, now: number): Promise<number> {
  const cutoff = now - PURGE_GRACE_MS;
  const results = await env.DB.batch([
    // An expired link is refused on its expiry alone, so its redemption row is no longer needed.
    env.DB.prepare("DELETE FROM magic_link_redemptions WHERE token_hash IN (SELECT token_hash FROM magic_links WHERE expires_at < ?)").bind(cutoff),
    env.DB.prepare("DELETE FROM magic_links WHERE expires_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)").bind(cutoff, cutoff),
  ]);
  return results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Multi-account velocity, recorded when an account is created
// ---------------------------------------------------------------------------

/**
 * Notes a new account against the network (keyed IP hash) it was created
 * from. The network key lives only in a KV entry that expires after two days.
 * Accounts sharing one are linked in D1; reaching the per-network daily
 * maximum flags them all. KV is eventually consistent, so this is a signal,
 * not a guarantee; the hard limit is the rate limit in accounts.ts.
 */
export async function recordCreationNetwork(env: Env, networkKey: string, accountId: string, now: number): Promise<void> {
  const key = "sig:net:" + networkKey + ":" + Math.floor(now / DAY_MS);
  const earlier = ((await env.RATE_LIMITS.get(key, { type: "json" })) as string[] | null) ?? [];
  if (earlier.includes(accountId)) return;
  const accounts = [...earlier, accountId].slice(-20);
  await env.RATE_LIMITS.put(key, JSON.stringify(accounts), { expirationTtl: 2 * 86400 });
  if (earlier.length === 0) return;
  await env.DB.batch(
    earlier.map((other) =>
      env.DB.prepare("INSERT OR IGNORE INTO account_links (account_id, linked_id, reason, created_at) VALUES (?, ?, 'creation-network', ?)")
        .bind(other < accountId ? other : accountId, other < accountId ? accountId : other, now),
    ),
  );
  if (accounts.length < MULTI_ACCOUNT_FLAG_AT) return;
  const since = await reviewState(env, accounts);
  await raiseFlags(
    env,
    accounts
      // An account already reviewed for this is not flagged again for the same burst.
      .filter((id) => since(id, "multi_account", "") === 0)
      .map((id) => ({ accountId: id, kind: "multi_account" as const, related: "", evidence: { accountsFromNetworkToday: accounts.length } })),
    now,
  );
}
