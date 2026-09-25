# F09 continuation handoff (duel mode and ranked ladder)

Written 2026-09-24 for whoever continues F09, and updated the same day after
Session 5. This is the entry point for the next session. The authoritative detail is in
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
| 6 | Ranked duels, matchmaking, friend invites, Elo application | **Blocked on owner decisions** |
| 7 | Leaderboard and anti-abuse enforcement | **Blocked on owner decisions** |
| 8 | Hardening, load/cost review, release gate | Needs a deployed environment |

Sessions 1–4 were merged to `main` in PR #3 (merge commit `3ad3858`), which
also merged F01–F05. Session 5 was merged in PR #4 (merge commit `e7643a9`).
Nothing is deployed: duel mode
stays off on the live site until the owner does the setup below and sets
`VITE_DUEL_API`.

Guests can play five real games, solo or against the disclosed Sparring
Partner. A player can optionally sign in by email magic link. Signing in
keeps their guest history, lets them choose a display name, and tracks ranked
eligibility (10 completed sets and a name). Ranked play itself is not built. The pre-game model appears on every result as a fixed benchmark. The
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
| D1 schema | `worker/migrations/0001_guest_play.sql`, `0002_accounts.sql` | Never edit an applied migration; add `0003_…` for Session 6 |
| Accounts (Worker) | `worker/src/accounts.ts`, `names.ts`, `services.ts` | Magic links, sessions, guest upgrade, names, `assertRankedEligible`. Email and Turnstile are interfaces with doubles |
| KV pool loader | `worker/scripts/build-pool-kv.mjs`, `seed-local.mjs`, `fixture-pool.mjs` | The fixture pool is synthetic, with distinctive probabilities for leak tests |
| Frontend client | `frontend/src/lib/duelApi.ts` | The only module that calls the Worker. Plays as the session when signed in, else the guest |
| Client storage | `frontend/src/lib/duelStorage.ts` | Guest token in `localStorage` `ct:duel:guest:v1`; session in `ct:duel:session:v1`; drafts in `sessionStorage` `ct:duel:draft:v1:<id>` |
| Pages / components | `frontend/src/pages/Duel*.tsx`, `Account*.tsx`, `frontend/src/components/duel/`, `components/account/` | Gated on `VITE_DUEL_API`; the sign-in form also needs `VITE_TURNSTILE_SITE_KEY` |
| Analytics | `frontend/src/lib/analytics.ts` | Added `duel_started`, `duel_completed`, `account_signed_in`. Failures use `app_error` (`duel-start`, `duel-submit`, `duel-load`, `account-link`, `account-verify`, `account-name`, `account-load`) |
| E2E | `frontend/tests/e2e/duel.spec.ts`, `account.spec.ts` | Playwright starts `wrangler dev` on 8788 with a fresh fixture pool and the localhost-only auth doubles (`frontend/playwright.config.ts`) |

### Worker API (Sessions 3–5)

| Method + path | Auth | Returns |
|---|---|---|
| `GET /v1/health` | none | `{ ok, poolVersion }` |
| `POST /v1/guests` | none; 10/h per IP | `{ guestToken }` |
| `POST /v1/sets` `{ mode, draw }` | `Bearer <guestToken>` | `IssuedSet` (no answers) |
| `GET /v1/duels/:id` | owner only | `open` / `expired` / `revealed` |
| `POST /v1/duels/:id/submission` `{ setToken, picks }` | owner + `Idempotency-Key` | `DuelResult` |
| `POST /v1/auth/magic-link` `{ email, turnstileToken }` | Turnstile | `202 { ok }` |
| `POST /v1/auth/verify` `{ token, guestToken? }` | the link | `{ sessionToken, account }` |
| `POST /v1/auth/sign-out` | session | `{ ok }` |
| `GET /v1/account` | session | `AccountView` |
| `POST /v1/account/display-name` `{ displayName }` | session | `AccountView` |

Every play endpoint takes a guest token or a session token (`Bearer s_…`).
Participants are the strings `g:<guestId>` and `a:<accountId>`. Every table is
keyed by participant, and a guest upgrade re-keys `g:` rows to `a:` in one D1
batch. `POST /v1/sets { mode: "ranked" }` already runs `assertRankedEligible`
and then answers `ranked_unavailable`; Session 6 replaces that line.

## How to verify (all must pass before finishing any session)

```
cd frontend && npm run build && npm run lint && npm test && npx playwright test
cd worker && npx tsc --noEmit && npm test
python -m pytest tests
python src/models/test_pregame_leakage.py        # must exit 0
```

Baseline at `e7643a9` (after Session 5): frontend 136 unit + 44
Playwright; worker 52; Python 40. (At `3ad3858` it was 130 + 40, 20, and 40.)

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

## Open owner decisions (block Sessions 6–7)

Record the answers in the F09 brief's "Owner decisions" section before
starting ranked work.

1. **Lookup control.** De-identified puzzles cannot stop a scripted join
   against the public Kaggle dataset: 88.5% of games are unique on era, game
   type, and both entering records alone, and no tested coarsening reaches
   k ≥ 5. Proposed replacement for "reject searchable puzzles": flag
   sustained accuracy above the honest ceiling (~68%) for review; never
   auto-ban. `searchK` is stored per puzzle.
2. **Ranked capacity.** "Any puzzle whose answer was ever served is ineligible
   for ranked" makes ranked puzzles single-use: 6,662 puzzles, about 1,332
   duels in total (about 1,660 with `RANKED_SHARE = 1.0`), plus about 250 per
   season. Accept, or allow limited reuse under stated conditions?
3. **Draw modes.** "Two matchup combos" is implemented as `random` versus one
   chosen `era`. Confirm.
4. **Model follow-up (outside F09).** `build_pregame_features.py` floors
   elapsed hours for `rest_days`, so 4% of back-to-backs are mislabelled in
   the model's training data. Fixing it means a retrain and re-validation.

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

## Next session: none is unblocked

Session 5 is merged (PR #4).

Session 6 (ranked duels, matchmaking, friend invites, Elo application) and
Session 7 (leaderboard, anti-abuse) stay blocked until the owner answers the
decisions above and records them in the F09 brief's "Owner decisions"
section. Session 8 needs a deployed environment. Work that does not need
those answers:

- Purge expired `magic_links` and `sessions` rows (a scheduled Worker).
- Account deletion, for Session 8's privacy review.
- Friend duels by invite link. They are unranked, so they could start before
  the ranked decisions if the owner wants them first.

### Kickoff prompt (Session 6, once unblocked)

```text
Continue F09 for Court of All Time: implement Session 6 (ranked duels and
matchmaking). First confirm the owner decisions in
docs/product/features/F09-continuation-handoff.md are recorded in the F09
brief's "Owner decisions" section; stop and ask if they are not. Read
CONTRIBUTING.md, docs/product/HANDOFF.md,
docs/product/features/F09-daily-duel.md, and the continuation handoff
completely before changing anything. Branch from main. Replace the ranked_unavailable line in worker/src/index.ts, keep
assertRankedEligible as the gate, and treat the abuse model as acceptance
tests. Run every check in "How to verify", review screenshots of new screens
at 360px and desktop, and update the brief and HANDOFF.md before finishing.
Small commits; do not push without asking.
```
