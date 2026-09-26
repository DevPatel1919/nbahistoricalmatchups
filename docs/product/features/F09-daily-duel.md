# F09: Duel mode (forecasting game and ranked ladder)

Status: **Sessions 1–7 complete (guest play, optional accounts, ranked duels with matchmaking and Elo, friend duels by invite link, and the leaderboard with anti-abuse flagging and a review queue); Session 8 not started.** The owner decisions that blocked ranked play were recorded on 2026-09-24 (see "Owner decisions"). Owner decisions first recorded 2026-09-22.

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
| Draw modes (confirmed 2026-09-24) | Two: `random` (any era) and `era` (random within one chosen era bucket) |
| Lookup control (decided 2026-09-24) | De-identification cannot stop a scripted join against the public dataset (Session 1 finding 1). Instead, flag sustained accuracy above the honest ceiling (~68%) for review. Never auto-ban. Enforcement is Session 7; `searchK` stays stored per puzzle |
| Ranked puzzle reuse (decided 2026-09-24) | Limited reuse replaces strict single use. A ranked puzzle is never issued to an account that has already been shown it, and not again to anyone until 30 days after its answer was last revealed. Sim and ranked stay disjoint partitions |

"The games are chosen random but one can pick per era so there are 2 matchup
combos" was implemented as two draw modes, and the owner confirmed that reading
on 2026-09-24.

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

