# F09: Duel mode (forecasting game and ranked ladder)

Status: **accepted, not started**. Owner decisions recorded 2026-09-22.

This brief is implemented over multiple sessions. Each session in the session
plan is independently assignable, ends in a verifiable state, and has its own
kickoff prompt. Do not start a session whose dependencies are unmet.

## Outcome

A player is shown a real, completed NBA game with its identity stripped and
only pre-tip information visible. They pick a winner and a confidence level.
Scoring is a proper scoring rule, so honest confidence is the optimal strategy.
The same picks are made by an opponent — another player, or a skill-matched
practice bot — and by the shipped pre-game model, which appears on every result
screen as a fixed benchmark.

This is the first surface in the product that requires server state.

## Why this is defensible

Cross-era matchups have no ground truth; a real completed game does. Scoring
players against fact rather than against model output keeps the product inside
the model-integrity gate, and produces genuine calibration data for the player
and for us. The pre-game model is a strong opponent — 67.6% accuracy, 0.2075
Brier, calibrated across every band (`models/pregame/pregame_metrics.json`).

## Owner decisions

| Decision | Value |
|---|---|
| Truth source | Real completed games; model is a benchmark, never the answer key |
| Account required to play | No — solo sim, bot duels, and friend duels are open to guests |
| Account required for leaderboard | Yes — ranked play and rating require a verified account |
| Game selection | Differs by mode; see "Puzzle selection policy" |
| Competition scope | Regular season **and** playoffs |
| Era scope | All available seasons (1998–2026) |
| Scoring | Confidence tiers scored by Brier skill score |
| Fill-in opponent | Skill-matched practice bot, disclosed as such |
| Anti-cheat posture | Hardened. The ladder must not reward cheaters |

### Open assumption to confirm with the owner

"The games are chosen random but one can pick per era so there are 2 matchup
combos" is implemented as **two draw modes**: `random` (any era) and
`era` (random within one selected era bucket). If the owner meant something
else — for example one entrant drawn from each of two eras — amend this section
before Session 1 and adjust the pool generator accordingly.

## Modes

| Mode | Account | Opponent | Rated | Era filter |
|---|---|---|---|---|
| Solo sim | No | none | No | Yes |
| Bot duel | No | practice bot | No | Yes |
| Friend duel | No | invite link | No | Challenger picks, locked for both |
| Ranked duel | **Yes** | matchmade human, bot fallback is unrated | **Yes** | No — server draws |

Era choice is withheld from ranked because a self-selected era is a difficulty
lever, and a difficulty lever on a rated ladder is a farming vector.

## Puzzle selection policy

The two modes are solving different problems, so they draw differently. Both
policies use **pre-game information only**. Selecting on the actual result —
for example favouring games the favourite lost — leaks the answer into the
selection and is forbidden, however entertaining the puzzles would be.

### Unranked (solo sim and bot duels): fixed composition

Each five-puzzle set is drawn to a fixed confidence profile rather than
uniformly:

| Slot | Model probability band | Purpose |
|---|---|---|
| 1 | 0.80 – 0.95 | Tests whether the player sizes a genuine lock correctly |
| 2 | 0.60 – 0.80 | Ordinary favourites; rewards reading form and availability |
| 2 | 0.40 – 0.60 | True toss-ups; punishes overconfidence |

Uniform sampling clusters sets at the extremes, where every player picks the
same side and scores converge. The profile guarantees each set contains both
lock-sizing opportunities and genuine uncertainty. Bands are computed from the
model's pre-game probability, which is itself pre-game information, so the
policy stays outcome-blind.

### Ranked (human versus human): signal divergence

A rated duel decided by coin flips is rating noise, not competition. Ranked sets
are drawn to favour games that are **decidable from real statistics but not
obvious**, so the better forecaster wins more often than chance.

A candidate qualifies when both hold:

- **Real signal exists.** The model's probability is meaningfully away from even,
  `|p − 0.5| ≥ 0.10`. Pure toss-ups are excluded from ranked.
- **The obvious read is not the whole story.** At least one naive heuristic —
  pick the home team, or pick the better win-loss record — disagrees with the
  model, or the two heuristics disagree with each other.

