# F09 continuation handoff (duel mode and ranked ladder)

Written 2026-09-24 for whoever continues F09, updated the same day after
Sessions 5 and 6, and updated on 2026-09-25 after Session 7. This is the entry point for the next session. The authoritative detail is in
[`F09-daily-duel.md`](F09-daily-duel.md): the brief, plus one handoff record
per finished session. This file summarizes it and does not replace it.

Read first, in order: `CONTRIBUTING.md`, `docs/product/HANDOFF.md`,
`docs/product/features/F09-daily-duel.md` (all of it), then this file.

## Where things stand

| Session | Scope | State |
|---|---|---|
| 1 | Offline puzzle pool + archetype gates | Done |
| 2 | Pure domain logic (scoring, duel, Elo, bot, selection) | Done |
| 3 | Worker, D1 schema, guest play loop | Done |
| 4 | Frontend play surface (`/duel`, `/duel/:duelId`) | Done |
| 5 | Accounts (magic link, Turnstile, names, ranked eligibility) | Done (PR #4, merge commit `e7643a9`) |
| 6 | Ranked duels, matchmaking, friend invites, Elo application | Done (PR #5, merge commit `238e43a`) |
| 7 | Leaderboard and anti-abuse enforcement | Done (branch `f09-leaderboard`) |
| 8 | Hardening, load/cost review, release gate | **Next**. The load test and cost figures need a deployed (staging) environment |

Sessions 1–4 were merged to `main` in PR #3 (merge commit `3ad3858`), which
also merged F01–F05. Session 5 was merged in PR #4 (merge commit `e7643a9`),
and Session 6 in PR #5 (merge commit `238e43a`).
Nothing is deployed: duel mode
stays off on the live site until the owner does the setup below and sets
`VITE_DUEL_API`.

Guests can play five real games, solo or against the disclosed Sparring
Partner. A player can optionally sign in by email magic link. Signing in
keeps their guest history, lets them choose a display name, and tracks ranked
eligibility (10 completed sets and a name). Eligible accounts play ranked
duels: asynchronous, matchmade by rating, with Elo recorded in an audit
ledger. Anyone can challenge a friend by invite link (unranked). Rated players
appear on a daily and a 30-day leaderboard. Detectors flag suspicious
accounts, and a flag only keeps an account off the board until a reviewer
decides; nothing auto-bans. The pre-game model appears on every result as a fixed benchmark. The
static explorer and tournaments never call the Worker, and they are tested with
it unreachable.

## Code map

| Area | Path | Notes |
|---|---|---|
| Pool generator | `scripts/generate_duel_pool.py` | Needs gitignored `data/` and `DUEL_POOL_SALT`. About 8 s. Writes `data/processed/duel_pool/{sim,ranked}_{public,private}.json` and `reports/duel_pool_report.json` |
| Pool tests | `tests/test_duel_pool.py` | 17 tests; the artifact tests skip when the pool isn't built |
| Leakage guard | `src/models/test_pregame_leakage.py` | Now also checks `form10_win_pct`, `rest_days`, `back_to_back`. Must exit 0 |
| Domain (pure TS) | `frontend/src/duel/` | `index.ts` is the public interface. `api.ts` holds the wire types the Worker imports |
| Worker | `worker/` | Its own npm package (vitest 4 + `@cloudflare/vitest-pool-workers`). `src/index.ts` is the router |
| D1 schema | `worker/migrations/0001_guest_play.sql` … `0004_integrity.sql` | Never edit an applied migration; add `0005_…` next |
| Matches (Worker) | `worker/src/matches.ts` | Ranked and friend duels: matchmaking, invites, settling, Elo, the cron sweep. Timeout rules are in its header |
| Integrity (Worker) | `worker/src/integrity-rules.ts` (pure rules and thresholds), `integrity.ts` (metrics, sweep, flags, network signal), `admin.ts` (review queue), `leaderboard.ts` | `scripts/review-queue.mjs` is the reviewer's CLI |
| Accounts (Worker) | `worker/src/accounts.ts`, `names.ts`, `services.ts` | Magic links, sessions, guest upgrade, names, `assertRankedEligible`. Email and Turnstile are interfaces with doubles |
| KV pool loader | `worker/scripts/build-pool-kv.mjs`, `seed-local.mjs`, `fixture-pool.mjs` | The fixture pool is synthetic, with distinctive probabilities for leak tests |
| Frontend client | `frontend/src/lib/duelApi.ts` | The only module that calls the Worker. Plays as the session when signed in, else the guest |
| Client storage | `frontend/src/lib/duelStorage.ts` | Guest token in `localStorage` `ct:duel:guest:v1`; session in `ct:duel:session:v1`; drafts in `sessionStorage` `ct:duel:draft:v1:<id>` |
| Pages / components | `frontend/src/pages/Duel*.tsx` (incl. `DuelJoinPage` at `/duel/join`, `DuelLeaderboardPage` at `/duel/leaderboard`), `Account*.tsx`, `frontend/src/components/duel/` (incl. `DuelWaiting`), `components/account/` | Gated on `VITE_DUEL_API`; the sign-in form also needs `VITE_TURNSTILE_SITE_KEY` |
| Analytics | `frontend/src/lib/analytics.ts` | Added `duel_started`, `duel_completed`, `account_signed_in`. Failures use `app_error` (`duel-start`, `duel-submit`, `duel-load`, `account-link`, `account-verify`, `account-name`, `account-load`) |
| E2E | `frontend/tests/e2e/duel.spec.ts`, `account.spec.ts`, `ranked.spec.ts` (includes the leaderboard) | Playwright starts `wrangler dev` on 8788 with a fresh fixture pool, the localhost-only auth doubles, an e2e `ADMIN_TOKEN`, and an uncached board (`frontend/playwright.config.ts`) |
| Worker tests | `worker/test/*.test.ts`, shared `helpers.ts` | `integrity.test.ts` holds the Session 7 acceptance scenarios |

### Worker API (Sessions 3–7)

| Method + path | Auth | Returns |
|---|---|---|
| `GET /v1/health` | none | `{ ok, poolVersion }` |
| `POST /v1/guests` | none; 10/h per IP | `{ guestToken }` |
| `POST /v1/sets` `{ mode, draw }` | guest or session; `ranked` needs an eligible account | `IssuedSet` (no answers) |
| `POST /v1/invites/accept` `{ invite }` | guest or session | `{ duelId, set }` |
| `GET /v1/duels/:id` | owner only | `open` / `waiting` / `expired` / `revealed` |
| `POST /v1/duels/:id/submission` `{ setToken, picks }` | owner + `Idempotency-Key` | `DuelState` (`revealed` or `waiting`) |
| `POST /v1/duels/:id/stop-waiting` | match creator | `DuelState` |
| `POST /v1/auth/magic-link` `{ email, turnstileToken }` | Turnstile | `202 { ok }` |
| `POST /v1/auth/verify` `{ token, guestToken? }` | the link | `{ sessionToken, account }` |
| `POST /v1/auth/sign-out` | session | `{ ok }` |
| `GET /v1/account` | session | `AccountView` |
| `POST /v1/account/display-name` `{ displayName }` | session | `AccountView` (includes `hiddenFromBoard`) |
| `GET /v1/leaderboard?board=daily\|30d` | none; edge-cached | `LeaderboardView` (flagged accounts left off) |
| `GET /v1/admin/flags?status=` | `ADMIN_TOKEN`; else 404 | the review queue |
| `POST /v1/admin/flags/:id` `{ decision, note? }` | `ADMIN_TOKEN` | the decided flag |
| `POST /v1/admin/sweep` | `ADMIN_TOKEN` | runs the detectors now |

Every play endpoint takes a guest token or a session token (`Bearer s_…`).
Participants are the strings `g:<guestId>` and `a:<accountId>`. Every table is
keyed by participant, and a guest upgrade re-keys `g:` rows to `a:` in one D1
batch; that includes `match_seats`. `POST /v1/sets { mode: "ranked" }` runs
`assertRankedEligible` first. A scheduled handler runs every 15 minutes. It
settles matches whose timeout has passed, then runs the integrity sweep, which
raises flags and purges expired links and sessions.

## How to verify (all must pass before finishing any session)

```
cd frontend && npm run build && npm run lint && npm test && npx playwright test
cd worker && npx tsc --noEmit && npm test
python -m pytest tests
python src/models/test_pregame_leakage.py        # must exit 0
```

Baseline after Session 7 (branch `f09-leaderboard`): frontend 142 unit + 47
Playwright; worker 110; Python 40. (At `238e43a` it was 140 + 46, 75, and 40.)

## Decisions already made (don't relitigate)

- Guests play every unranked mode; only accounts rank.
- The fill-in opponent is the disclosed **Sparring Partner**
  (`BOT_DISPLAY_NAME`, `BOT_DISCLOSURE`). It is never called the model, never
  moves rating, and never enters the board.
- The model's line appears on every result, labelled a benchmark, with a note
  that it was trained through 2021.
- Unranked sets use the 1 lock / 2 favourite / 2 toss-up composition. Ranked
  sets use signal divergence.
- Elo: when one player is provisional and the other is not, the duel uses the
  mean K, so it stays zero-sum. Rounding is half away from zero.
- Displayed rest is calendar days from strictly earlier games, not the
  floored-hours `rest_days` in the matchup data.
- No betting framing, odds, ROI, cash entry, or prizes.
- Accounts are optional and never block play. The email address is never
  stored, only HMAC(`EMAIL_HASH_SECRET`, canonical address). Magic links go in
  the URL fragment, expire in 15 minutes, and are single-use by a D1 primary
  key. Sessions are bearer tokens, not cookies.
- Display names are Latin script only, checked on a folded key, and unique
  by that key. Ranked eligibility is 10 completed sets
  (`RANKED_MIN_COMPLETED_DUELS`, owner-tunable) and a display name.

## Owner decisions (answered 2026-09-24)

All four are recorded in the F09 brief's "Owner decisions" section.

1. **Lookup control:** flag sustained accuracy above the honest ceiling
   (~68%) for review, and never auto-ban. Built in Session 7 as a 99.9% Wilson
   lower bound above 0.68 (`accuracy_ceiling`).
2. **Ranked capacity:** limited reuse. A puzzle is never shown to the same
   account twice, and it waits 30 days after its answer was last revealed
   (built in Session 6).
3. **Draw modes:** `random` or one chosen `era`, confirmed.
4. **Model follow-up (outside F09):** the `rest_days` flooring retrain is still
   open. It is owned by the model work, not F09.

## Owner setup before any deploy

1. `wrangler d1 create court-of-all-time-duel`; put the id in
   `worker/wrangler.jsonc`; `npm run db:migrate:remote`.
2. `wrangler kv namespace create POOL` and `... RATE_LIMITS`; put the ids in
   `wrangler.jsonc`.
3. `wrangler secret put GUEST_TOKEN_SECRET` and `SET_TOKEN_SECRET`, each a long
   random string.
4. Set `ALLOWED_ORIGINS` to the production origin(s). Keep `RATE_LIMIT_SCALE`
   at `"1"`.
5. Set `DUEL_POOL_SALT` in `.env`; run `python scripts/generate_duel_pool.py`,
   then `cd worker && node scripts/build-pool-kv.mjs`, then
   `npx wrangler kv bulk put --binding POOL --remote .pool-kv/<file>` for each
   file. Make `POOL_VERSION` match.
6. Add a WAF rate-limit rule on `/v1/*`. The KV limits are soft.
7. Set `VITE_DUEL_API` in the Pages build to switch duel mode on.
8. For sign-in (Session 5): `wrangler secret put EMAIL_HASH_SECRET` (never
   rotate it), `EMAIL_API_KEY` (Resend, with the sending domain verified), and
   `TURNSTILE_SECRET_KEY`. Set `EMAIL_FROM` and `APP_ORIGIN` in
   `wrangler.jsonc`, set `VITE_TURNSTILE_SITE_KEY` in the Pages build, and run
   `npm run db:migrate:remote` again for `0002_accounts.sql`. Never set
   `AUTH_TEST_DOUBLES` in production. Extend the blocked-word list in
   `worker/src/names.ts`.
9. For ranked (Session 6): back up D1 (`wrangler d1 export`), then run
   `npm run db:migrate:remote` for `0003_ranked.sql`. It rebuilds `duels`,
   `submissions`, and `scored_picks`. After `wrangler deploy`, confirm the cron
   trigger under the Worker's Triggers.
10. For the leaderboard and integrity checks (Session 7): run
    `npm run db:migrate:remote` for `0004_integrity.sql`, which only adds
    tables. Then `wrangler secret put ADMIN_TOKEN` (at least 32 random
    characters), and review flags regularly with `scripts/review-queue.mjs`.
    An unreviewed false positive keeps an honest player off the board.

## Gotchas found in this implementation

- **npm 12 blocks install scripts.** After a fresh `worker/` install, run
  `npm install-scripts approve esbuild workerd` (already recorded in
  `worker/package.json` `allowScripts`).
- **workerd compatibility date.** The installed binary supports dates only up
  to 2026-08-22. `wrangler.jsonc` uses `2026-08-15`.
- **Local KV bulk writes fail near 1 MB.** `seed-local.mjs` writes 250-entry
  chunks. The real pool takes about 8 minutes to seed locally; the fixture
  takes seconds.
- **Router state survives reloads.** `DuelPlayPage` clears it after reveal.
  Keep that if you add screens that hand state between routes.
- **Header width.** The extra nav link overflowed at 360 px, so the header now
  wraps. Re-run the 360 px overflow checks if you add another nav link, for
  example "Account".
- **Tooling on this machine.** Long bash heredocs mis-parse in the agent's
  Bash tool; put multi-line scripts in files. Python on Windows defaults to
  cp1252, so open files with `encoding="utf-8"`. A cp1252 write once
  truncated a source file.
- **KV is eventually consistent.** The D1 constraints, not the counters, are
  what enforce one submission per duel and single-use magic links. Keep new
  integrity rules in D1 constraints too (for example ranked puzzle use).
- **Foreign keys are enforced in D1.** Re-keying `submissions` and
  `scored_picks` together needs `PRAGMA defer_foreign_keys = on` inside the
  batch (see `upgradeGuest` in `accounts.ts`).
- **The test tsconfig lists its `src` files.** A unit test that imports a new
  `src` module needs that module added to `frontend/tsconfig.test.json`.
  Otherwise `npm run build` fails even though `npm test` passes.
- **Worker tests inject services.** Call `handle(request, env, services)` with
  `MemoryMailer` and `DummyTokenCheck`. `exports.default` uses the production
  wiring, which fails closed without secrets.
## Next session: 8 (hardening and release gate)

Session 7 is on branch `f09-leaderboard`; merge it first. Session 8 covers:

- A load and abuse test with results and costs recorded. Include the
  integrity sweep, which scans 30 days of rated matches every 15 minutes, and
  make it incremental if the numbers call for it.
- The deferred decision on edge-caching puzzle reads (see the Session 7 control
  status table).
- A privacy review of stored identifiers. Session 7 added `play_metrics`,
  `integrity_flags`, `account_links`, and the short-lived KV network entry.
- Account deletion. Its cascade must cover `play_metrics`,
  `integrity_flags`, `account_links`, and the rating ledger.
- A copy review of every duel screen against the integrity and brand gates.
- The decision-log entry in `docs/product/HANDOFF.md` for the move into server
  state.

The owner decides what an upheld flag means beyond staying off the board.
Nothing heavier is built.

Gotchas found in Session 7:

- **Every local request is loopback.** `hasClientNetwork` skips network
  signals for loopback, or every e2e account would be linked and flagged.
  Unit tests pass explicit fake IPs.
- **Revealed ranked answers cool down for everyone.** Integrity tests play
  many ranked sets, so they clear `ranked_reveals` between sets
  (`soloRanked` in `integrity.test.ts`). Otherwise the fixture's 200 ranked
  puzzles run out.
- **Queue tests and exposures.** An account dealt a fresh set has been
  "shown" those puzzles, so it cannot join a match that contains any of them.
  Clear its exposures before expecting a join; two Session 6 tests were flaky
  on this.
- **Board caching.** The leaderboard is cached for `LEADERBOARD_CACHE_SECONDS`.
  Tests and e2e set it to 0; one test turns it on through the `env` override
  in `test/helpers.ts`.
- **Partial unique index.** One open flag per key is
  `integrity_flags_one_open`. Upserts must name its `WHERE status = 'open'`
  in `ON CONFLICT`.

### Kickoff prompt (Session 8)

```text
Continue F09 for Court of All Time: implement Session 8 (hardening and release
gate). Read CONTRIBUTING.md, docs/product/HANDOFF.md,
docs/product/features/F09-daily-duel.md (all of it, including the Session 7
record), and docs/product/features/F09-continuation-handoff.md before
changing anything. Branch from main. Run a load and abuse test against a
deployed staging Worker and record results and costs, including the
integrity sweep; decide the deferred puzzle-read caching; review every stored
identifier for need and minimisation and add account deletion; review all duel
copy against the integrity and brand gates; and record the move into server
state in the HANDOFF.md decision log. Run every check in "How to verify" and
update the brief and HANDOFF.md before finishing. Small commits.
```
