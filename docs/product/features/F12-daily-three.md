# F12: Daily Three (a daily pick'em with simulated games)

Status: **Sessions 1–3 merged (PR #18 and PR #19 on 2026-10-07, PR #22 on
2026-10-10), and staging is up to date with `main`. The `/daily` page is
built behind `VITE_DAILY_THREE`, which is off in production. Session 4 (crowd
stats on staging) is next. Before launch (Session 5) the owner still has to
accept the Basketball-Reference data rights.** Decided with the owner on
2026-10-05.

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
score out of 3, two streaks, personal stats, and a share text naming the
day's simulated winners (Q5).

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
| Q1 | After the reveal, show the simulator's odds ("Upset! The simulator gave them 31%")? Never before the pick | **Decided 2026-10-10: yes, after each game's final only.** The page names "the model" and gives the winner's chance as a whole percent that never reads 0% or 100% ("Upset! The model gave the 2020–21 Trail Blazers 42%."). The margin is never shown | Session 3 |
| Q2 | If the player data has no starter flag, how should the starting five be defined? | **Mostly answered by the data (owner, 2026-10-06):** games started from Basketball-Reference (`sumitrodatta/nba-aba-baa-stats`) for every season. Still open: accepting that source's rights, and the 1997–98 Bulls (Kukoč over an injured Pippen). See Session 1's record | Session 1 |
| Q3 | Does missing a day reset the hot streak? | **Decided 2026-10-07: no.** Only a wrong pick resets it; a missed day resets only the play streak (`MISSED_DAY_RESETS_HOT_STREAK = false` in `daily/stats.ts`) | Session 2 |
| Q4 | Launch date (puzzle #1) | Set in Session 5, after the staging play-test | Session 5 |
| Q5 | The share text names the matchups, not the winners (spoiler-free, see "Share text"). The 2026-10-05 mock-up showed winners | **Decided 2026-10-10: name the winners, with the final score.** The recommendation was spoiler-free; the owner chose winners and scores (see "Share text") | Session 3 |

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

Q5, decided by the owner on 2026-10-10: each line names the simulated winner
and the final score, and its square says whether the sharer was right. (The
brief first planned a spoiler-free text; the owner chose winners and scores.)

```
Daily Three #12 · 2/3
🟩 '96 Bulls beat '89 Pistons 104–92
🟥 '14 Spurs beat '01 Lakers 101–97
🟩 '17 Warriors beat '96 Bulls 112–108 ⭐
🔥 12  🎯 5
courtofalltime.win/daily
```

The games keep the day file's order, and the winner leads each line. The text
never contains the model's probability or its margin `m`; the score is one
simulated game's.

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
  does not reset it (Q3, decided by the owner on 2026-10-07).

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

> **Superseded (2026-10-07).** The owner chose games started from
> Basketball-Reference for every season: the 5 players with the most games
> started for the team (ties by minutes, `MIN_TEAM_GAMES` still applies).
> See Session 1's record. The plan as first written follows.

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
| `teams.json` | `{ generated, release, champions: { <season>: <key> }, teams: { <key>: { tier, reasons[], fiveFrom, wins, losses, pace, offRating, defRating, threeRate?, benchPpg, starters: [{ name, short, ppg, sig: [{ stat, value }] }] } } }` for pool teams only. `reasons` are `champion`, `very-high-win`, `high-win`, `notable-star`, `owner-pin`. `fiveFrom` is `games-started` or `override` (Session 1 record). Names use Basketball-Reference's spelling, with accents. `stat` is one of `RPG`, `APG`, `SPG`, `BPG`, `3PM`, `FG%`, `3P%`; percentages are fractions (0.574). Starters are in card order, guards to centers |
| `meta.json` | `{ launchDate, lastDay, engine, launched }`. `launched` (added in Session 2) is `false` until Session 5. While it is false, every day may be regenerated; once true, released days are frozen and the launch date is fixed |
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
- No game pairs two teams from the same season (`MIN_SEASON_GAP` = 1;
  owner, 2026-10-07). Every matchup is cross-era.
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

### Session 1: the pool and player data (2026-10-06, reworked 2026-10-07)

Branch `f12-s1-pool`, PR #18 (merged 2026-10-07). No UI, nothing deployed.

The first version (2026-10-06) picked starting fives with three rules, because
`PlayerStatistics.csv` marks starters only in some seasons. On 2026-10-06 the
owner looked at the evidence and chose to take **games started (GS) from
Basketball-Reference** for every season instead, through the Kaggle dataset
`sumitrodatta/nba-aba-baa-stats`. The rework (2026-10-07) is below; the first
version's evidence follows it, because it is now the cross-check.

**What was built**

- `backend/scripts/import_bbref_dataset.py` downloads
  `sumitrodatta/nba-aba-baa-stats` ("NBA Stats (1947-present)") into the
  gitignored `data/raw/bbref/`, with the same Kaggle credentials as
  `import_dataset.py`. The export reads two files from it: `Player Totals.csv`
  (games, GS and minutes per player per team-season) and `Team Abbrev.csv`.
- `scripts/export_daily_data.py` writes `frontend/public/data/daily/teams.json`
  (219 KB, compact JSON) and `reports/daily_pool.md`. It takes about 30
  seconds and is deterministic: the rebuild test re-runs it and matches the
  committed file.
- `scripts/daily_pool_overrides.json` fixes two fives (below). It has no pins
  and no exclusions.
- `tests/test_daily_data.py` has 53 tests:
  - unit tests on synthetic frames for every rule, including the GS pick,
    name matching and the team mapping;
  - artifact tests on the committed `teams.json`: the 5 fixtures, the pool
    rules, champions, signature stats and name spelling;
  - a rebuild test, skipped without `data/raw/` or `data/raw/bbref/`.

**The starting-five rule (Q2, rework).** A team's five is its 5 players with
the most games started that season (ties by minutes). A player needs
`MIN_TEAM_GAMES` (20) games for the team, and a traded player's
Basketball-Reference rows count per team; the 2TM/3TM season totals are
ignored. `fiveFrom` is `games-started`, or `override` for the overrides file.

- **Teams** map to Basketball-Reference abbreviations by era-correct city and
  name, falling back to the nickname (the 2006 and 2007 Oklahoma City Hornets,
  the 2026 LA Clippers). All 1,177 team-seasons map to exactly one; anything
  else raises.
- **Players** match `PlayerStatistics.csv` within the team-season by a
  normalised name: accents (NFKD) and punctuation dropped, Jr./Sr./II–IV
  ignored. That covers "J.R. Smith" / "JR Smith" and "Kukoč" / "Kukoc". The
  rest go through `NAME_ALIASES`, which has **39** entries, more than the
  "small table" expected. Most are 1980s–90s spellings: "Fat Lever" /
  "Lafayette Lever", "Steve Smith" / "Steven Smith", "Clarence Weatherspoon" /
  "Clar. Weatherspoon", "Nenê" / "Nene Hilario", and reversed Chinese names.
  When two players share a name (the 1989 Bullets' two Charles Joneses), games
  played tells them apart. Every starter must match exactly one player, or the
  script raises. No player in any team's top 8 by GS is unmatched.
- **Cards** use Basketball-Reference's spelling, so names now carry their
  accents: Kukoč, Ginóbili, Jokić, Dončić, Porziņģis and 13 more pool
  starters. PPG and signature stats still come from `PlayerStatistics.csv`.

**Agreement with the first version.** These are pool teams, compared with the
five the first version's rule gave them, before overrides:

| First version's rule | Pool teams | Same five as GS |
|---|---|---|
| Starter flag (2017–18 on, not 2021–22) | 56 | **56** |
| Bench-points inference (2003–04 to 2016–17) | 99 | **98**. The one difference is the 2016 Raptors: James Johnson (32 GS) over Norman Powell (24) |
| Minutes proxy (1985–86 to 2002–03, 2021–22) | 133 | **60** |

Across all 1,177 team-seasons, GS agrees with the flag in 239 of 240, with
bench points in 614 of 659, and with the proxy in 481 of 1,177. The probe
before the rework counted 93/97 and 57/133. It compared names without the
alias table, so Nenê (three teams), Fat Lever and Steve Smith (two teams)
counted as changes. The real numbers are 96/97 (98/99 including the two
override teams) and 60/133.

So **74 pool fives change** from the first version's rule: 73 proxy fives and
the 2016 Raptors. That includes `1996-bulls`, whose card was already fixed by
override to the GS five, so **73 cards change**. One team leaves the pool:
`1990-mavericks` was in only for Roy Tarpley's RPG rank. Its GS five doesn't
include him, so the notable-star rule no longer applies.

**The pool:** 288 team-seasons (was 289).

| Tier | Teams | Notes |
|---|---|---|
| Marquee | 67 | Every champion 1985–86 to 2025–26, plus win % ≥ .750 |
| Known | 221 | 127 of these get in **only** through the notable-star rule |

That gives 41,328 pairings, 2,211 of them marquee vs marquee (about 6 years of
featured games). All 41 champions came out right against the known list for
1985–86 to 2024–25, including the 2020 bubble. The data gives **2025–26 to the
Knicks** (Finals Game 5, 94–90 at San Antonio). The owner should confirm that
one.

**Overrides**

- **1996 Bulls: removed.** GS gives Harper 80, Jordan 82, Pippen 77, Longley 62
  and Rodman 57, against Kukoč's 20.
- **2004 Pistons: kept.** Rasheed Wallace started 21 of his 22 games for
  Detroit, against Mehmet Okur's 33 over the season.
- **2016 Cavaliers: kept, as a deliberate playoff-five choice.** Mozgov
  started 48 games to Tristan Thompson's 34, but Thompson started the playoffs
  and the Finals. The fixture now spells "J.R. Smith".
- **1997–98 Bulls: not overridden.** GS takes Kukoč (52) over Scottie Pippen
  (44, injured for the first half). This is listed for the owner.

The famous fives were checked by eye in the report:
- 1986 Celtics: Johnson, Ainge, Bird, McHale, Parish.
- 1996 Bulls: as above.
- 2000 Lakers: Harper, Bryant, Rice, Green, O'Neal.
- 1989 Pistons: Thomas, Dumars, Dantley, Mahorn, Laimbeer. Dantley started 42
  games before the Aguirre trade, and Aguirre has 32 GS.
- 2017 Warriors: Pachulia at center.
- 2022 Warriors: Curry, Poole, Wiggins, Green, Looney. Klay Thompson came back
  in January, so he has 32 GS to Green's 44.

The report lists:
- 86 GS close calls, where the 5th and 6th are within 15% of team games. Three
  are exact ties broken by minutes: the 2022 Grizzlies, 2024 Mavericks and
  2025 Celtics.
- Every pool team where a top-3 scorer misses the five.

**Data rights (owner to accept before launch).** The GS data is scraped from
Basketball-Reference. Sports Reference's terms forbid scraping and any public
or commercial use of its data without written permission. Kaggle's CC0 label
is the uploader's and does not clear that.
- `teams.json` carries no Basketball-Reference number. The choice of each five
  and the name spelling come from it.
- This joins the F00 commercial-data question (HANDOFF "Commercial-data gate",
  now noted there). It is stricter than that gate, because it covers public,
  non-commercial use too.

**First version's evidence (now the cross-check).** `PlayerStatistics.csv`
has one starter column, `startingPosition` (G/F/C), and no other position
column. `Players.csv` has guard/forward/center flags, which are used only to
order the card. The flag is reliable only for **2017–18 to 2025–26, minus
2021–22**: exactly 5 per team-game. From 1996–97 to 2016–17 it is filled for
about 9 players per team-game, and before that it is blank. Scored against
the flag (240 team-seasons):
- the minutes proxy picked the exact five 39% of the time;
- bench-points inference picked it 95% of the time.

Bench-points inference uses `TeamStatisticsExtended.csv`. A team's starters'
points must add up to its score minus its bench points. That works from
2003–04; from 1996–97 to 2002–03 the column holds the whole team score. Both
rules are still computed, only for the report's cross-check tables.

**Interface additions** to `teams.json`, in the data contract above:
- `release`, copied from `index.json`;
- a top-level `champions` map;
- `fiveFrom` per team.

`threeRate` (team 3PA/FGA) is exported. `benchPpg` is the team's points per
game not scored by the five.

**Data handling the brief didn't anticipate**
- Regular season is decided by game id (prefix 2). That includes NBA Cup
  group and knockout games, which the player file labels "NBA Emirates Cup"
  but which count in the standings.
- About half of 2000–01's player rows have no team id. They are matched by
  the era-correct team name.
- About 2,000 rows give minutes as "MM:SS".
- 4 team-seasons are missing up to 2 games in the player file. None is in the
  pool.
- Signature stats are league-relative. A 1980s guard's 0.3 threes a game can
  clear the 80th percentile (Danny Ainge, 1986). The brief's expectations
  hold: Shaq gets FG% and RPG, Curry 3PM, Rodman RPG, and Jordan SPG.

**Verification:** see the PR description for the full "How to verify" run.

**For the owner to decide (stop point)**

1. **The data rights.** Accept Basketball-Reference-derived fives and spelling
   for a public launch, or get permission from Sports Reference. This joins
   F00.
2. ~~**The 1997–98 Bulls.** Keep Kukoč (GS), or override to Pippen?~~
   **Decided 2026-10-07: keep Kukoč**, the games-started five. No override.
3. ~~**The notable-star rule** adds 127 teams on its own, 44% of the pool. Keep
   it, or tighten `STAR_PPG_RANK` / `STAR_TEAM_WIN_PCT`?~~ **Decided
   2026-10-07: keep it as is.** The owner chose the deeper pool with
   famous-player teams (young Jordan, early Shaq, Iverson, Westbrook) over
   tightening it.
4. ~~**The 2025–26 Knicks** as champion, and any pins or exclusions.~~
   **Decided 2026-10-07: the Knicks are confirmed.** No pins or exclusions.

Still open: decision 1, the data rights. It blocks the launch (Session 5),
not the merge.

### Session 2: the schedule and the game engine (2026-10-07)

Branch `f12-s2-engine`, PR #19, merged to `main` on 2026-10-07 (merge commit
`ed07d5c`). No UI. Merging changed nothing visible: it adds data files under
`public/data/daily/` and code that no page imports yet.

**Staging (2026-10-07).** At the owner's request, the `staging` branch was
brought up to date with `main` through a PR into `staging` (branch
`f12-s2-staging`: `main` plus this record).
- Before that, staging stopped at PR #13. The update also brought F11 (older
  seasons), the logo, the pricing-page removal (F10), the F12 brief, and F12
  Sessions 1–2.