Those are the games where a player who reads rest, recent form, and missing
rotation strength diverges from a player who reads the standings. That divergence
is the skill the ladder is supposed to measure.

Honest limit: this lowers variance, it does not remove it. A 20% underdog still
wins one game in five, and a lost Lock still swings a duel. Elo with K = 24 over
five-puzzle duels is what absorbs that; individual duels remain noisy and the UI
must not imply otherwise.

## The practice bot must not be presented as the model

The fill-in opponent is correct at a rate sampled from the player's own recent
accuracy. It is a rubber-banded bot that is told the answer and then decides how
often to use it. It is **not** a prediction and must never be labelled as the
model, or as any kind of forecast.

Required treatment:

- Display name "Sparring Partner", with a persistent one-line disclosure:
  *skill-matched practice opponent, not a model prediction*.
- Bot results never move rating and never enter the leaderboard.
- The real model's picks and score appear separately on every result screen,
  for every mode, as an unchanging benchmark line.

Violating any of the three breaks the model-integrity gate in
`docs/product/HANDOFF.md`.

## Core concepts

```ts
type EraKey = "1998-2004" | "2005-2011" | "2012-2016" | "2017-2021" | "2022-2026";
type Confidence = "lean" | "confident" | "lock";   // 0.55 | 0.70 | 0.90
type DrawMode = { kind: "random" } | { kind: "era"; era: EraKey };

/** What a client may see before locking in. Carries no answer. */
type PuzzleView = {
  puzzleId: string;
  era: EraKey;
  isPlayoffGame: boolean;          // round and series game number withheld
  home: TeamSnapshot;
  away: TeamSnapshot;
};

type TeamSnapshot = {
  city: string;                    // era-correct, from index.json conventions
  name: string;
  winsEntering: number;
  lossesEntering: number;
  restDays: number;
  backToBack: boolean;
  last10NetRating: number;
  last10WinPct: number;
  missingRotationStrength: number; // derived from missing_rotation_gmsc30
};

type Pick = { puzzleId: string; side: "home" | "away"; confidence: Confidence };

/** Server-side only. Never serialized to a client before lock. */
type PuzzleAnswer = {
  puzzleId: string;
  actualWinner: "home" | "away";
  modelHomeWinProbability: number;
};
```

## Scoring

Confidence maps to a probability; the pick is scored by Brier skill score
against a 0.5 baseline, expressed in points:

```text
points = round(100 * (1 - brier / 0.25))     where brier = (p_assigned_to_actual_winner - 1)^2
```

| Tier | p | Correct | Wrong |
|---|---|---|---|
| Lean | 0.55 | +19 | −21 |
| Confident | 0.70 | +64 | −96 |
| Lock | 0.90 | +96 | −224 |

The rule is strictly proper: a player maximizes expected points by choosing the
tier closest to their true belief. The model is scored by the identical formula
using its continuous probability, so the benchmark is directly comparable.

A duel is five puzzles. Higher total wins. Tie is broken by the higher-scoring
single correct call; if still level, the duel is a draw.

## Rating

- Elo, start 1200, K = 24, provisional K = 40 for a player's first 10 rated duels.
- Only human-vs-human ranked duels move rating.
- Rating decays only through inactivity policy if one is later adopted; do not
  implement decay in this brief.

## Abuse model

The ladder is the asset being attacked. Threats, in priority order, with the
control each session must deliver.

| Threat | Control |
|---|---|
| Looking up the real game | De-identified puzzles: no date, final score, attendance, arena, officials, playoff round, or series game number. Reject pool candidates whose entering-record pairing is unique enough to be searchable. |
| Reading the answer from the client | Answers and model probabilities never leave the Worker before lock. No answer in any pre-lock payload, cache, or error message. |
| Score tampering | Client submits picks only. All scoring, comparison, and rating server-side. |
| Replayed or scripted submission | Puzzle set issued with a signed short-TTL token bound to account/guest id and duel id. Submissions without a matching issued token are rejected. |
| Double submission | One submission per duel per participant, enforced by a D1 unique constraint plus an idempotency key — not by application logic alone. |
| Multi-accounting and smurfing | Turnstile on account creation, IP and ASN velocity limits, ranked eligibility only after a minimum number of completed duels. |
| Collusion and win-trading | Repeat-pairing frequency and win-graph anomaly detection. Flag for review; never auto-ban. |
| Automated spam and load | Per-IP and per-account token buckets in KV, WAF rate limits, edge-cached puzzle payloads with per-player tokens issued from a separate uncached endpoint. |
| Impersonation on the board | Display-name moderation, rate-limited renames, reserved-name list. |
| Undetectable cheating | Instrument time-to-submit, per-tier accuracy, and confidence entropy from the first session that records results. A baseline cannot be reconstructed retroactively. |

