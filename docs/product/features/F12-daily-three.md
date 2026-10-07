# F12: Daily Three (a daily pick'em with simulated games)

Status: **Session 1 built (2026-10-06, branch `f12-s1-pool`); its PR waits for
the owner's review of the pool and Q2.** Decided with the owner on 2026-10-05.

Read first, in order: `CONTRIBUTING.md`, `docs/product/HANDOFF.md`,
`docs/product/DEPLOYMENT.md` (the staging setup and the "stop before going
live" rule), then this brief. Sessions 2–4 also need
`frontend/src/tournament/prng.ts`, and Session 4 needs the Worker sections of
`features/F09-continuation-handoff.md`.

## Outcome

A short daily game that brings people back every day, like Wordle. Each day,
every player gets the **same three cross-era matchups** between great teams. A
player studies two cards per matchup (the record, plus the starting five with
each starter's scoring and signature stats), picks a winner in all three, and
locks in. Each game then **plays out as a simulated game**: a scoreboard, a
running clock, and scoring plays, ending in a final score. The player gets a
score out of 3, two streaks, personal stats, and a share text with no spoilers.

The whole ritual takes about two minutes.

## Why

The matchup explorer answers a question when someone has one. Nothing on the
site gives a reason to come back tomorrow. Daily Three provides one:
- a fresh, shared puzzle every day;
- a streak to protect;
- a share text that brings in new players.

It reuses what the site already has: the exported neutral-court win
probabilities, the deterministic PRNG from tournaments, and, for crowd stats
only, the duel Worker.

## Owner decisions (2026-10-05)

| Decision | Choice |
|---|---|
| Format | **3 matchups a day**, the same for every player. One is the **featured** matchup between two well-known teams. The other two are known teams in close games with a clearer favourite, more forgiving than the featured game. Tuned as we go |
| Great teams (the pool) | Champions, high-win teams, and teams with notable stars |
| Repeats | A pairing **never** repeats. A team-season appears at most **once in any 7 days**. The same franchise in a different season may appear (the 1996 Bulls and the 1992 Bulls in the same week is fine) |
| Cards | Teams named up front. Each card shows the team, the season, and the record. It also lists the **starting five**, each with PPG plus 1–2 signature stats (for example RPG and BPG for Shaq, 3PM for Curry) |
| Model before the pick | **No hints.** The model's probability and margin are never shown before lock-in |
| What decides the winner | One simulated game per matchup, drawn at the model's honest odds. Upsets happen, and the game accepts the luck. The simulation is **never rigged** toward the favourite |
| Reveal | About **20 seconds per game**, skippable: a scoreboard, the clock, and scoring plays |
| Streaks | Two. 🔥 **Play streak**: days played in a row. 🎯 **Hot streak**: correct picks in a row, across days |
| Stats | Wordle-style personal stats kept in the browser, plus crowd stats ("62% picked the Bulls", "41% went 3/3") shown only **after** lock-in |
| Ranked play, rating, global leaderboard | None. Friend groups may come later (out of scope) |
| Name and place | **Daily Three** at `/daily`, with a card on the home page. Subject to the F00 brand check |
| Day boundary | The player's local midnight. Puzzles are numbered (#1 is launch day) |
| Archive | None. Only today's game is playable |

### Interpretations to confirm in Session 1

The owner said "we can adjust as we go". These readings are constants in
code, not hard rules:

- **"Well-known" vs "known".** The pool has two tiers. `marquee` covers
  champions, the very-high-win teams, and owner pins. `known` is the rest of
  the pool.
- **Featured game.** It is marquee vs marquee, with no odds constraint.
  Famous teams usually land close anyway. It is game 3, the headliner (⭐).
- **"Toss-ups but more forgiving".** Games 1 and 2 use any pool teams whose
  favourite's neutral win probability is between **0.55 and 0.70**
  (`FORGIVING_BAND`). That is close enough to argue about, with a side to
  lean on.

## Open questions (owner to decide)

| # | Question | Recommendation | Decide by |
|---|---|---|---|
| Q1 | After the reveal, show the simulator's odds ("Upset! The simulator gave them 31%")? Never before the pick | Yes, after the reveal only. It explains upsets, so the luck feels fair | Session 3 |
| Q2 | If the player data has no starter flag, how should the starting five be defined? | Decide from Session 1's evidence (see "Starting five") | Session 1 |
| Q3 | Does missing a day reset the hot streak? | No. Only a wrong pick resets it; a missed day resets only the play streak | Session 2 |
| Q4 | Launch date (puzzle #1) | Set in Session 5, after the staging play-test | Session 5 |
| Q5 | The share text names the matchups, not the winners (spoiler-free, see "Share text"). The 2026-10-05 mock-up showed winners | Spoiler-free. Everyone gets the same simulated games, so naming winners spoils them for friends | Session 3 |

## The player's day

1. **Open `/daily`.** Three matchup cards, numbered 1 to 3. Game 3 is marked
   ⭐ Featured.
2. **Each card** shows the two teams side by side:
   - the era-correct name and season ("1995–96 Chicago Bulls");
   - the record (72–10);
   - the starting five, each with PPG and 1–2 signature stats.

   Team colours come from `data/team-colors.ts`, with no logos (brand gate).
   No probabilities, margins, or ratings appear.
3. **Pick a winner in each.** Picks can change until **Lock in**, which needs
   all three picks.
4. **Reveal.** The games play one after another, about 20 seconds each:
   - a scoreboard and a quarter clock;
   - a ticker of the last few scoring plays ("Jordan jumper, +2");
   - **Skip** (this game) and **Skip all**.

   With `prefers-reduced-motion`, the finals show at once. Each final shows the
   score, a points-only box line for the starters, and ✅ or ❌ for the
   player's pick.
5. **Results.** The panel shows:
   - the score out of 3 and both streaks;
   - a share button (Web Share API, falling back to the clipboard);
   - the stats panel;
   - crowd stats, if the API is available;
   - a countdown to the next puzzle (local midnight);
   - links into the explorer for each matchup (`/<a>-vs-<b>`).
6. **Coming back the same day** shows the finished state, with an optional
   "Watch again". A refresh during the reveal goes straight to results,
   because picks are stored at lock-in.

Every simulated game carries a visible label: *One simulated game. The
simulator plays each game at its odds, so upsets happen.*

### Share text

Spoiler-free (Q5). The squares say whether the sharer was right, not who won:

```
Daily Three #12 · 2/3
🟩 '96 Bulls vs '89 Pistons
🟥 '14 Spurs vs '01 Lakers
🟩 '17 Warriors vs '96 Bulls ⭐
🔥 12  🎯 5
courtofalltime.win/daily
```

Team order in a line follows `canonicalOrder` in `lib/slug.ts`. The text never
contains a probability or a margin.

### Personal stats and streaks

Stored in `localStorage` under `ct:daily:v1`. Every read and write is wrapped
in try/catch, and a missing or corrupt value starts fresh. Keyed by puzzle
number:

- **Played**: days locked in.
- **Pick accuracy**: correct picks / total picks.
- **Perfect days**: days with 3/3.
- **Distribution**: days at 0/3, 1/3, 2/3 and 3/3.
- **🔥 Play streak** (current and best): consecutive puzzle numbers locked
  in. A missed number resets it to 0 when the next one is played.
- **🎯 Hot streak** (current and best): consecutive correct picks in play
  order (day, then game 1 to 3). A wrong pick resets it to 0. A missed day
  does not reset it (Q3).

A streak counts when the player locks in, not when they watch the reveal.

## Matchup pool and tiers

`scripts/export_daily_data.py` (Session 1) builds the pool from the
regular-season data. All thresholds are named constants at the top of the
script.

| Rule | Definition | Tier |
|---|---|---|
| Champion | Won that season's Finals, from the last playoff game of the season in the raw games. The 2020 bubble Finals were played in October 2020; see "Gotchas" | marquee |
| Very high win | Regular-season win % ≥ `MARQUEE_WIN_PCT` (0.750, about 62 wins) | marquee |
| High win | Win % ≥ `POOL_WIN_PCT` (0.680, about 56 wins) | known |
| Notable star | A starter in the league's top `STAR_RANK` (5) for PPG, or top 3 for RPG or APG that season, on a team with win % ≥ 0.550 that made the playoffs | known |
| Owner pin / exclusion | `scripts/daily_pool_overrides.json` (committed) can pin a team to a tier, exclude a team, or fix a starting five | as pinned |

Use **win %**, never raw wins. The 1999, 2012, 2020 and 2021 seasons were
short.

For scale (measured 2026-10-05 from `index.json`): 117 team-seasons won 57+
games and 61 won 60+. That is about 6,800 possible pairings. At 3 a day the
schedule can run for years without repeating a pairing.

## Player data: starting fives and signature stats

The source is `data/raw/PlayerStatistics.csv`, from the Kaggle dataset the
pipeline already imports (`backend/scripts/import_dataset.py`). It is
gitignored, so Session 1 must run on a machine with `data/raw/`. Only the
**pool** teams get player data, not all 1,177.

### Starting five

**Session 1 first checks whether the file marks starters.** Then:

- **If there is a starter flag:** the starting five is the 5 players with the
  most starts for that team that season (ties broken by total minutes).
- **If there is no flag:** in each game, the team's 5 highest-minute players
  stand in for its starters. The season's five is the 5 players with the
  most such games (ties broken by total minutes). This proxy picks heavy-minute
  sixth men over real starters: Kukoč over Longley in 1996 and Ginóbili in his
  Spurs seasons. Report every pool team where the proxy and the known starters
  are likely to differ. The owner then chooses (Q2): fix those fives in the
  overrides file, or relabel the card "Top five" by minutes.

Only games played **for that team** count, so traded players are handled. A
player needs at least `MIN_TEAM_GAMES` (20) games for the team.

**Test fixtures** (`tests/test_daily_data.py`). Under either rule, after
overrides, these must come out as shown:

| Team-season | Starting five |
|---|---|
| `1986-celtics` | Danny Ainge, Dennis Johnson, Larry Bird, Kevin McHale, Robert Parish |
| `1996-bulls` | Ron Harper, Michael Jordan, Scottie Pippen, Dennis Rodman, Luc Longley |
| `2016-cavaliers` | Kyrie Irving, J.R. Smith, LeBron James, Kevin Love, Tristan Thompson |
| `2017-warriors` | Stephen Curry, Klay Thompson, Kevin Durant, Draymond Green, Zaza Pachulia |
| `2004-pistons` | Chauncey Billups, Richard Hamilton, Tayshaun Prince, Rasheed Wallace, Ben Wallace. Rasheed arrived in a February trade, so this case tests the overrides file |

### Signature stats

Every starter shows **PPG** first, then 1–2 signature stats, up to 3 stats
in total:

1. **Candidates:** RPG, APG, SPG, BPG, 3PM per game, FG% (at least 5 FGA per
   game) and 3P% (at least 2 3PA per game).
2. **Ranking:** each candidate's league percentile that season, among
   qualified players: at least half the team's games and 15 minutes per game.
3. **Selection:** the top 2 candidates at or above the 80th percentile. If
   none qualifies, show the best single one.

Expected results: Shaq gets RPG and BPG (or FG%), Curry gets 3PM, Rodman gets
RPG, and Jordan gets SPG.

Values display at one decimal place (percentages as `.521`). Names display
in full ("Michael Jordan"), shortened to an initial on narrow screens. Keep
names UTF-8 (Ginóbili, Jokić, Dončić) and keep suffixes (Jr., III).

## The simulated game

Pure TypeScript in `frontend/src/daily/sim.ts`. It is deterministic: every
browser shows the same game for the same puzzle.

1. **Seed:** `createRng("daily-three:" + engine + ":" + n + ":" + gameIndex)`
   from `tournament/prng.ts`. The day file pins `engine`, for example
   `"sim-v1"`.
2. **Winner:** team A wins if `rng() < p`, where `p` is A's exported neutral
   win probability against B. This is the only place the model decides
   anything, and it is never adjusted.
3. **Final score:**
   - Possessions come from both teams' pace, plus small noise.
   - Each team's expected points come from its offensive rating against the
     opponent's defensive rating.
   - The margin is drawn from a normal distribution centred on the exported
     margin `m`, with a standard deviation of 12. It is truncated to the
     winner's side and is at least 1 point.
   - Ties are impossible, and overtime is out of scope for `sim-v1`.
4. **Game flow:**
   - Split each team's points into 2s, 3s and free throws, using its three-point
     rate if Session 1 exports it, otherwise a fixed share.
   - Place the scoring plays across the 48 minutes with mild run clustering.
   - The running score must end exactly at the final score.
5. **Who scored:** each scoring play goes to a starter with probability
   proportional to their PPG. The rest goes to "Bench", weighted by team PPG
   minus the starters' PPG. The box line shows **points only** and is
   labelled as simulated.

**Never change a released engine's output.** Past puzzles' games must replay
identically, because shared results and stored stats depend on them. To change
the simulation, add `sim-v2` and use it only in day files not yet released.
Golden tests pin `sim-v1` outputs.

**The model-integrity gate still applies.** One simulated game's score is a
sample, not a prediction. Never present it, or `m`, as a precise margin (see
`lib/margin.ts`). If Q1 is accepted, the odds shown after the reveal use the
existing percentage formatting: never 100% or 0%.

## Data contract

All files are generated static data under `frontend/public/data/daily/`:

| File | Contents |
|---|---|
| `teams.json` | `{ generated, release, champions: { <season>: <key> }, teams: { <key>: { tier, reasons[], fiveFrom, wins, losses, pace, offRating, defRating, threeRate?, benchPpg, starters: [{ name, short, ppg, sig: [{ stat, value }] }] } } }` for pool teams only. `reasons` are `champion`, `very-high-win`, `high-win`, `notable-star`, `owner-pin`. `fiveFrom` is `starts`, `bench-points`, `minutes-proxy` or `override` (Session 1 record). `stat` is one of `RPG`, `APG`, `SPG`, `BPG`, `3PM`, `FG%`, `3P%`; percentages are fractions (0.574). Starters are in card order, guards to centers |
| `meta.json` | `{ launchDate, lastDay, engine }` |
| `days/<n>.json` | `{ n, date, engine, games: [{ a, b, p, m, featured }] }`. `a` and `b` are in canonical order, `p` is `a`'s neutral win probability, and `m` is `a`'s exported margin |

Puzzle number for the player's local date `d`: `n = calendarDaysBetween(launchDate, d) + 1`.
Count **calendar dates**, never milliseconds divided by 86,400,000, which
breaks across daylight-saving changes. If `n > lastDay`, the page says
today's game isn't ready yet. That must never happen; the verifier guards
against it.

`p` and `m` are in the day file, so a determined player can read them. That
is acceptable for an unranked game. The rule is that **the UI** never shows
them before lock-in.

### Schedule rules (`scripts/build_daily_schedule.py`)

- Game 3 is featured: marquee vs marquee. Games 1–2 have a favourite inside
  `FORGIVING_BAND`.
- No unordered pairing may appear twice anywhere in the schedule's history.
- No team-season key may appear twice within any 7 consecutive days,
  including twice on the same day.
- Choices are seeded and deterministic (`--seed`), so a rebuild with the same
  inputs is byte-identical.
- **Released days are frozen.** The builder refuses to rewrite any day dated
  before *today + 2* (that covers UTC+14). It only appends or regenerates
  later days. Before launch (Q4), every day may be regenerated.
- Generate about a year at a time. `scripts/verify_daily_data.py` checks:
  - every rule above, over the whole history;
  - that every key exists in `index.json` and `teams.json`;
  - that `p` and `m` match the current team files;
  - that `lastDay` is at least `MIN_DAYS_AHEAD` (60) days after today. Below
    that it fails, as a reminder to extend.

**Annual data refresh** (HANDOFF decision 14). After the Finals, re-run the
export so the new season's teams join the pool, then regenerate unreleased
days only. If a new release changes `p` for a matchup on a released day,
that day keeps its stored `p`. The verifier checks `p` against the team files
for unreleased days only.

## Crowd stats (Worker)

This is optional for the game. The page works fully with the API missing or
failing, and then hides the crowd lines.

- **Migration `worker/migrations/0007_daily.sql`:**
  `daily_results(n INTEGER, client_id TEXT, picks TEXT, score INTEGER, created_at INTEGER, PRIMARY KEY (n, client_id))`.
- **`POST /v1/daily/:n/result`** with `{ clientId, picks: [0|1, 0|1, 0|1], score }`:
  - `clientId` is a random id the browser makes once (`crypto.randomUUID()`),
    stored next to the stats. It is not tied to an account, and it is not
    personal data.
  - `n` must be within today's UTC puzzle number ± 1 (time zones).
  - `score` must be 0 to 3.
  - A duplicate `(n, clientId)` is ignored.
  - Rate-limited through `ratelimit.ts`, like the guest routes.
- **`GET /v1/daily/:n/stats`** returns `{ players, picks: [[a, b] × 3], scores: [s0, s1, s2, s3] }`.
  Edge-cached for 60 seconds (`LEADERBOARD_CACHE_SECONDS` pattern).
- **The client** posts once at lock-in and fetches stats after the reveal.
  Crowd lines appear **only after lock-in**, or they become a hint.
- **Unverified scores.** The client reports its own score. Without a
  leaderboard, a fake score only skews the "went 3/3" line. Accept that and
  note it on the About page.
- **Retention.** Distinct `client_id` per `n`, and how many of them come back
  for `n + 1` and `n + 7`, is the success measure. Cloudflare Web Analytics
  has no events.
- **About page:** a short privacy paragraph saying daily picks are sent with
  a random browser id and nothing else.

## Build flag and staging flow

Daily Three ships **behind a build flag** until launch, so every session can
merge to `main` without going live:

- `VITE_DAILY_THREE=1` turns on the `/daily` route, the home-page card, and
  the nav link. If it is unset, the route is not registered, and `/daily`
  falls through to the `:matchupSlug` route's existing "not a matchup" state.
  Register `daily` before `:matchupSlug` in `App.tsx`.
- Follow the pattern in `frontend/buildEnv.ts`. Set the variable in the
  Pages **preview** environment, which covers PR previews and the `staging`
  branch. Do **not** set it in production until Session 5.

Each session runs like this:

1. Branch from `main` (`f12-s1-pool`, `f12-s2-engine`, and so on) and run "How
   to verify".
2. Open a PR. The owner reviews the static game on its **Pages preview link**.
3. After the owner approves, merge. The flag keeps production unchanged.
4. Bring staging up to date with `git push origin main:staging`.
   `staging.courtofalltime.win` then has the game. From Session 4 on, it also
   has crowd stats against `api-staging.courtofalltime.win`.

Worker changes reach staging first. Back up the staging D1 database
(`DEPLOYMENT.md` rules), apply the migration with `--env staging`, and deploy
with `npx wrangler deploy --env staging`. Production Worker steps wait for
Session 5 and the owner's OK.

## Out of scope

- An archive of past days, practice or unlimited mode, accounts, friend
  leaderboards, and push or email reminders. Each is a later brief if
  retention is good.
- Ranked play or rating of any kind.
- Any change to the model, the release, the exported team files, duel mode,
  or the duel pool. This brief only **reads** `frontend/public/data/teams/*.json`
  and `index.json`.
- Player photos, logos, or anything implying an official relationship (brand
  gate). The name must not use "Wordle", and the tiles must not copy the NYT
  look.
- Overtime and player stats beyond points in the simulated box line.
- Anything commercial.

## Session plan

Each session ends in a verifiable state, opens its own PR, and adds a record
to "Handoff records" at the end of this brief.

### Session 1: the pool and player data (no UI)

**Goal.** A reviewed pool of great teams, each with a starting five and
signature stats.

1. **Inspect `PlayerStatistics.csv`.** Record its columns, whether it has a
   starter flag, and whether it has a position. Check that 1985–86 to 2025–26
   are present.
2. **Write `scripts/export_daily_data.py`.** Follow the script conventions in
   `CONTRIBUTING.md`. It writes `frontend/public/data/daily/teams.json` and
   reads `index.json` for keys and records, so its keys always match the
   site. Then:
   - derive the champions;
   - apply the pool rules and tiers;
   - apply `scripts/daily_pool_overrides.json` (start it empty, then add the
     fixes the fixtures need).
3. **Write `tests/test_daily_data.py`.** It covers:
   - the starting-five fixtures;
   - pool rules, with no duplicate keys and every key in `index.json`;
   - the signature-stat rules;
   - the champions list.
4. **Write `reports/daily_pool.md`:**
   - the champions by season, for the owner to check;
   - the pool by tier, with the reason each team is in;
   - every starting five and its signature stats;
   - the teams where the starter rule is uncertain.

**Stop for the owner:** review the report in the PR and decide Q2, along with
any pins or exclusions.

**Done when:** the owner approves the pool, the tests pass, and the PR is
merged.

**Kickoff prompt:**

```text
Implement F12 Session 1 (Daily Three: pool and player data). Read
CONTRIBUTING.md, docs/product/HANDOFF.md, docs/product/DEPLOYMENT.md and
docs/product/features/F12-daily-three.md. Work on a branch from main. Inspect
PlayerStatistics.csv for a starter flag first, then build
scripts/export_daily_data.py, tests/test_daily_data.py and
reports/daily_pool.md as the brief describes. Open a PR and stop for my
review of the pool and the starting-five rule (Q2). Fill in Session 1's
handoff record.
```

### Session 2: the schedule and the game engine (no UI)

**Goal.** Day files exist, and the game's logic is complete and tested in pure
TypeScript.

1. Write `scripts/build_daily_schedule.py` and
   `scripts/verify_daily_data.py`. They produce `meta.json` and `days/<n>.json`
   for about a year, from a placeholder `launchDate`.
2. Write `frontend/src/daily/`, with no React in it:
   - `types.ts`;
   - `day.ts` (local date to puzzle number, using calendar dates);
   - `sim.ts` (the simulated game, `sim-v1`);
   - `stats.ts` (a pure reducer for stats and both streaks);
   - `share.ts` (the share text).
3. Vitest tests:
   - The same seed gives the same game, and golden outputs pin `sim-v1`.
   - Over 10,000 seeds, the winner rate stays within 1.5 points of `p`.
   - The running score ends at the final, the winner leads at the end, and
     the starters' points never exceed the team's.
   - Puzzle numbering holds across daylight-saving changes and in UTC−12 and
     UTC+14.
   - Streaks: a missed day, a wrong pick, perfect days, and a corrupt store.
   - The share text has no probability, no margin, and no winner.
4. Record the owner's answer to Q3.

**Done when:** the verifier passes, every test passes, and the PR is merged.
There is still no page.

**Kickoff prompt:**

```text
Implement F12 Session 2 (Daily Three: schedule and engine). Read the files
listed at the top of docs/product/features/F12-daily-three.md, plus Session 1's
handoff record. Work on a branch from main. Build the schedule builder and
verifier, and the pure TypeScript game engine in frontend/src/daily/ with the
tests the brief lists. No UI. Ask me Q3 (hot streak and missed days) if it is
still open. Open a PR and fill in Session 2's handoff record.
```

### Session 3: the `/daily` page

**Goal.** The full game is playable on the PR's preview link, behind
`VITE_DAILY_THREE`.

1. Add the build flag (the `buildEnv.ts` pattern, with tests). Ask the owner
   to set `VITE_DAILY_THREE=1` in the Pages preview environment.
2. Build `pages/DailyPage.tsx` and its components:
   - the matchup cards, picks, and lock-in;
   - the reveal (about 20 seconds, Skip, Skip all, reduced motion);
   - the results, share, and stats panels;
   - the countdown;
   - explorer links.

   It must work at 375 px width, in both themes, and by keyboard. Screen
   readers get the final score as text.
3. Add the home-page card and the nav link, both behind the flag.
4. Playwright tests (with the date pinned through the clock API):
   - a full play-through;
   - a refresh mid-reveal that lands on results;
   - a second day that extends the streak;
   - a skipped day that resets the play streak;
   - the share text;
   - with the flag off, `/daily` is absent.
5. Record the owner's answers to Q1 and Q5.

**Stop for the owner:** play the game on the PR preview and approve the merge.

**Done when:** the owner approves, the PR is merged, and `main` has been pushed
to `staging`.

**Kickoff prompt:**

```text
Implement F12 Session 3 (Daily Three: the /daily page). Read the files listed
at the top of docs/product/features/F12-daily-three.md, plus the Session 1-2
handoff records. Work on a branch from main. Build the page behind
VITE_DAILY_THREE with the Playwright tests the brief lists, and ask me Q1 and
Q5. Open a PR and stop for me to play it on the preview link. After I approve,
merge it and push main to staging. Fill in Session 3's handoff record.
```

### Session 4: crowd stats on staging

**Goal.** Crowd stats work end to end on `staging.courtofalltime.win`.

1. Add the migration, the two routes, rate limits, caching, and Worker tests
   (`cd worker && npm test`).
2. Integrate the frontend: post at lock-in, fetch after the reveal, hide on
   any error or when the API is unset. Add the About page privacy paragraph.
3. Staging:
   - back up the staging D1 database;
   - `npx wrangler d1 migrations apply DB --remote --env staging`;
   - `npx wrangler deploy --env staging`;
   - after merging, `git push origin main:staging`.
4. Play-test on staging from 2–3 browsers. Check that each browser counts once
   per day, that the crowd lines appear only after lock-in, and that the game
   still works with `api-staging.*` blocked in devtools.

**Done when:** the staging play-test passes, the Worker and frontend tests
pass, and the record lists what was deployed to staging.

**Kickoff prompt:**

```text
Implement F12 Session 4 (Daily Three: crowd stats on staging). Read the files
listed at the top of docs/product/features/F12-daily-three.md (including the
Worker sections of F09-continuation-handoff.md), plus the Session 1-3 handoff
records. Work on a branch from main. Add the migration and routes, integrate
the frontend, deploy to the staging Worker after backing up staging D1, merge,
push main to staging, and play-test on staging.courtofalltime.win. Production
is untouched. Fill in Session 4's handoff record.
```

### Session 5: launch

**Goal.** Daily Three is live on `courtofalltime.win`.

1. Get the owner's launch date (Q4). Rebuild the schedule from it, since
   nothing is released yet, and confirm `lastDay` is at least 90 days out.
2. Production crowd stats need the production Worker (`DEPLOYMENT.md` phase
   3). If phase 3 is not done, launch without crowd stats; the page hides
   them.
3. **Stop and ask** before each live step:
   - back up production D1 and apply the migration;
   - deploy the production Worker;
   - set `VITE_DAILY_THREE=1` in the production Pages environment and
     redeploy.
4. Check the live site: today's puzzle, the share text, the stats, and the
   explorer, unchanged.
5. Add a reminder to extend the schedule before `lastDay`. Also document the
   annual refresh steps in this brief's record.

**Rollback:** remove `VITE_DAILY_THREE` from production and redeploy. The
crowd-stats routes can stay, since nothing calls them.

**Kickoff prompt:**

```text
Implement F12 Session 5 (Daily Three: launch). Read the files listed at the
top of docs/product/features/F12-daily-three.md, plus every handoff record.
Ask me for the launch date (Q4), rebuild the schedule from it, and stop for
my OK before each production step: the D1 migration, the Worker deploy, and
setting VITE_DAILY_THREE in production. Check the live site and fill in
Session 5's record.
```

## How to verify (every code session)

```
cd frontend && npm run build && npm run lint && npm test && npx playwright test
cd worker && npx tsc --noEmit && npm test
python -m pytest tests
python src/models/test_pregame_leakage.py        # must exit 0 (nothing here should change it)
python scripts/verify_static_export.py           # the explorer's data is untouched
python scripts/verify_daily_data.py              # Session 2 on
```

## Gotchas to expect

- **Season labels.** Every script treats a game in October or later as the
  next season. That labels the October 2020 bubble Finals games as 2021, so a
  naive "last playoff game of the season" makes the wrong 2020 and 2021
  champions. Use the historical simulator's playoff rule
  (`assign_season_playoffs_by_year`, `CONTRIBUTING.md` "Known gotchas") and
  check the champions list by eye.
- **Blank `gameType`** in 2000–01 and 2021–22 (`CONTRIBUTING.md`). Fill game
  types from `Games.csv` as the historical simulator does
  (`fill_game_types=True`), or the regular-season player averages for those
  seasons will be wrong.
- **Mixed date formats** in `gameDateTimeEst`. Use
  `pd.to_datetime(..., format="mixed")`.
- **Python file encoding.** Read and write with `encoding="utf-8"`. Player
  names have accents, and cp1252 has truncated files here before.
- **Team identity.** Use the export `key` (`1996-bulls`) and the era-correct
  name from `index.json`, never a current nickname. A Bullets season is
  `…-bullets`.
- **Determinism.** Use only `tournament/prng.ts` in the simulation. No
  `Math.random()`, and nothing that varies by engine.
- **Time zones.** Two players can be on different puzzle numbers at the same
  moment. The Worker accepts `n ± 1` around UTC for that reason.
- **Long jobs on Windows.** See `CONTRIBUTING.md` if a player-data build runs
  long.

## Handoff records

_(Each session adds its record here: what changed, the numbers, the owner's
decisions, what was deployed where, and anything that differed from this
plan.)_

### Session 1: the pool and player data (2026-10-06)

Branch `f12-s1-pool`. No UI, nothing deployed.

**What was built**

- `scripts/export_daily_data.py` writes `frontend/public/data/daily/teams.json`
  (219 KB, compact JSON) and `reports/daily_pool.md`. It takes about 25
  seconds and is deterministic: the rebuild test re-runs it and matches the
  committed file.
- `scripts/daily_pool_overrides.json` fixes three fives (below). It has no
  pins and no exclusions.
- `tests/test_daily_data.py` has 37 tests:
  - unit tests on synthetic frames for every rule;
  - artifact tests on the committed `teams.json`: the 5 fixtures, the pool
    rules, champions, and signature stats;
  - a rebuild test, skipped without `data/raw/`.

**The pool:** 289 team-seasons.

| Tier | Teams | Notes |
|---|---|---|
| Marquee | 67 | Every champion 1985–86 to 2025–26, plus win % ≥ .750 |
| Known | 222 | 128 of these get in **only** through the notable-star rule |

That gives 41,616 pairings, 2,211 of them marquee vs marquee (about 6 years of
featured games). All 41 champions came out right against the known list for
1985–86 to 2024–25, including the 2020 bubble. The data gives **2025–26 to the
Knicks** (Finals Game 5, 94–90 at San Antonio). The owner should confirm that
one.

**Q2 evidence: the starter flag (step 1).** `PlayerStatistics.csv` has one
starter column, `startingPosition` (G/F/C), and no other position column.
`Players.csv` has guard/forward/center flags, which are used only to order the
card. Every season 1985–86 to 2025–26 is present. The flag is reliable only
for **2017–18 to 2025–26, minus 2021–22**: exactly 5 per team-game. Elsewhere:
- **1996–97 to 2016–17:** the column is filled for about 9 players per
  team-game (Shaq appears as "G"), so it is not a starter flag.
- **Before 1996–97, and in 2021–22:** the column is blank.

So most of the pool needs another rule, and the flagged seasons let us score
any rule against the truth (240 team-seasons):

| Rule | Exact five | 1 wrong | 2+ wrong |
|---|---|---|---|
| The brief's minutes proxy | 39% | 53% | 8% |
| **Bench-points inference** (new) | **95%** | 5% | 0% |

Bench-points inference uses `TeamStatisticsExtended.csv`, which records bench
points per game. The starters' points must add up to team score minus bench
points. Of the 5-player subsets that do, the rule takes the one with the most
minutes. A second pass then prefers players the first pass usually started.

A position-balance constraint (G/F/C flags) was also tried on the proxy. It
did not help, so it was dropped.

Bench points are usable only from **2003–04**: before that the column holds
the whole team score. Each season uses the first rule it supports:

| Rule | Seasons | Pool teams |
|---|---|---|
| Starter flag | 2017–18 on, except 2021–22 | 56 |
| Bench-points inference | 2003–04 to 2016–17 | 99 |
| Minutes proxy | 1985–86 to 2002–03, and 2021–22 | 134, **28 of them marquee** |

The report lists every proxy five next to its 6th man, for checking by eye.

**Differences from this brief**

- **Three rules, not two.** Bench-points inference is new. It is driven by
  the measurement above.
- **The 1996 Bulls proxy drops Harper, not Longley.** Kukoč (51 games in the
  top 5 by minutes) beats Ron Harper (38). The brief predicted Longley.
- **The fixtures need three overrides:**
  - **1996 Bulls:** Harper for Kukoč, because the proxy is wrong.
  - **2004 Pistons:** Rasheed Wallace, as the brief expected. He played 22
    games for Detroit.
  - **2016 Cavaliers:** Tristan Thompson for Mozgov. Mozgov really did start
    more regular-season games (about 48 to 34), but Thompson started the
    playoffs.
  - The 1986 Celtics and 2017 Warriors (Pachulia) come out right with no help.
- **Names come as the source spells them.** It writes "JR Smith" without dots
  and drops accents ("Toni Kukoc", "Manu Ginobili", "Nikola Jokic"). No pool
  starter has a non-ASCII letter. The fixture test uses "JR Smith". Accents
  could only be restored by hand.
- **Interface additions** to `teams.json`, now in the data contract above:
  - `release`, copied from `index.json`;
  - a top-level `champions` map;
  - `fiveFrom` per team, so Session 3 can label proxy cards differently if Q2
    asks for that.

  `threeRate` (team 3PA/FGA) is exported. `benchPpg` is the team's points per
  game not scored by the five.
- **Data handling the brief didn't anticipate:**
  - Regular season is decided by game id (prefix 2). That includes NBA Cup
    group and knockout games, which the player file labels "NBA Emirates Cup"
    but which count in the standings.
  - About half of 2000–01's player rows have no team id. They are matched by
    the era-correct team name.
  - About 2,000 rows give minutes as "MM:SS".
  - 4 team-seasons are missing up to 2 games in the player file. None is in
    the pool.
- **Signature stats are league-relative.** A 1980s guard's 0.3 threes a game
  can clear the 80th percentile (Danny Ainge, 1986). The brief's expectations
  hold:
  - Shaq: FG% and RPG;
  - Curry: 3PM;
  - Rodman: RPG;
  - Jordan: SPG.

**Verification:** see the PR description for the full "How to verify" run.

**For the owner to decide (stop point)**

1. **Q2: the 134 proxy fives.** Recommendation: a hybrid.
   - Fix the **28 marquee** proxy fives in the overrides file first. Every
     featured game draws from them.
   - Have Session 3 label the remaining known-tier proxy cards "Top five" (by
     minutes) through `fiveFrom` until they are fixed. Keep "Starting five"
     for flag, bench-points and override cards.

   The alternatives:
   - fix all 134 by hand;
   - label every proxy card "Top five".
2. **The notable-star rule** adds 128 teams on its own, 44% of the pool.
   Keep it, or tighten `STAR_PPG_RANK` / `STAR_TEAM_WIN_PCT`?
3. **The 2025–26 Knicks** as champion, and any pins or exclusions.