- The only `worker/` change in that range is `scripts/load-test.mjs`, so the
  staging Worker needed no redeploy.
- On `staging.courtofalltime.win`, F12 adds only static files under
  `/data/daily/` (for example `/data/daily/meta.json`). There is no page yet.
- The owner checks staging, then carries the result into `HANDOFF.md`.

**What was built**

- `scripts/build_daily_schedule.py` writes `daily/meta.json` and
  `daily/days/1.json` .. `365.json` (525 KB in all) in about 3 seconds:
  - **Placeholder launch date `2026-10-01`** (`PLACEHOLDER_LAUNCH_DATE`), so
    today's puzzle exists on the Session 3 preview. 365 days run to
    2027-09-30. Q4 replaces the date in Session 5.
  - **Seeded per day** (`"daily-three:<seed>:<n>"`, default seed `20261007`).
    A day depends only on the seed, the pool, the team files and the days
    before it. So a rebuild is byte-identical, extending keeps every earlier
    day, and re-running after days are frozen reproduces the rest.
  - The featured game is drawn first, from marquee teams. Games 1 and 2
    then come from teams whose favourite is inside `FORGIVING_BAND`.
  - Within each draw, the **least-used teams come first**, so the pool is
    used evenly.
  - **Released days.** `meta.json` gained `launched` (data contract above).
    While it is false, any day may be regenerated. `--launch` sets it in
    Session 5. From then on the builder keeps every existing day dated before
    *today + 2* exactly as stored (tested with a hand-edited day). It also
    refuses to change the launch date or drop a released day.