### Pool partitioning

The sim pool and the ranked pool must be **disjoint partitions of the generated
pool**. Any puzzle whose answer has ever been served to a client is permanently
ineligible for ranked. This is a generator-level guarantee, not a runtime check.

## Architecture

- Offline: `scripts/generate_duel_pool.py` builds the pool from
  `data/raw/Games.csv`, `data/processed/pregame_team_features.csv`, and the
  pre-game bundle in `models/pregame/`. Output is split into public display
  records and private answer records.
- Cloudflare Worker under `worker/`. D1 for accounts, duels, picks, ratings, and
  flags. KV for the pool and rate-limit buckets. Turnstile for account creation.
- The existing static site and cross-era matchup explorer remain unchanged and
  keep working with no backend.
- All scored play — including guest play — is served by the Worker. Guests get a
  signed guest token; they simply cannot enter ranked or the leaderboard.

## Session plan

Each session must end with its acceptance checks passing and this brief's
handoff record updated.

### Session 1 — Pool generator (offline, no server)

Build `scripts/generate_duel_pool.py`. Join games to pre-game features, compute
each team's record entering the game, attach the model's probability and the
actual winner, de-identify per the abuse model, assign era buckets, and emit
disjoint `sim` and `ranked` partitions as separate artifacts. Report pool size
per era, playoff share, and model accuracy within the pool.

Each puzzle also carries the selection metadata both policies need: its model
confidence band, the home-team heuristic pick, the better-record heuristic pick,
and a boolean for whether either heuristic diverges from the model. These are
pre-game facts and belong in the private artifact alongside the answer, so that
selection can run server-side without exposing anything.

**Pool quality gates.** Simulate archetype players across the pool — always-home,
always-better-record, model-follower, form-chaser, and random — and report each
one's accuracy and mean points. These are falsification tests, not statistics to
admire:

- If always-home scores near the model, there is no room for skill and the
  format needs rework before any server is built.
- If always-better-record ≈ the model, the model adds nothing a fan could do by
  eye, and the benchmark line would be dishonest.
- The gap between the naive baselines and the model is the space a player
  competes in. Report it explicitly and say whether it is wide enough.

Report these separately for the unranked composition profile and for the ranked
signal-divergence filter, since the whole claim of the ranked policy is that it
widens that gap.

Accept when: every emitted display record is free of withheld fields; answers
and selection metadata exist only in the private artifact; partitions are
provably disjoint; model probability for a sample of pool games matches a live
model call; both selection policies can be satisfied from the pool for every era
bucket; the archetype gates above are reported with a plain verdict.

> Kickoff: Implement F09 Session 1. Read `CONTRIBUTING.md`,
> `docs/product/HANDOFF.md`, and this brief. Build only the offline pool
> generator and its tests. Introduce no server code and no frontend changes.
> Record pool statistics in the handoff record below.

### Session 2 — Scoring and duel domain logic (pure TypeScript)

Implement Brier-skill scoring, duel resolution and tie-breaks, Elo updates, and
the practice-bot draw as pure functions taking an injected RNG and the truth.
No network, no storage, no React.

Accept when: scoring matches the published table exactly at every tier; property
tests confirm the rule is proper (honest tier maximizes expected points); Elo is
zero-sum and symmetric; the bot's realized accuracy converges to its target over
a large sample; all functions are deterministic under a fixed seed.

> Kickoff: Implement F09 Session 2. Build pure, exhaustively tested TypeScript
> domain logic for scoring, duel resolution, Elo, and the skill-matched bot
> draw. Depend on nothing outside the type definitions in this brief.