Where each control stands after Session 7, including the two parts that are
deferred and why, is in the Session 7 handoff record ("Abuse model: control
status").

| Threat | Control |
|---|---|
| Looking up the real game | De-identified puzzles: no date, final score, attendance, arena, officials, playoff round, or series game number. A scripted join against the public dataset remains possible (Session 1 finding), so sustained accuracy above the honest ceiling (~68%) is flagged for review (owner decision, 2026-09-24). |
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
pool**. That is a generator-level guarantee, not a runtime check: no sim answer
can ever reach ranked.

Within ranked, reuse is limited (owner decision, 2026-09-24, replacing strict
single use, which capped ranked at about 1,332 duels). A ranked puzzle is never
issued to an account that has already been shown it. It is also not issued to
anyone until 30 days after its answer was last revealed. Both rules run at draw
time from D1 (`ranked_exposures`, `served_answers.last_served_at`).

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

### 2026-09-23 — Session 1: pool generator

**Shipped.** `scripts/generate_duel_pool.py` (tests: `tests/test_duel_pool.py`).
Candidates are regular-season and playoff rows of
`data/processed/matchup_training_data.csv` (the rows the pre-game model saw)
where both teams have played at least 10 games and every display field is
known. The winner comes from `data/raw/Games.csv` and must agree with the
training label for every game, or the script fails. Model probability comes
from `models/pregame/pregame_model.pkl`. For playoff games,
`winsEntering`/`lossesEntering` are the final regular-season record, since a
playoff record would expose the series game number.

**Artifacts** (`data/processed/duel_pool/`, gitignored, Worker-only):
`{sim,ranked}_public.json` (`{version, puzzles: PuzzleView[]}`) and
`{sim,ranked}_private.json` (`{version, answers: PrivateAnswer[]}`).
A private answer holds `puzzleId, gameId, season, partition, actualWinner,
modelHomeWinProbability, modelInSample, band, homePick, betterRecordPick,
heuristicDiverges, rankedEligible, searchK`. Puzzle ids are
`pz_` + 16 hex of HMAC-SHA256(`DUEL_POOL_SALT`, gameId), so they carry no date
or game number. **Owner:** set a long random `DUEL_POOL_SALT` in `.env` before
generating the production pool. Aggregate statistics are committed in
`reports/duel_pool_report.json`.

**Partitioning.** Every candidate lands in exactly one partition. Ranked-eligible
candidates (`|p − 0.5| ≥ 0.10` and a heuristic divergence) go to ranked with
probability 0.8 from a keyed hash; everything else is sim. Sim therefore never
holds an answer that ranked can serve, and the reverse.

**Pool numbers** (pool `duel-pool-v1`, local salt):

| | Candidates | Sim | Ranked | Playoff share | Model accuracy |
|---|---|---|---|---|---|
| 1998-2004 | 6,711 | 5,322 | 1,389 | 7.8% | 69.2% |
| 2005-2011 | 8,088 | 6,352 | 1,736 | 7.3% | 69.0% |
| 2012-2016 | 5,548 | 4,340 | 1,208 | 7.7% | 68.9% |
| 2017-2021 | 5,459 | 4,222 | 1,237 | 7.4% | 66.7% |
| 2022-2026 | 4,583 | 3,491 | 1,092 | 7.3% | 68.2% |
| **All** | **30,389** | **23,727** | **6,662** | **7.5%** | |

The shipped model was fit on seasons ≤ 2021, so its probabilities there are
in-sample: 68.5% accuracy / 0.201 Brier in-sample versus 68.2% / 0.206 on
2022–2026. The optimism is small, but the result screen must say the model was
trained on games up to 2021 (`modelInSample` is in the private record).
Every era can fill every unranked band (smallest: 836 lock-band sim puzzles
in 2022-2026) and has at least 1,092 ranked puzzles.

**Archetype gates** (20,000 simulated five-puzzle sets per policy; naive
archetypes scored at their *best* fixed tier, the most generous reading):

| Archetype | Unranked acc. | Unranked pts/puzzle | Ranked acc. | Ranked pts/puzzle |
|---|---|---|---|---|
| always-home | 63.2% | 5.2 | 40.8% | −4.7 |
| always-better-record | 65.1% | 8.2 | 58.9% | 2.6 |
| form-chaser | 61.3% | 3.5 | 63.9% | 6.2 |
| random | 49.5% | −1.2 | 50.2% | −0.9 |
| model-follower (nearest tier) | 67.2% | 17.1 | 69.5% | 16.0 |
| model (continuous benchmark) | 67.2% | 17.9 | 69.5% | 17.7 |

Model-follower wins 66.4% of five-puzzle duels against the best naive archetype
in unranked (always-better-record) and 61.7% in ranked (form-chaser).

**Verdict: the format passes.** Always-home is nowhere near the model
(−11.9 pts/puzzle unranked, −20.7 ranked). Always-better-record comes within
2.1 accuracy points of the model on the unranked profile, but scores less than
half the model's points, because the model sizes its confidence and a fixed
tier cannot. The benchmark line is honest. The ranked filter does what it
claims for accuracy: the gap to the best naive archetype widens from 2.1 to
5.7 points, and to 13.4 pts/puzzle against always-better-record. It also makes
recent form a better naive read than the standings, which is the skill the
brief wants the ladder to measure. The gap is moderate: a model-level player
loses about 38% of ranked duels to a pure form-chaser, so individual duels
stay noisy, as the brief says.

**Findings that block ranked play (Sessions 6–7), recorded for the owner:**

1. *Lookup de-identification is infeasible as written.* The abuse model says to
   reject candidates whose entering-record pairing is searchable. Against the
   public Kaggle dataset, the era, game type, and both entering records alone
   identify the game uniquely for 88.5% of candidates (median k = 1; k ≥ 5 for
   1.7%). Dropping team names does not help. Tested coarsenings (win% to 5–10
   points, net rating to 2.5–5, rest capped at 3, missing-rotation bucketed)
   reach k ≥ 5 for 0% of games, because about 10 displayed fields cover a
   space far larger than 33k games. Applying the rule would empty the pool. No
   dates, names-to-date mapping, or scores are shown, so casual searching is
   impractical. A scripted join against the dataset is not prevented. The
   workable control is statistical: honest play cannot sustain much above the
   model's ~68% accuracy, so sustained performance above that ceiling is flagged
   for review. `searchK` is stored per puzzle so a later policy can use it.
2. *Ranked capacity.* "Any puzzle whose answer has ever been served is
   permanently ineligible for ranked" makes ranked puzzles single-use. 6,662
   ranked puzzles is 1,332 ranked duels in total, growing by about 250 a
   season. Raising `RANKED_SHARE` to 1.0 gives about 1,660 duels.

**Point-in-time.** `src/models/test_pregame_leakage.py` now also recomputes
`form10_win_pct`, `rest_days`, and `back_to_back` (all shown to players) from
raw files. It exits 0 on 350 games. The one tolerance: a team's first game may
have no feature row, so an unknown `back_to_back` there is not counted as a
mismatch.

**Displayed rest is calendar days (found in Session 3).** `rest_days` in the
matchup data floors the elapsed time between tip-offs. A back-to-back whose
second game tips earlier in the day therefore reads as 0 days and
`back_to_back = 0`. That is 1,374 home rows (4%), and a 1-day flag can also hide
a 2-calendar-day gap. The generator therefore computes `restDays` from the
calendar dates of each team's strictly earlier games in
`TeamStatisticsExtended.csv`, and `backToBack` is `restDays == 1`.
`test_displayed_rest_uses_only_earlier_games` recomputes 150 sampled puzzles
from raw files. **Owner / model follow-up:** the pre-game model was trained on
the floored version. Fixing `build_pregame_features.py` means retraining and
re-checking the model, which F09 does not own. The model's inputs, and so
every benchmark probability, are unchanged.

**Verification.** `python scripts/generate_duel_pool.py` (about 8 s);
`python -m pytest tests/test_duel_pool.py` passes 17 tests: the points table,
era mapping, keyed opaque ids, winner cross-check, calendar-day rest, result-blind selection
metadata, band bounds, disjoint partitions, whitelisted public fields, no
answer or model value in any public artifact, both policies satisfiable per
era, and 200 sampled probabilities matching a live `predict_proba` call
(max diff < 1e-5). `python src/models/test_pregame_leakage.py` exits 0.

### 2026-09-23 — Session 2: domain logic

**Shipped.** `frontend/src/duel/` (pure TypeScript, imported by the Worker and
the frontend; public interface in `index.ts`). It follows the F03 engine
precedent of living in the frontend tree, and reuses the F03 `createRng`/`Rng`.

- `types.ts`: the brief's types plus `ERA_KEYS`, `CONFIDENCE_PROBABILITY`,
  `BANDS`, `UNRANKED_COMPOSITION`, and type guards.
- `scoring.ts`: `pointsFor`, `scorePick`, `scoreModel` (the continuous
  benchmark), `scoreSet`, `totalPoints`, `expectedPoints`.
- `duel.ts`: `resolveDuel`: total, then best single correct call, then draw.
- `elo.ts`: `applyElo`. **Interface decision:** when one player is provisional
  (K 40) and the other established (K 24), the duel uses their mean (32), so
  one integer delta goes to one side and its negation to the other (zero-sum).
  Rounding is half away from zero, so swapping the players mirrors the delta
  exactly.
- `bot.ts`: `sampleBotAccuracy` samples Beta(1 + correct, 1 + wrong) over
  the player's last 20 scored picks, clamped to [0.40, 0.85], using order
  statistics of the injected RNG. `drawBotPicks` is correct with that
  probability, and its tier mix mirrors the player's recent mix with add-one
  smoothing. `BOT_DISPLAY_NAME` and `BOT_DISCLOSURE` hold the required copy.
- `selection.ts`: `drawUnrankedSet` (1 lock + 2 favourite + 2 toss-up,
  shuffled so position reveals nothing) and `drawRankedSet`.

**Verification.** `tests/unit/duel-domain.test.ts` has 21 tests: the exact
table at every tier; the model scored by the same formula; honest-tier
optimality over a 0.001 belief grid (the indifference points are exactly 0.625
and 0.8, where adjacent tiers tie); the believed side dominates; zero-sum and
mirror symmetry over 5,000 random duels; K 24/40/32; bot accuracy converging
within 0.006 of 0.45/0.6/0.75 over 100k puzzles; Beta mean; the 20-pick
window; the tier mirror; composition, shuffling, and determinism.

### 2026-09-23 — Session 3: Worker foundation and guest play

**Shipped.** `worker/`, a separate npm package, because the Workers test pool
needs vitest 4 and the frontend is on vitest 5. It imports the domain from
`frontend/src/duel`, so there is one scoring implementation. Config is in
`worker/wrangler.jsonc`, the schema in `worker/migrations/0001_guest_play.sql`.

**Endpoints** (JSON, `cache-control: no-store`; CORS only for `ALLOWED_ORIGINS`):

| Method + path | Auth | Returns |
|---|---|---|
| `GET /v1/health` | none | `{ ok, poolVersion }` |
| `POST /v1/guests` | none; 10/hour per IP | `201 { guestToken }` |
| `POST /v1/sets` `{ mode: "solo"\|"bot", draw: DrawMode }` | `Authorization: Bearer <guestToken>`; 40/hour per guest, 120/hour per IP | `201 IssuedSet`: `duelId, mode, draw, puzzles: PuzzleView[5], setToken, expiresAt, opponent` (bot: name + disclosure only) |
| `GET /v1/duels/:id` | owner only (others get 404) | `{state:"open", set}` \| `{state:"expired"}` \| `{state:"revealed", result}` |
| `POST /v1/duels/:id/submission` `{ setToken, picks }` | owner + `Idempotency-Key`; 60/hour per guest | `DuelResult`: answers, your scored picks, the model benchmark, the Sparring Partner when a bot duel |

Errors are `{ error, message }` from a fixed table in `src/http.ts`. Unhandled
exceptions log only the error class and return `internal`.

**How each Session 3 control is met.**
- *No answer before lock:* pre-lock responses are built by `toPuzzleView`,
  which copies whitelisted fields only. Answers are read only inside
  `submitPicks`, after the pick is validated.
- *Token binding:* the set token is HMAC-signed
  `{ typ: "set", sub: participant, duel, exp }` with `SET_TOKEN_SECRET`, TTL 20
  minutes (`SET_TTL_MS`). The duel row's `issued_to` and `expires_at` are also
  checked, so a token cannot outlive its set.
- *Double submission:* `submissions` has `PRIMARY KEY (duel_id, participant)`
  and `UNIQUE (participant, idempotency_key)`. The submission, its five
  `scored_picks`, and `served_answers` are written in one D1 batch. A retry
  with the same key returns the stored result; any other key gets 409.
- *Rate limits:* fixed-window KV counters (`src/ratelimit.ts`) return 429 with
  `Retry-After`. The KV keys use a keyed hash of the IP, never the raw
  address. KV is eventually consistent, so these are soft limits. The D1
  constraint, not the counter, is what blocks double submission.
- *Instrumentation from the first recorded result:* `ms_to_submit` per
  submission, and a row per pick (tier, side, correct, points) for per-tier
  accuracy and confidence entropy.
- *Pool:* KV keys `pool:<v>:puzzle:<id>` hold `{view, answer}`;
  `pool:<v>:index:sim:<era|all>:<band>` and `pool:<v>:index:ranked:<era|all>`
  hold id lists. `served_answers` records every puzzle revealed, which is the
  runtime record ranked single use needs.

**Stored identifiers.** A random guest id and a creation time. No IP address,
user agent, or email.

**Loading the pool.** `python scripts/generate_duel_pool.py`, then
`cd worker && node scripts/build-pool-kv.mjs` writes `worker/.pool-kv/*.json`
(gitignored), then `npx wrangler kv bulk put --binding POOL --remote <file>`
for each file. `node scripts/seed-local.mjs [--fixture]` applies migrations and
seeds local state. The local KV proxy fails on bulk writes near 1 MB, so it
writes 250-entry chunks: about 8 minutes for the real pool, seconds for the
fixture.

**Verification.** `cd worker && npm test` runs 18 tests inside workerd with
local D1/KV. `npx tsc --noEmit` is clean. They cover: whitelisted set payloads;
composition and sim-only draws; forged, unknown, and malformed auth; answer
markers (field names and the fixture's distinctive probabilities) absent from
every pre-lock response, including every error path and a broken pool; the
fixed 503; server-side scoring that ignores client-sent points; bot disclosure
next to the model; five token-mismatch shapes; five invalid pick shapes; the
missing idempotency key; same-key retry and different-key 409; six
concurrent submissions leaving exactly one row; a raw duplicate `INSERT`
rejected by D1; token and row TTL; owner-only reload; per-IP and
per-participant 429; no raw IP in KV; CORS. Two mutation checks were run.
Leaking the model probability into `toPuzzleView` fails two tests. Deleting
the application-level duplicate check still passes every test, because the D1
constraint alone blocks the second submission. A manual run against
`wrangler dev` with the full 30,389-puzzle pool completed a bot duel.

**Owner configuration (before the first deploy).**
1. `wrangler d1 create court-of-all-time-duel` and put the id in `wrangler.jsonc`.
   Then `npm run db:migrate:remote`.
2. `wrangler kv namespace create POOL` and `... RATE_LIMITS`, and put the ids in
   `wrangler.jsonc`.
3. `wrangler secret put GUEST_TOKEN_SECRET` and `wrangler secret put SET_TOKEN_SECRET`,
   each a long random string.
4. Set `ALLOWED_ORIGINS` to the production site origin(s).
5. Set `DUEL_POOL_SALT` in the repo `.env`, generate the pool, load it into KV,
   and set `POOL_VERSION` to match.
6. Add a WAF rate-limit rule in front of `/v1/*` (defence in depth for the soft KV limits).

### 2026-09-23 — Session 4: play surface

**Routes.** `/duel` (`pages/DuelHomePage.tsx`) lets the player choose the
opponent (Sparring Partner, shown with its disclosure, or Solo), the era (Any,
or one of the five buckets), and see the scoring table. `/duel/:duelId`
(`pages/DuelPlayPage.tsx`) shows one game at a time
(`components/duel/PuzzleCard.tsx`: a stats table, "X won" buttons with
`aria-pressed`, and a confidence radio group showing each tier's stakes). Then
a review list with "Change" links, "Lock in picks", and the reveal
(`components/duel/DuelReveal.tsx`). The reveal always shows the pre-game model
as a dashed "benchmark" score, with a note that it was trained through 2021.
In a bot duel it also shows the Sparring Partner's persistent disclosure, next
to its name while playing and on the result.

**Backend isolation.** `VITE_DUEL_API` (in `src/env.d.ts`) is the only switch.
Without it, the header has no Duel link, the home page has no duel card,
`/duel` shows `DuelUnavailable`, and nothing calls a backend.
`lib/duelApi.ts` is the only module that talks to the Worker. The explorer and
tournaments never import it. Errors map to plain copy that points back to the
explorer and tournaments.

**Client state.** The guest token is in `localStorage` `ct:duel:guest:v1`,
held in memory when storage is blocked; a rejected token is replaced once.
In-progress picks and the submission's idempotency key are in `sessionStorage`
`ct:duel:draft:v1:<duelId>`, validated on load. Retries reuse the key. After
reveal the router state is cleared, so a reload fetches the stored result
rather than re-opening the pre-lock set.

**Interface changes.** The wire types moved to `frontend/src/duel/api.ts`
(`IssuedSet`, `DuelResult`, `DuelState`); the Worker imports them.
`DuelResult.puzzles[]` now includes each puzzle's `view` (already public) so
the reveal can name teams after a reload. The Worker gained a
`RATE_LIMIT_SCALE` var: 1 in `wrangler.jsonc`, 100 only for the local e2e run.
A missing or malformed value falls back to 1 (tested). Header CSS now wraps:
the extra nav link overflowed the header by 42 px at 360 px on every page.

**Analytics (added deliberately; no alternate names).** `duel_started`
`{ mode, drawKind, era }` fires when a set is issued. `duel_completed`
`{ mode, drawKind, outcome: win|loss|draw|solo, beatModel }` fires once on
lock-in, and not on a reload of a revealed duel. Failures use the existing
`app_error` with surface `duel-start`, `duel-submit`, or `duel-load`. No
puzzle id, pick, or team is ever a property.

**Verification.**

| Check | Command | Result |
|---|---|---|
| Types + build | `cd frontend && npm run build` | passes |
| Lint | `npm run lint` | clean |
| Unit | `npm test` | 130 passed (21 domain + 6 UI helpers new since F05) |
| E2E | `npx playwright test` | 40 passed (6 new in `tests/e2e/duel.spec.ts`) |
| Worker | `cd worker && npm test` | 20 passed |
| Python | `python -m pytest tests` / `python src/models/test_pregame_leakage.py` | 40 passed / exit 0 |

Playwright now starts two servers: the Worker (`wrangler dev` on 8788, fresh
local D1/KV seeded with the fixture pool) and Vite with `VITE_DUEL_API` set.
The duel e2e tests cover: the full bot loop at 360 px by keyboard with no
horizontal overflow; every API body received before lock scanned for answer
fields and the fixture's distinctive probabilities; disclosure and benchmark
on the result; solo mode; a mid-set reload keeping picks and a post-reveal
reload showing the identical result without re-firing `duel_completed`; lock-in
gated on side plus confidence; the explorer and tournament making zero requests
to the API; and, with the API aborted, matchups and tournaments working while
`/duel` shows the unavailable copy. Screenshots of `/duel`, a game, and the
reveal were reviewed at 360 px and 1280 px.

**Not done / next.** Friend duels by invite link are Session 6 in this plan.
Accounts (Session 5), ranked (6), leaderboard and anti-abuse (7), and
hardening (8) are not started. After a reload the reveal's "Play another set"
uses a random draw, because the result does not carry the draw mode.

### 2026-09-24 — Session 5: accounts

**Shipped.** Worker: `src/accounts.ts` (magic links, sessions, guest upgrade,
names, ranked gate), `src/names.ts` (moderation), `src/services.ts` (email and
Turnstile interfaces and doubles), migration `0002_accounts.sql`. Frontend:
`/account` (`pages/AccountPage.tsx`), `/account/verify`
(`pages/AccountVerifyPage.tsx`), `components/account/TurnstileWidget.tsx`,
and account calls in `lib/duelApi.ts`. Merged to `main` in PR #4
(merge commit `e7643a9`).

**Endpoints added.**

| Method + path | Auth | Returns |
|---|---|---|
| `POST /v1/auth/magic-link` `{ email, turnstileToken }` | none; Turnstile; 5/h per IP, 3/h per canonical address | `202 { ok }`, the same for every address |
| `POST /v1/auth/verify` `{ token, guestToken? }` | the link; 30/h per IP; new accounts 3/day per IP and 50/h per ASN | `{ sessionToken, account: AccountView }` |
| `POST /v1/auth/sign-out` | session | `{ ok }` |
| `GET /v1/account` | session | `AccountView` (no email, no id) |
| `POST /v1/account/display-name` `{ displayName }` | session; 10 attempts/h | `AccountView` |
| `GET /v1/dev/outbox?to=` | exists only with the local doubles | last magic-link email |

Every existing endpoint accepts a session token (`Bearer s_…`) as well as a
guest token. Accounts play as participant `a:<accountId>`.

**How each Session 5 control is met.**
- *Turnstile-gated creation:* every link request passes `HumanCheck.verify`
  before anything is written or sent. Accounts are created only by redeeming
  such a link. A failed check returns `403 human_check_failed` and sends
  nothing.
- *Rate-limited creation:* the per-IP and per-address link limits, plus 3 new
  accounts per IP per day and 50 per ASN per hour at redemption. The address
  limit uses the canonical form (lowercase, `+tag` removed, Gmail dots
  removed), so one inbox cannot mint accounts by aliasing. All return 429 with
  `Retry-After`.
- *Single-use, short-lived links:* the link token (`ml_` + 32 random bytes)
  goes in the URL fragment, so it never reaches a server log or a `Referer`
  header. Only its SHA-256 is stored. The TTL is 15 minutes. Redemption
  inserts into `magic_link_redemptions`, whose primary key is the token hash,
  in the same D1 batch that creates the account and the session and re-keys
  the guest. A reused link fails the whole batch. Mutation checks: removing
  the application-level "already redeemed" check still passes every test,
  because the constraint alone blocks reuse. Removing the redemption row fails
  three tests.
- *Sessions:* opaque `s_` + 32 random bytes, stored as SHA-256, with a 30-day
  TTL, revocable by sign-out. They are bearer tokens in `localStorage`, not
  cookies, so there is no CSRF surface. Their exposure to XSS is the same as
  the guest token's. The only third-party script is Turnstile, and it loads
  on `/account` only.
- *Display names:* 3–20 characters: Latin letters (accents allowed), digits,
  and `space . _ -` between them, never doubled. Other scripts are refused
  because a Cyrillic "а" would slip "аdmin" past the reserved list. Allowing
  them needs a confusables table. Checks run on a folded key: NFKD, accents
  and punctuation dropped, digits mapped to look-alike letters. Reserved
  words (the site, staff, "Sparring Partner", "Pre-game model", "NBA", and
  others) and a starter blocked-word list are refused as `name_not_allowed`,
  without saying which list matched. `display_name_key` is `UNIQUE` in D1, so
  "Guard Dog", "GUARD_DOG", and "Guard D0g" cannot coexist. The first name is
  free, and so is one rename. After that a player gets one change per 30 days,
  enforced in the `UPDATE`'s `WHERE` clause (`429 rename_too_soon` with
  `Retry-After`).
- *Guest upgrade keeps history:* the browser that opens the link sends its
  guest token. In the same batch, `duels`, `submissions`, and `scored_picks`
  are re-keyed from `g:<guestId>` to `a:<accountId>`, and
  `guests.account_id` retires the guest token. `PRAGMA defer_foreign_keys`
  lets the two foreign-keyed tables move together. A set opened as a guest
  can still be locked in after signing in mid-set; its token is accepted only
  for the account that guest merged into. An invalid or already merged guest
  token never blocks sign-in.
- *No ranked before eligibility:* `assertRankedEligible` requires an account,
  `RANKED_MIN_COMPLETED_DUELS` (10) completed sets, and a display name.
  Before issuing anything, `POST /v1/sets { mode: "ranked" }` answers
  `account_required` for a guest and `ranked_locked` for an ineligible
  account. Once eligible it answers `ranked_unavailable` until Session 6
  replaces that line. Completed sets include solo sets and merged guest
  history. The threshold is a constant the owner can tune.
- *Fail closed:* if email or Turnstile is not configured, or `APP_ORIGIN` is
  outside `ALLOWED_ORIGINS`, sign-in returns a fixed `503 auth_unavailable`.
  Guest play is unaffected. The local doubles (`AUTH_TEST_DOUBLES = "1"`) are
  refused unless every allowed origin is `localhost` or `127.0.0.1`.

**Stored identifiers, and why each is needed.**

| Where | Field | Why |
|---|---|---|
| `accounts` | `id` (random) | The participant key for every result row |
| | `email_hash` = HMAC(`EMAIL_HASH_SECRET`, canonical address), `UNIQUE` | Finds the account at the next sign-in, and allows one account per inbox. It is keyed, so someone with a copy of the database cannot reverse it by hashing a list of addresses |
| | `display_name`, `display_name_key` | Shown on the board (Session 7); the key blocks look-alikes |
| | `name_changed_at` | The rename limit |
| | `created_at` | Account age, a future anti-smurfing signal |
| `magic_links` | token SHA-256, `email_hash`, created/expires | Expiry and single use |
| `magic_link_redemptions` | token SHA-256, time | The single-use constraint |
| `sessions` | token SHA-256, `account_id`, created/expires/revoked | Expiry and sign-out |
| `guests` | `account_id` | Retires a merged guest and honours its open set |
| KV (TTL ≤ 2 windows) | keyed IP hash, email hash, ASN number | Rate limits |

**Not stored anywhere:** the email address (it is used once, to send the
link), IP addresses, user agents, Turnstile tokens, and link or session
tokens in plaintext. As a result, the product cannot email a player unless
they ask for a link. That is deliberate.

**Frontend.** `/duel` gains one line: "Playing as a guest. Sign in
(optional)…" or "You're signed in…". Nothing blocks play, and there is no
header link, because the header was already at its 360 px limit. Signed out,
`/account` shows email, Turnstile, and "Email me a sign-in link", then "Check
your email". Signed in, it shows the display name (disabled, with the next
allowed date, while locked), a ranked checklist (sets completed out of 10,
name chosen), "Play a set", and "Sign out". `/account/verify#token=…` reads
the fragment once, guarded against StrictMode's double effect. It strips the
token from the address bar and history, redeems the link, retires the guest
token, and opens `/account` with a one-time welcome. When the server rejects
a session, the client drops it and play continues as a guest. The session
token is in `localStorage` `ct:duel:session:v1`. `VITE_TURNSTILE_SITE_KEY`
switches the form on; without it, `/account` says sign-in isn't set up.

**Analytics (a new action, not an alternate name).** `account_signed_in
{ mergedGuest }`. Failures use `app_error` with surface `account-link`,
`account-verify`, `account-name`, or `account-load`. No address, name, or
account id is ever a property.

**Interface changes.** `AccountView` and `SignInResult` are in
`frontend/src/duel/api.ts`. `Participant` is now a guest or an account.
`worker/src/index.ts` exports `handle(request, env, services)`, and the
default export wires in `servicesFor(env)`. The new error codes are in
`src/http.ts`. A guest asking for `mode: "ranked"` now gets 403 instead of
400.

**Verification.**

| Check | Command | Result |
|---|---|---|
| Types + build | `cd frontend && npm run build` | passes |
| Lint | `npm run lint` | clean |
| Unit | `npm test` | 136 passed (6 new in `tests/unit/duel-account.test.ts`) |
| E2E | `npx playwright test` | 44 passed (4 new in `tests/e2e/account.spec.ts`) |
| Worker | `cd worker && npx tsc --noEmit && npm test` | clean; 52 passed (32 new in `test/accounts.test.ts`) |
| Python | `python -m pytest tests` / `python src/models/test_pregame_leakage.py` | 40 passed / exit 0 |

The Worker tests cover:

- Turnstile rejection, with nothing mailed.
- Malformed addresses.
- Identical answers for new and existing addresses.
- No address, link token, or session token in any table or KV key.
- 429s per IP, per address (across aliases), and for account creation per IP.
- Fail-closed 503s for a failing mailer, missing production config, and an
  off-site `APP_ORIGIN`.
- Canonicalisation, and one account per inbox.
- Single use: six concurrent redemptions give exactly one success, and D1
  rejects a raw duplicate redemption.
- The 15-minute TTL, and malformed and unknown tokens.
- Sign-out, forged sessions, and expired sessions.
- Guest tokens refused as accounts, and account play under `a:`.
- The guest re-key: no `g:` rows remain, revealed results reload for the
  account, the retired guest is refused, and presenting it again merges
  nothing.
- A mid-set sign-in that locks in only for its own account.
- Name cases: shape, reserved, look-alike, full-width, Cyrillic, and blocked.
- Uniqueness by folded key, including a raw D1 `UPDATE`.
- The rename schedule and the rename-attempt limit.
- The ranked gate at 9 and 10 sets, with and without a name, issuing no set.
- The doubles refused for any non-localhost origin.

Mutation checks: the two described under single use, plus removing the
rename window from the `UPDATE`, which fails the rename test.

The e2e run starts the Worker with the doubles and stubs Turnstile's script
in the browser. At 360 px it plays a guest set, signs in from `/duel`, reads
the link from the dev outbox, and checks that the token is gone from the URL
and the history merged (1 of 10). It then has a reserved name refused, saves
a name, renames it until it locks, reloads the guest-era result as the
account, has the used link refused, signs out, and plays as a guest again.
Other tests cover a failed human check, a verify page with no token, and
Turnstile loading on `/account` only, never on the explorer, tournaments, or
duel play. Screens (`/duel`, sign-in, check email, new and named account,
used link) were reviewed at 360 px and 1280 px, with no horizontal overflow.

**Owner configuration added by Session 5 (needed before sign-in works).**
1. `wrangler secret put EMAIL_HASH_SECRET`: a long random string. **Never
   rotate it**; every account is keyed by it.
2. Create a Resend account and verify the sending domain (SPF/DKIM). Then
   `wrangler secret put EMAIL_API_KEY`, and set `EMAIL_FROM` in
   `wrangler.jsonc`, for example `Court of All Time <signin@your-domain>`.
   Another provider needs only a new `Mailer` in `src/services.ts`.
3. Create a Turnstile widget for the production hostname. Then
   `wrangler secret put TURNSTILE_SECRET_KEY`, and set
   `VITE_TURNSTILE_SITE_KEY` in the Pages build.
4. Set `APP_ORIGIN` to the production site origin; it must also be in
   `ALLOWED_ORIGINS`.
5. Run `npm run db:migrate:remote` to apply `0002_accounts.sql`.
6. Never set `AUTH_TEST_DOUBLES` in production. It would be ignored there
   anyway, because production origins are not localhost.
7. Extend the blocked-word list in `worker/src/names.ts` before launch.

**Not done / next.** Expired `magic_links` and `sessions` rows are not purged
yet; a scheduled cleanup belongs in Session 8. Only the guest in the browser
that opens the link is merged; guest history in another browser stays there.
Players cannot delete their account yet; Session 8's privacy review should
add that. Ranked duels, matchmaking, Elo application, and the leaderboard
(Sessions 6–7) are not started. They remain blocked on the owner decisions
restated in `F09-continuation-handoff.md`.

### 2026-09-24 — Session 6: ranked duels, matchmaking, and friend duels

**Owner decisions applied first** (recorded in "Owner decisions" above). Draw
modes are confirmed. Lookup control is statistical: flag accuracy above the
honest ceiling, which Session 7 enforces. Ranked puzzles are reused on a limited
basis instead of being single-use.

**Shipped.** Worker: `src/matches.ts` (matches, matchmaking, invites, settling,
and the scheduled sweep) and migration `0003_ranked.sql`. `src/play.ts` now
shares result building with matches. Frontend: `/duel/join`
(`pages/DuelJoinPage.tsx`) and `components/duel/DuelWaiting.tsx`. Friend and
Ranked options are on `/duel`, the reveal shows player opponents and ratings,
and `/account` shows the rating.

**Model.** A ranked or friend duel is a *match*: one puzzle set
(`matches.puzzle_ids`) and two seats (`match_seats`), each seat with its own
`duels` row carrying the same `puzzle_ids`. The creator is dealt the set and
plays first. Once they lock in, the match waits for an opponent until
`open_until`. The opponent receives the match's set, never a fresh draw.
Answers, and each seat's picks, stay in D1 until the match resolves. Then both
seats' stored results are rewritten in the same batch that records the
resolution and the rating changes.

**Timeout rules.**

| Situation | Rule | Rated? |
|---|---|---|
| A seat's picking time | 20 minutes from issue (`SET_TTL_MS`) | |
| Creator never locks in | The match can never be joined; nothing is revealed or settled | No |
| Opponent joins but does not lock in within 20 minutes | **Forfeit**: the creator wins; the forfeiter sees "expired" plus their rating change | Ranked: yes |
| Nobody joins within 24 hours (`RANKED_MATCH_WAIT_MS`, `FRIEND_INVITE_TTL_MS`), or the creator presses stop waiting | **No opponent**: ranked scores the creator against the disclosed Sparring Partner; friend reveals solo | No |
| Both lock in | Scored by the duel rule (total, then best correct call, then draw) | Ranked: yes |

Settling runs from the second lock-in, from any read of either seat, from
`POST /v1/duels/:id/stop-waiting`, and from a cron sweep every 15 minutes
(`triggers` in `wrangler.jsonc`, `settleDue`). Settling can safely run any
number of times.

**Matchmaking.** `POST /v1/sets { mode: "ranked" }` passes `assertRankedEligible`,
then seats the account in the oldest waiting ranked match that meets all of
these conditions:

- The creator has locked in.
- The match is still open and unresolved.
- The creator is not the caller.
- The ratings are within a window that starts at ±100 and widens by 50 per
  hour of waiting, up to ±400 (`RATING_WINDOW`).
- The two accounts have not been paired in the last 24 hours
  (`REPEAT_PAIR_WINDOW_MS`).
- The match contains no puzzle the caller has been shown.

If nothing qualifies, the account is dealt a new set from the ranked partition.
An account may have at most 3 unresolved ranked matches (`ranked_queue_full`).
Ranked draws ignore era; the server draws from all eras.

**Limited reuse.** `ranked_exposures (account_id, puzzle_id)` records every
ranked puzzle shown to an account, at issue time, and those puzzles are never
dealt to it again. `ranked_reveals` records when each ranked answer was last
revealed, and a draw skips anything revealed in the last 30 days
(`RANKED_REUSE_COOLDOWN_MS`). If fewer than five puzzles remain, the answer is
`ranked_exhausted`. Sim and ranked stay disjoint.

**Friend duels.** `POST /v1/sets { mode: "friend", draw }` is open to guests and
uses the unranked composition with the challenger's draw, which is locked for
both players. After lock-in, the creator's waiting view carries `invitePath`,
`/duel/join#invite=<token>`. The token is an HMAC-signed match id, so nothing
extra is stored. It rides in the fragment, so it never reaches a log. The friend
presses "Start the duel", which calls `POST /v1/invites/accept { invite }` and
begins their 20 minutes. Accepting your own invite answers `invite_own`.
Reopening your own accepted link returns your seat. Anyone else gets
`invite_unavailable`. Friend duels are never rated.

**Elo.** `ratings` (account, rating, rated duels) and the ledger `rating_changes`
(one row per account per match: before, after, delta, K, rated duels before).
Deltas come from the Session 2 `applyElo`, with the mean K when K differs, so
every match is zero-sum. `CHECK (rating_after = rating_before + delta)` holds.
`rating_before` is inserted from a subquery that matches only the rating the
delta was computed from, so a concurrent change makes it NULL and fails the
batch, which is then re-read and retried. The ledger alone reproduces every
rating: `rating = 1200 + SUM(delta)`.

**How each Session 6 control is met.**
- *Both participants receive the same set:* the joiner's `duels` row copies
  `matches.puzzle_ids`. The seat insert and the duel row are one batch, and the
  `(match_id, seat)` primary key allows a single opponent. Tested:

  - the ids and order are identical;
  - all three stored copies are equal;
  - four racing joiners produce one seat;
  - D1 rejects a raw second seat.
- *No path reveals an opponent's picks, or any answer, before both lock in:*
  both are returned only from the stored results written at resolution. The
  creator's waiting view has exactly six whitelisted fields. The joiner's set is
  built by `openSet` from `toPuzzleView`. A test scans every pre-resolution
  response on both sides, including errors and cross-seat reads, for answer
  fields, the fixture's model probabilities, and the keys `picks`,
  `confidence`, `side`, `points`, and `correct`. The e2e run does the same scan
  in two real browsers.
- *Abandoned duels resolve by a documented timeout rule:* the table above, with
  tests for forfeit, no opponent through the cron sweep, stop waiting (and its
  refusal once someone has joined), and a creator who never locks in.
- *Bot fallback is unrated and disclosed:* no rating row is written, the result
  says `rated: false`, and the Sparring Partner appears with its disclosure. The
  reveal says the set "doesn't count toward your rating".
- *Elo is zero-sum and auditable:* a six-match round robin among four accounts
  checks that every match sums to 0, that rating = start + ledger sum for every
  account, and that each change starts where the previous one ended. Five
  parallel settles plus the second lock-in produce one resolution and two
  changes. D1 rejects a second resolution and a change from a stale rating.

**Integrity guards (D1, not code).** Several inserts take a key from a subquery
that is NULL when the situation has changed, so the NOT NULL constraint fails
the whole batch:

- a seat insert into a match that is resolved, closed, not yet locked by its
  creator, or already holding this participant;
- a lock-in into a match that has already resolved (`set_expired`; tested by
  writing the resolution first);
- a no-opponent resolution once someone has joined;
- a forfeit resolution once the opponent has locked in.

**Mutation checks.**

| Mutation | Result |
|---|---|
| Let a match be joined before its creator locks in | 6 tests fail |
| Make the Elo delta not zero-sum | 4 tests fail (the ledger `CHECK` rejects it) |
| Put the opponent's picks in the waiting view | The leak test fails |
| Drop the joiner exposure filter | The reuse test fails |
| Remove the forfeit resolution's "opponent has not locked in" guard | **Still passes.** That guard only matters when a lock-in lands between settle's read and its write, which a black-box test cannot schedule. It is covered by reasoning, not a test |

**Interface changes.**
- `PlayMode` adds `ranked` and `friend`.
- `IssuedSet.opponent` may be a `PlayerOpponent` (`{kind: "player", name}`).
- `DuelResult` gains `match: MatchSummary | null`. `opponent.picks` may be null
  (forfeit), and `decidedBy` may be `forfeit`.
- `DuelState` gains `waiting`, and `expired` carries `match`.
- **The submission endpoint now returns a `DuelState`** (`revealed` or
  `waiting`) instead of a bare `DuelResult`.
- `AccountView.rating`.
- New endpoints: `POST /v1/invites/accept` and
  `POST /v1/duels/:id/stop-waiting`.
- New error codes: `invite_own`, `invite_unavailable`, `ranked_queue_full`,
  `not_waiting`, and `ranked_exhausted`. `ranked_unavailable` is removed.
- `upgradeGuest` also re-keys `match_seats`, so a guest host who signs in keeps
  their waiting friend duel (tested).
- The fixture pool has 40 ranked puzzles per era, up from 6.
- Migration `0003` rebuilds `duels` to widen its `CHECK`, and rebuilds its two
  child tables with it. Dropping a parent that still has children leaves
  deferred foreign-key violations that the rename does not clear, and D1 rejects
  the migration. It was checked against a local D1 holding Session 3–5 rows: the
  rows were kept and the foreign keys still point at the rebuilt tables and are
  enforced.

**Analytics (new actions, not alternate names).**
- `duel_started` and `duel_completed` accept the new modes. `duel_started` also
  fires when a friend accepts.
- `duel_waiting { mode }` fires when a lock-in has to wait. Properties cannot
  be null, so it is not a `pending` value of `duel_completed`.
- `duel_invite_shared { shareMethod: copy | native }`.
- New `app_error` surfaces: `duel-join` and `duel-stop-waiting`.

**Verification.**

| Check | Command | Result |
|---|---|---|
| Types + build | `cd frontend && npm run build` | passes |
| Lint | `npm run lint` | clean |
| Unit | `npm test` | 140 passed (4 new in `duel-ui.test.ts`) |
| E2E | `npx playwright test` | 46 passed (2 new in `tests/e2e/ranked.spec.ts`) |
| Worker | `cd worker && npx tsc --noEmit && npm test` | clean; 75 passed (23 new in `test/ranked.test.ts`) |
| Python | `python -m pytest tests` / `python src/models/test_pregame_leakage.py` | 40 passed / exit 0 |

The e2e run has two eligible accounts, made through the API, in two browsers at
360 px. It checks that:

- Ranked is enabled and era is locked.
- The creator locks in and waits, and sees the joiner's name after a reload.
- The joiner's five games match the creator's exactly.
- Neither browser receives an answer or a pick before the second lock-in.
- Both reveals show "Rated duel. Your rating: 1,200 → …", five opponent pick
  lines, the benchmark, and no bot disclosure.
- `/account` shows the rating.

A second run has two guests play a friend duel by link. It checks the join page,
identical games, the host's "Your friend is playing your set", both reveals
unranked, and the spent link refused. Screens were reviewed at 360 px and
1280 px with no horizontal overflow: `/duel` with Ranked, ranked waiting, friend
waiting with its invite, the join page, the joiner's game, the ranked reveal,
and `/account` with a rating.

**Owner configuration added by Session 6.**
1. Run `npm run db:migrate:remote` to apply `0003_ranked.sql`. It rebuilds
   `duels`, `submissions`, and `scored_picks`; take a D1 backup first
   (`wrangler d1 export`).
2. `wrangler deploy` picks up the cron trigger from `wrangler.jsonc`. Check it
   in the dashboard under the Worker's Triggers. Locally, cron is not automatic:
   use `curl "http://127.0.0.1:8788/cdn-cgi/local/scheduled"`.

**Not done / next (Session 7).**
- The leaderboard, and the lookup-control flag (sustained accuracy above about
  68%, owner decision).
- Collusion detection. `match_seats` and `rating_changes` hold the pairing
  graph. Forfeits are recorded as `settled_by = 'forfeit'`, so repeated
  forfeits to the same opponent (an alt feeding a main) are queryable.
- The ranked queue is empty on a new ladder. Early ranked players will often
  get the Sparring Partner fallback, which is unrated, after 24 hours. The
  owner may want a shorter wait or seeded launch play.
- Purging expired `magic_links` and `sessions` rows can now use the cron hook.
- Account deletion is still Session 8.

### 2026-09-25 — Session 7: leaderboard and anti-abuse enforcement

**Shipped.** Worker: migration `0004_integrity.sql`, `src/integrity-rules.ts`
(the detection rules as pure functions), `src/integrity.ts` (metrics, the
sweep, flag storage, and network signals), `src/leaderboard.ts`, `src/admin.ts`
(the review queue), and `scripts/review-queue.mjs` (a command-line client for
it). Frontend: `/duel/leaderboard` (`pages/DuelLeaderboardPage.tsx`), linked
from `/duel`, `/account`, and every rated reveal. Branch `f09-leaderboard`.

**Principle: flag, never ban.** A detector's finding becomes an open row in
`integrity_flags`. An open or upheld flag does one thing: it keeps the
account off the leaderboard. The account still plays ranked, is still
matchmade, and its rating still moves (tested). A reviewer clears the flag,
which puts the account back on the board, or upholds it, which keeps it off.
An upheld flag can be cleared later on appeal. Any heavier sanction, such as a
rating reset or blocking ranked, is a separate owner decision and is not
built.

**Anomaly metrics for all rated play.** Every ranked submission writes a
`play_metrics` row in the same D1 batch as the submission:

- time to lock in;
- picks, correct picks, and lock picks correct;
- the tier mix and confidence entropy (in bits);
- how many picks were on the model's side;
- points, and the model's points.

A `CHECK` keeps each row internally consistent. The per-pick rows from
Session 3 are unchanged. Unranked play gets no metrics row.

**Detectors.** A sweep runs every 15 minutes, after the match settler, in the
same cron trigger. It also runs on demand from `POST /v1/admin/sweep`. Every
threshold is a named constant in `integrity-rules.ts`.

| Flag | Rule | Evidence stored |
|---|---|---|
| `accuracy_ceiling` (owner's lookup control) | The lower bound of the 99.9% one-sided Wilson interval on the account's last 50 rated sets (up to 250 picks) is above **0.68**. Needs at least 50 picks | sets, picks, correct, accuracy, bound, lock record |
| `scripted_timing` | Median time from issue to lock-in over the last 10 rated sets is below **20 s** for five games. Needs at least 5 sets | sets, median, fastest |
| `repeat_pair` | Two accounts meet in **6** rated matches within 30 days. The matchmaker already refuses a pair twice in 24 hours | matches |
| `win_trading` | A pair with at least **4** rated matches in 30 days, with at least 75% going one way | wins, losses, draws |
| `forfeit_feeding` | One account forfeits to the same opponent **twice** in 30 days. Both accounts are flagged | forfeits given and received |
| `feeder_ring` | At least **2** "feeders" around one account. A feeder has at least 2 rated matches, at least 60% of them against that account, and lost at least 75% of those. The centre and every feeder are flagged | feeder count and ids, wins from feeders |
| `linked_accounts` | Two accounts created from the same network on the same UTC day meet in rated play | matches |
| `multi_account` | The per-network daily maximum of 3 new accounts is reached. Raised when the third account is created | accounts from the network that day |

Why a confidence bound and not raw accuracy: the model itself calls 69.5% of
the ranked pool, so a fixed 68% cut-off would flag honest model-level players
all the time. Exact binomial figures for the rule:

| Picks judged | Correct needed | P(flag) at 65% | at 69.5% (model level) | at 75% | at 80% | at 90% (lookup) |
|---|---|---|---|---|---|---|
| 50 | 45 (90%) | 0.0001 | 0.0006 | 0.007 | 0.048 | 0.62 |
| 100 | 83 (83%) | 0.0001 | 0.0016 | 0.038 | 0.27 | 0.99 |
| 150 | 120 (80%) | <0.0001 | 0.0026 | 0.091 | 0.55 | >0.999 |
| 250 | 193 (77.2%) | <0.0001 | 0.0042 | 0.23 | 0.88 | >0.999 |

A player who looks up nine answers in ten is caught within 20 rated sets, and
a model-level player is flagged well under 1% of the time. Someone who looks up
only some answers and stays near 72% is not caught. That is the honest limit
of a statistical control: it bounds the damage rather than removing it. The
owner can lower `ACCURACY_Z` to catch more at the cost of more reviews.

**Re-flagging.** At most one flag per (account, kind, related account) is
open at a time; the partial unique index `integrity_flags_one_open` enforces
this, and a repeat sweep refreshes that flag's evidence. After a review,
the same key is judged **only on activity after the review time**, so a
cleared false positive is not raised again on the same evidence (tested: nine
new perfect sets after a clear raise nothing; the tenth re-flags). An upheld
key is not judged again. Open flags stay open when the evidence fades. Only a
reviewer closes them.

**Leaderboards.** `GET /v1/leaderboard?board=daily|30d`, public:

| Board | Window | Appears with | Ordered by |
|---|---|---|---|
| `daily` | since 00:00 UTC | 1 rated duel | rating change in the window, then rating |
| `30d` | the last 30 days | 5 rated duels (`BOARD_MIN_DUELS`) | current rating, then duels |

Only human-vs-human rated duels count. Sparring Partner fallbacks are unrated
and never appear. The board excludes an account with an open or upheld flag,
or without a display name, and returns at most 100 rows. Each row carries
display name, rating, a provisional marker, W/L/D in the window, and the
rating change. No account id, email hash, or flag detail is included
(tested). The board is served from the Workers Cache API for
`LEADERBOARD_CACHE_SECONDS` (60 in `wrangler.jsonc`, 0 in tests and e2e), so
a newly flagged account can linger for up to a minute. `AccountView` gains
`hiddenFromBoard`. A hidden player sees on `/duel/leaderboard` and `/account`
that an integrity review keeps them off the board and that ranked play and
rating are unaffected. Evidence is never shown to the player.

**Review queue.** The queue answers under `/v1/admin/*` and needs the
`ADMIN_TOKEN` secret (at least 32 characters). Without the secret, or with a
wrong token, every admin path answers 404, the same as a missing endpoint.
Requests are rate-limited per IP before the token check.

- `GET /v1/admin/flags?status=open|cleared|upheld` lists flags with their
  evidence, both display names, and the account's rating and age.
- `POST /v1/admin/flags/:id { decision: "clear" | "uphold", note? }`: the
  allowed transition is part of the `UPDATE`, so two reviewers cannot both
  decide (`409 flag_decided`).
- `node scripts/review-queue.mjs list|clear|uphold|sweep` wraps these calls.

There is no web UI for reviewers. That is deliberate: a review UI would be a
second authenticated surface to secure, and the queue is expected to be small.

**Multi-account signal without storing IPs.** When an account is created, its
id is appended to a KV entry keyed by the keyed IP hash and the UTC day. The
entry expires after two days. Earlier accounts in that entry are linked to the
new one in `account_links`, a pair of account ids with no network. The third
account of the day flags all three. KV is eventually consistent, so this is a
signal, not a guarantee; the hard limit is still the Session 5 rate limit.
Loopback addresses are skipped, because in local development every request
comes from one address and would link every account. The signal never blocks
a sign-in.

**Housekeeping.** The sweep deletes sign-in links, their redemption rows, and
sessions one day after they stop working. A redemption row is safe to drop
once its link has expired, because an expired link is refused on its expiry
alone.

**Abuse model: control status** (Session 7's first acceptance check).

| Threat | Status | Where |
|---|---|---|
| Looking up the real game | Implemented: de-identified puzzles, plus the `accuracy_ceiling` flag (owner decision) | Session 1; `integrity-rules.ts` |
| Reading the answer from the client | Implemented | Sessions 3 and 6 |
| Score tampering | Implemented | Session 3 |
| Replayed or scripted submission | Implemented: signed set tokens, plus the `scripted_timing` flag | Session 3; `integrity-rules.ts` |
| Double submission | Implemented: D1 constraint plus idempotency key | Session 3 |
| Multi-accounting and smurfing | Implemented: Turnstile, IP and ASN limits, the ranked gate, `account_links`, `multi_account`, and `linked_accounts`. **Not done:** device fingerprinting. It would need a stored device identifier, which conflicts with the data minimisation in Session 5; Session 8's privacy review can revisit it | Sessions 5 and 7 |
| Collusion and win-trading | Implemented: `repeat_pair`, `win_trading`, `forfeit_feeding`, and `feeder_ring` over the rated pairing graph | `integrity-rules.ts` |
| Automated spam and load | Implemented: KV token buckets, an edge-cached leaderboard, and a WAF rule (owner setup). **Deferred to Session 8:** edge-cached puzzle payloads. Every set is a random draw for one player, so there is no shared payload to cache; whether caching individual puzzle reads from KV pays off is a load-test question | Session 3; `leaderboard.ts` |
| Impersonation on the board | Implemented: moderated, unique, rate-limited display names; the board shows only those names | Session 5 |
| Undetectable cheating | Implemented: per-pick rows (Session 3) plus `play_metrics` per rated set. Entropy and model agreement are recorded but trip no rule yet, because there is no baseline to set a threshold from. Set one after launch data exists | `integrity.ts` |

**Interface changes.**

- `AccountView.hiddenFromBoard`.
- New wire types: `LeaderboardKind`, `LeaderboardEntry`, `LeaderboardView`.
- New error code: `flag_decided`.
- New env: `LEADERBOARD_CACHE_SECONDS` (a var) and `ADMIN_TOKEN` (a secret).
- New rate limit: `adminPerIp` (120/hour).
- `play.ts` adds the metrics row to every ranked submission batch.
- The scheduled handler now settles and then sweeps. Each step logs its own
  failure and does not stop the other.
- Worker tests share helpers in `test/helpers.ts`.
- `call()` there takes an `env` override, for cache and admin tests.

**Fixes found along the way.**

- Two Session 6 queue tests failed about one run in eight. The joiner had been
  dealt its own fresh set, which recorded exposures that a later random set
  could overlap, so the matchmaker correctly refused to seat it. The tests now
  clear that exposure.
- "Check your email" at 360 px overflowed by 2–8 px when a generated address
  was long enough. It reproduced on the Session 6 code. The address now wraps.

**Verification.**

| Check | Command | Result |
|---|---|---|
| Types + build | `cd frontend && npm run build` | passes |
| Lint | `npm run lint` | clean |
| Unit | `npm test` | 142 passed (2 new in `duel-ui.test.ts`) |
| E2E | `npx playwright test` | 47 passed (1 new in `ranked.spec.ts`) |
| Worker | `cd worker && npx tsc --noEmit && npm test` | clean; 110 passed (15 in `integrity-rules.test.ts`, 20 in `integrity.test.ts`) |
| Python | `python -m pytest tests` / `python src/models/test_pregame_leakage.py` | 40 passed / exit 0 |

The Worker suite ran three times in a row without a failure.

The acceptance scenarios run end to end through the API:

- **Synthetic scripted-submission run:** ten instant, perfect ranked lock-ins
  raise `scripted_timing` and `accuracy_ceiling`.
- **Human-paced lookup cheat:** the same run at 90 seconds a set raises only
  `accuracy_ceiling`.
- **Hot honest streak:** 36 of 50 correct (72%) raises nothing.
- **Synthetic collusion ring:** a main and three alts, fed through losses and
  forfeits via the real matchmaker and settler, raise `feeder_ring` on all four
  and `forfeit_feeding` on the forfeiting pair. An honest three-way round
  robin raises nothing.
- **The board:**
  - It excludes open and upheld flags and restores cleared ones.
  - Its windows, the minimum-duels rule, ordering, and caching behave as
    specified.
  - It carries no identifiers.
- **Linked accounts:** created from one network, they are linked; the third
  is flagged. Loopback is skipped, and linked accounts that meet in rated play
  are flagged.
- **Cron:** the real scheduled handler settles a forfeit and flags it with
  nobody looking.
- **Purge:** it keeps live rows.

The pure-rule suite computes the accuracy rule's false-positive rate and power
from the exact binomial distribution. The e2e test plays a rated duel in the
browser at 360 px. It then:

- follows "See the leaderboard" from the reveal;
- checks the player's row is marked "(you)", and switches boards;
- has a real `scripted_timing` flag raised by the sweep hide the player, with
  the notice shown on the board and on `/account`, and ranked still open;
- has an admin clear restore the player to the board.

Screens were reviewed at 360 px and 1280 px (board, hidden notice, desktop
table) with no horizontal overflow.

**Mutation checks.** Each was applied alone, with the full Worker suite run
against it.

| Mutation | Result |
|---|---|
| Board ignores flags | 1 test fails |
| Board hides open but not upheld flags | 1 test fails |
| No metrics row on rated play | 4 tests fail |
| Review time ignored (a cleared flag returns on old evidence) | 1 test fails |
| No ring detection | 2 tests fail |
| No forfeit-feeding rule | 4 tests fail |
| Timing rule off | 3 tests fail |
| Accuracy rule uses raw accuracy instead of the bound | 2 tests fail. It first **survived**; the 72% hot-streak control was added because of it |
| Admin accepts any token | 1 test fails |
| A decision allowed from any status | 1 test fails |
| Scheduled handler skips the sweep | 1 test fails |
| Multi-account never flags | 1 test fails |

**Stored identifiers added (for Session 8's privacy review).**

| Where | What | Why |
|---|---|---|
| `play_metrics` | per rated set: timing, accuracy, tier mix, model agreement, points | The detectors, and a reviewer's context |
| `integrity_flags` | account id, related account id, rule evidence (counts and rates), status, reviewer note | The review queue. **Reviewer notes must not contain personal data**; there is no email to put there anyway |
| `account_links` | two account ids, a reason, a time | Linking same-network accounts without keeping the network |
| KV `sig:net:<keyed IP hash>:<day>` | up to 20 account ids, 2-day TTL | Same-day, same-network detection |

**Owner configuration added by Session 7.**

1. Back up D1, then run `npm run db:migrate:remote` to apply
   `0004_integrity.sql`. It adds tables and indexes and does not rebuild
   anything.
2. Run `wrangler secret put ADMIN_TOKEN` with at least 32 random characters.
   Keep it in a password manager. Without it the review queue does not exist,
   but flags are still raised and still hide accounts.
3. Review flags regularly, using
   `DUEL_API=… ADMIN_TOKEN=… node scripts/review-queue.mjs list`. An
   unreviewed false positive keeps an honest player off the board.
4. Optionally tune `LEADERBOARD_CACHE_SECONDS`, which is 60 by default, and
   the thresholds in `src/integrity-rules.ts`.

**Not done / next (Session 8).**

- Run the load and cost review, including the sweep's full 30-day scan of rated
  matches every 15 minutes. That is about 30,000 rows per run at 1,000 rated
  matches a day. Make the scan incremental if the numbers call for it.
- Decide on edge-caching puzzle reads (deferred above).
- Do the privacy review of the new identifiers, and add account deletion. Its
  cascade must now cover `play_metrics`, `integrity_flags`, `account_links`,
  and the rating ledger.
- Review the leaderboard and review-notice copy against the brand and
  integrity gates.
- Owner policy: what, beyond staying off the board, an upheld flag means.