- `scripts/verify_daily_data.py` checks every rule in "Schedule rules" over the
  whole history:
  - the file set is exactly days 1..`lastDay`, with each day's `n`, date and
    engine;
  - only game 3 is featured, and it is marquee vs marquee; games 1–2 are in
    the band;
  - canonical order, and keys in `index.json` and the pool;
  - no pairing repeats, and no key appears twice in any 7 days;
  - no game pairs two teams from the same season;
  - `p`/`m` match `teams/<a>.json` for unreleased days (every day while not
    launched);
  - `lastDay` is at least `MIN_DAYS_AHEAD` (60) days out.

  It imports the builder's constants, so the two can't drift.
- `tests/test_daily_schedule.py` (23 tests) covers:
  - the committed schedule passes, and is a byte-identical rebuild;
  - extending, shrinking, another seed, frozen days after launch, and a
    locked launch date;
  - one tampered copy per rule, each caught by the verifier, plus its exit
    codes.
- `frontend/src/daily/` is pure TypeScript with no React, network or storage.
  `index.ts` exports all of it, and `tsconfig.test.json` now includes it:
  - `types.ts`: the data contract.
  - `day.ts`:
    - puzzle numbers from calendar dates, using integer civil-date
      arithmetic (Hinnant's `days_from_civil`), never milliseconds;
    - `localDate` reads the runtime's local date;
    - `puzzleStatus` returns `ready`, `before-launch` or `not-ready`;
    - `msUntilNextPuzzle` gives the countdown to local midnight.
  - `sim.ts`: `sim-v1`. Below.
  - `stats.ts`:
    - `parseStore` / `serializeStore` for `ct:daily:v1`;
    - `recordDay` stores picks and the simulated winners at lock-in. Picks
      are final, so a second lock-in changes nothing;
    - `computeStats` gives played, accuracy, perfect days, the distribution
      and both streaks;
    - an optional `clientId` is kept for Session 4.
  - `share.ts`: the share text, plus `shortTeamLabel` ("'96 Bulls").
- `frontend/tests/unit/daily-engine.test.ts` (36 tests) covers every case the
  brief lists, plus a run of every scheduled game from the real pool.

**`sim-v1` as built** (the order of draws is part of the engine):

1. Seed `daily-three:sim-v1:<n>:<gameIndex>`. `gameIndex` counts from 0, so
   the featured game is 2.
2. **Winner.** The first draw: `rng() < p`. The tests show that changing `m`,
   or swapping the team data, never changes the winner.
3. **Final score.**
   - Possessions are the teams' average pace ± 2 (sd).
   - Each team's expected points use its offensive rating averaged with the
     other's defensive rating. The total gets ± 9 (sd).
   - The margin is drawn as `m + 12·z`, redrawn until it lands on the
     winner's side, and is at least 1. After 64 failed draws it falls back to
     1 point.
   - The loser scores at least 60.
4. **Scoring plays.**
   - Threes are `threeRate × 0.85` of the points (`threeRate` 0.2 if
     missing). Free throws are 18% of the points, as trips of 2 plus a single
     one. The rest are twos.
   - Each team's plays are spread evenly through the 48 minutes, jittered,
     with a hot/cold tilt (0.3×–1.7×) in each of 16 three-minute stretches.
   - Scorers are starters in proportion to PPG and the bench by `benchPpg`.
5. **Determinism.** Normal draws are Irwin–Hall (12 uniforms − 6), so no
   transcendental `Math` function is called, following `prng.ts`'s rule.

**Numbers**

| Measure | Value |
|---|---|
| Days generated | 365 (#1 2026-10-01 to #365 2027-09-30, placeholder dates) |
| Games / distinct pairings | 1,095 / 1,095. Of 40,426 cross-season pairings, 2,180 of them marquee vs marquee: 365 used |
| Pool use | All 288 teams. Marquee teams 11–12 times a year (10–12 as featured), known teams 6–7 |
| Games 1–2 favourite | Mean 0.575: 634 of 730 at 0.55–0.60, 89 at 0.60–0.65, 7 at 0.65–0.70 |
| Featured favourite | Median 0.545, max 0.697 (no odds rule needed: famous teams land close) |
| Marquee teams in games 1–2 | 17 of 1,460 slots (least-used picking keeps them for the featured game) |
| Same-season games | 0 (forbidden since the owner's 2026-10-07 decision; the first build had 23) |
| Calibration | Over 10,000 seeds each, the winner rate is within 1.5 points of `p` at 0.31, 0.55, 0.62, 0.70 and 0.90 |
| Upsets in the schedule | 44.4% of the 1,095 games, about what the odds imply (favourites average about 57%) |
| Simulated scores, all 1,095 games | Combined mean 205 (158–251). Margin median 8, 90th percentile 20, max 38 |
| Game flow | 7.1 lead changes a game. Biggest run: median 9 points, 95th percentile 13. The loser led by 10+ in 21% of games |

The flow was tuned once before the golden values were pinned. The first draft
placed plays at random times, which gave one 46–0 run, and the eventual loser
led by 10 or more in 48% of games. The final placement is the stratified,
tilted one above.

**Decisions**

- **Q3, decided by the owner on 2026-10-07: a missed day does not reset the
  🎯 hot streak.** Only a wrong pick does. A missed day resets only the 🔥
  play streak.
- **No same-season games, decided by the owner on 2026-10-07.** The first
  build had 23, such as two 1996 teams: real-world matchups, not cross-era.
  `MIN_SEASON_GAP` (1) in the builder removes them, the verifier checks it,
  and the schedule was rebuilt.
- **Play streak display.** The current play streak counts through today if
  today is played. Otherwise it counts through yesterday, and it is 0 once
  yesterday was missed too. A missed number therefore shows as a reset on the
  first day after it.

**Interface notes for Session 3**

- **The winner never changes once a day is released.** It depends only on
  the seed and the day file's `p`. The score, plays and box line also read
  `teams.json`, so an annual re-export changes how an old game is narrated,
  but never who won. Stored stats keep the winners from lock-in, so they are
  unaffected. Watch for this if a past game is ever replayed (there is no
  archive).
- The page should call `simulateGame` with `engine` from the day file, never
  from `meta.json`.
- `BENCH` (−1) marks bench scorers. `clockAt(t)` turns elapsed seconds into
  a quarter and the time left in it.
- `msUntilNextPuzzle` drives the countdown.
- The brief's share example listed '17 Warriors before '96 Bulls, against its
  own canonical-order rule. It is corrected above.

**Verification:** all of "How to verify" passed on 2026-10-07:
- `npm run build` and `npm run lint` are clean.
- `npm test`: 198 unit tests.
- `npx playwright test`: 49 tests. Two duel-account specs timed out at
  30 seconds while the worker suite ran in parallel. Re-run alone, all 5 in
  `account.spec.ts` passed in about 5 seconds each; this session touches no
  UI.
- Worker: `tsc` passes and 123 tests pass.
- `python -m pytest tests`: 174 tests (176 after the same-season rule).
- `test_pregame_leakage.py` exits 0.
- `verify_static_export.py`: 200 of 200 pairs match.
- `verify_daily_data.py`: OK.

**For the owner to decide (none blocks the merge)**

1. ~~**Same-season pairings.**~~ **Decided 2026-10-07: forbidden.** The
   schedule was rebuilt without them (above).
2. **Games 1–2 lean to the low end of the band.** 87% have a 0.55–0.60
   favourite, because the pool's in-band pairings are mostly close.
   Recommendation: keep it for the play-test and tune in Session 3 if the
   games feel like coin flips. One option is to draw the target favourite
   probability uniformly inside the band.
3. **Data rights** (Session 1, decision 1). Still open until Session 5.

### Session 3: the `/daily` page (2026-10-10)

Branch `f12-s3-page`, PR #22, merged to `main` on 2026-10-10 (merge commit
`c7e6228`). The owner chose to merge before playing the PR preview and to
play-test on staging instead. `git push origin main:staging` then
fast-forwarded staging from `a2197e3` to `c7e6228`. Nothing reaches
production: the page exists only in builds with `VITE_DAILY_THREE=1`.

- Checked before the merge, through the Pages API (variable names only): the
  Production variables are only `NODE_VERSION`. Preview has `NODE_VERSION`
  and `VITE_DUEL_API`.
- `VITE_DAILY_THREE` was **not yet set in Preview**, so staging has no
  `/daily` until the owner sets it and retries the `staging` build.

**Owner step.** Set `VITE_DAILY_THREE` = `1` in the Pages **Preview**
environment (PR previews and the `staging` branch). Leave Production unset
until Session 5. The Settings page's environment box defaults to Production
(`DEPLOYMENT.md`, phase 2 Record, "Dashboard trap").

**What was built**

- **The build flag.** `frontend/buildEnv.ts` gains `dailyThreeEnabled` and
  `dailyThreeDefines`, used by `vite.config.ts`. Only `1` or `true` (any case)
  turn it on, and the app sees exactly `"1"` or `""`. It does not depend on
  the branch: the Pages environment decides. `vite.config.ts` now also reads a
  local `.env` file through `loadEnv`, so `VITE_DAILY_THREE=1` in
  `frontend/.env.local` works for `npm run dev`. Tests are in
  `tests/unit/build-env.test.ts`.
  - `App.tsx` registers `daily` before `:matchupSlug` and tests the variable
    inline. A build without the flag emits no `DailyPage` chunk, checked on a
    real build. With the flag, the page is a lazy 24 KB chunk (8 KB gzipped).
  - `lib/dailyFlag.ts` holds `DAILY_THREE` for the nav link
    (`components/Layout.tsx`) and the home card (`pages/HomePage.tsx`).
- **The page**, `pages/DailyPage.tsx`, with `components/daily/`:
  - `DailyPickCard`: two team cards per game, each the label of a radio
    (arrow keys and Space work, and the radio's name is short: "Pick the
    1995–96 Chicago Bulls"). Each card shows the season, the era-correct name,
    the record and the starting five with PPG and signature stats. At 480 px
    and below, starters' names shorten to an initial, and the full name stays
    for screen readers. Game 3 is marked ⭐ Featured. Lock in needs all three
    picks.
  - `DailyReveal`: one game after another, 20 seconds each plus a 3-second
    pause on the final: a scoreboard, the quarter clock, and the last four
    scoring plays ("M. Jordan three, +3"). **Skip** jumps to this game's final,
    then becomes **Next game** / **See results**. **Skip all** goes to the
    results. The ticking board is hidden from screen readers; a polite live
    region announces each game's start and final. Focus moves to the game
    heading at lock-in.
  - `DailyFinal`: the score, ✅ or ❌, the odds line (Q1), the points-only box
    line labelled "Simulated points", the one-simulated-game label, and the
    explorer link (`/<a>-vs-<b>`). Screen readers get the final as a sentence
    ("Final: 1985–86 Philadelphia 76ers 100, 2011–12 Miami Heat 110. You
    picked …").
  - `DailyResults`: "You went 2/3", both streaks, **Share** (Web Share, falling
    back to the clipboard), **Watch again**, the three finals, the stats panel
    (played, accuracy, perfect days, best streaks, days by score) and the
    countdown to local midnight. At midnight the page loads the next puzzle.
    Focus moves to the score after the reveal.
  - Before lock-in, a returning player sees their current streaks above the
    cards.
- **Data and storage**, `lib/dailyData.ts`: cached loads of `meta.json`,
  `teams.json` and `days/<n>.json` (a failed load is retried, not cached).
  `ct:daily:v1` is read and written inside try/catch; with storage blocked the
  day lasts for the page, and the results say so.
- `lib/dailyPuzzle.ts` joins the day file, the pool and `index.json`, and runs
  each game with `simulateGame` and the **day file's** `engine`. The results
  are computed at load but only rendered after lock-in. `lib/dailyFormat.ts`
  holds the display text and the reveal clock.
- **Lock-in** calls `recordDay` with the picks and the simulated winners and
  writes the store before the reveal starts, so a refresh mid-reveal lands on
  the results. With `prefers-reduced-motion`, lock-in goes straight to the
  results, where all three finals show at once.

**Rules kept**

- Nothing the model says shows before lock-in: no percentage, no margin, no
  score. The full play-through test checks the page text before lock-in.
- `m` is never displayed. After a final, the odds line gives the winner's
  chance through `formatPercent` (`lib/duelFormat.ts`), which never reads 0%
  or 100%.
- Every game, in the reveal and in the results, carries "One simulated game.
  The simulator plays each game at its odds, so upsets happen."
- Team colours stay off (`TEAM_COLORS_APPROVED` is false), so the cards use the
  site's side-A / side-B colours. No logos.

**Decisions (owner, 2026-10-10)**

- **Q1: yes.** The odds show after each game's final, never before the pick.
  The owner asked how an upset works first. The example used was puzzle #9,
  game 2 (not playable any more): the model gave the 2010–11 Celtics 58%
  against the 2020–21 Trail Blazers. The seeded draw landed in the Blazers'
  42%, and they won the simulated game 108–106. The page says "Upset! The
  model gave the 2020–21 Trail Blazers 42%." The owner OK'd naming "the model".
- **Q5: name the winners, with the final score.** This replaces the planned
  spoiler-free text. `daily/share.ts` takes each game's `finals` and writes
  "🟩 '96 Bulls beat '89 Pistons 104–92". The squares still follow the
  sharer's picks. Session 2's share tests were rewritten for it: winner first,
  the right square, no `%`, no decimal, and no `p` or `m`.

**Tests**

- Unit (`tests/unit/daily-page.test.ts`, 14): card and stat text, the play
  text, the clock, the odds line, the reveal clock (advance, pause, Skip, Skip
  all), the countdown, and the puzzle built from the committed data, matching
  `simulateGame` for days 1, 10 and 365. `build-env.test.ts` has 4 more, and
  `daily-engine.test.ts` has 2 more for the share text.
- Playwright (`tests/e2e/daily.spec.ts`, 9). The date is pinned with
  `page.clock` in `America/New_York`, and the expected winners, finals and
  share text are recomputed from the committed data with the engine:
  - a full play-through: no model numbers before lock-in, picks that change,
    Skip, a game that runs its 20 seconds, the move to the next game, and the
    results with every label, the screen-reader final and the explorer links;
  - a refresh mid-reveal that lands on the results, then Watch again;
  - a second day in a row (play streak 2);
  - a skipped day (play streak 0 before playing, 1 after; the hot streak
    survives, Q3);
  - the share text, compared exactly;
  - reduced motion;
  - 375 px in both themes with no sideways scroll, played by keyboard only;
  - the home card and the nav link;
  - with the flag off, `/daily` shows "We couldn't find that matchup." and
    neither the link nor the card appears.
- `playwright.config.ts` starts the main dev server with
  `VITE_DAILY_THREE=1`, plus a second one on port 4318 without it, with its
  own Vite cache directory (`VITE_CACHE_DIR`).

**Verification:** all of "How to verify" passed on 2026-10-10:
- `npm run build` and `npm run lint` are clean.
- `npm test`: 218 unit tests.
- `npx playwright test`: 58 tests, all passing in one parallel run.
- Worker: `tsc` passes and 123 tests pass.
- `python -m pytest tests`: 176 tests.
- `test_pregame_leakage.py` exits 0.
- `verify_static_export.py`: 200 of 200 pairs match.
- `verify_daily_data.py`: OK.

**For the owner (play-test on staging)**

1. Set `VITE_DAILY_THREE` = `1` in the Pages **Preview** environment, then
   retry the latest `staging` deployment. Play
   `staging.courtofalltime.win/daily`.
2. **Games 1–2 closeness** (Session 2, item 2), still open: judge it while
   playing. 87% of games 1–2 have a 0.55–0.60 favourite (mean about 0.575),
   so about 4 in 10 of those games end as upsets. That rate is the odds,
   honestly drawn, not a bias in the simulator. If they feel like coin
   flips, the fix is in `scripts/build_daily_schedule.py`, not the
   simulator: draw each game's target favourite evenly inside
   `FORGIVING_BAND`, or raise the band's floor. Then rebuild the schedule,
   which is allowed until launch.