### Session 3 — Worker foundation and guest play

Stand up the Worker, D1 schema, and KV pool loading. Implement puzzle issuance
with signed short-TTL tokens, lock/submit, server-side scoring, and result
reveal, for guests only. No accounts, no ranked, no leaderboard.

Accept when: no pre-lock response contains an answer or model probability under
any code path including errors; a submission without a matching issued token is
rejected; double submission is blocked by a database constraint; token TTL
expiry is enforced; rate limits return the correct status and are covered by
tests.

> Kickoff: Implement F09 Session 3. Build the Worker, D1 schema, and guest play
> loop. Treat the abuse model in this brief as acceptance criteria, not
> aspiration. Do not implement accounts, rating, or the leaderboard.

### Session 4 — Play surface

Frontend routes for solo sim and bot duel, including era selection for unranked
play, the confidence control, the result reveal with the model benchmark line,
and the bot disclosure. Anonymous, no account prompt.

Accept when: the loop is playable end to end against the Worker; no answer is
present in any client payload before lock; the bot disclosure and model
benchmark are visible on every result; existing routes and tests are unaffected.

> Kickoff: Implement F09 Session 4. Build the guest-playable duel surface
> against the Session 3 Worker. Extend the existing frontend rather than
> replacing it; it is user-owned work.

### Session 5 — Accounts

Email magic-link accounts with Turnstile, session handling, display names with
moderation, and ranked eligibility rules. Guests keep full access to unranked
modes and can upgrade without losing local history.

Accept when: account creation is rate-limited and Turnstile-gated; magic links
are single-use and short-lived; display names pass the moderation and reserved
list rules; a guest upgrading to an account retains their unranked history; no
ranked access before the eligibility threshold.

> Kickoff: Implement F09 Session 5. Add accounts and ranked eligibility. Session
> security and rate limiting are acceptance criteria. Do not implement
> matchmaking or the leaderboard.

### Session 6 — Ranked duels and matchmaking

Async matchmaking queue, invite-link friend duels, bot fallback for empty
queues, duel resolution, and Elo updates. Both participants receive an identical
puzzle set; neither sees the other's picks before both have locked.

Accept when: both participants provably receive the same set; no path reveals an
opponent's picks pre-lock; abandoned duels resolve by a documented timeout rule;
bot fallback is unrated and disclosed; Elo changes are zero-sum and auditable.

> Kickoff: Implement F09 Session 6. Build async ranked duels, matchmaking, and
> Elo application. Bot fallback must remain unrated and clearly disclosed.

### Session 7 — Leaderboard and anti-abuse enforcement

Leaderboard with daily and rolling-30-day boards, anomaly instrumentation,
collusion detection, multi-account velocity controls, flag storage, and an
internal review queue. Flags never auto-ban.

Accept when: every control in the abuse model is implemented or explicitly
deferred with a reason recorded here; anomaly metrics are recorded for all rated
play; a synthetic collusion ring and a synthetic scripted-submission run are both
detected in tests; the board excludes flagged accounts pending review.

> Kickoff: Implement F09 Session 7. Build the leaderboard and the anti-abuse
> controls in this brief's abuse model. Prefer flagging and review over
> automated punishment.

### Session 8 — Hardening and release gate

Load and abuse testing, cost review, privacy review of stored identifiers,
final copy review against the integrity and brand gates, and decision-log
updates in `docs/product/HANDOFF.md`.

Accept when: load test results and costs are recorded; stored identifiers are
justified and minimized; all product copy passes the integrity and brand gates;
the handoff decision log records the move into server state.

> Kickoff: Implement F09 Session 8. Harden, load-test, and complete the release
> gates. Record evidence in this brief and update the decision log in
> `docs/product/HANDOFF.md`.

## Explicitly out of scope

Live real-time duels with WebSockets or Durable Objects, wagering of any kind
including virtual currency staking, cash entry, prizes, player-level simulation,
invented statistics, and redistribution of the underlying game database.

## Handoff record

Each session appends: what shipped, where it lives, interface changes, test and
verification commands, measured numbers, and anything the next session must know.
