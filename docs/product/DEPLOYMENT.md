# Deployment plan: courtofalltime.win

This is the entry point for every session that deploys Court of All Time.
Read `CONTRIBUTING.md`, `docs/product/HANDOFF.md`, and this file first. The
duel Worker's own setup notes are the "Owner setup" list in
`features/F09-continuation-handoff.md` and the Session 3–8 records in
`features/F09-daily-duel.md`. This plan puts them in order for this domain.

Written 2026-09-26 after the owner and the agent agreed every decision below.

## Where things stand

- **Code.** Everything is merged to `main` (last merge PR #8, `cf7855a`):
  - the static site: matchup explorer, tournaments, and sharing;
  - duel mode through F09 Session 8;
  - stored leaderboards.
- **Live site.** `court-of-all-time.pages.dev` is an old direct-upload Pages
  project ("Git Provider: No"), last changed 2026-09-23. Merges to `main` do
  not reach it.
- **Duel server.** No Worker, D1 database, or KV namespace exists yet.
  `worker/wrangler.jsonc` still has placeholder ids.
- **Account.** The owner has **Workers Paid**. The domain
  **`courtofalltime.win`** is registered on the owner's Cloudflare account.
- **Local data.** The real puzzle pool is built on the owner's machine
  (`data/processed/duel_pool/`, `worker/.pool-kv/`). `.env` has no
  `DUEL_POOL_SALT`, so that pool's salt is unrecorded. Production gets a
  newly generated pool (phase 2).
- **Tooling.** The agent's `wrangler` login on this machine appears to be
  read-only (`wrangler whoami` lists read scopes). Phase 1 begins with the
  owner running `! npx wrangler login` to grant write access.

## Decisions (agreed 2026-09-26)

| Decision | Choice |
|---|---|
| Finish line | Everything built: static site, guest duel mode, accounts, ranked, leaderboard. Reached in stages |
| Product scope | Game-focused and betting-free. No odds, picks-for-money, prizes, or entry fees. Any betting product is a separate, later project that this deployment does not touch |
| Commercial | Free, non-commercial launch. **No pricing page or price buttons** (removed by F10, decided 2026-09-26). Payments, ads, and sponsors wait for F00 (data rights) |
| Site address | `courtofalltime.win` only. **No `www`** (changed 2026-09-26 in phase 1; it was going to redirect) |
| Before launch | F10: remove the pricing page and make the whole site easier to use, keeping the matchup explorer intact. It must be merged before phase 5 (added 2026-09-26) |
| Duel server address | `api.courtofalltime.win` |
| Staging | A permanent copy: `staging.courtofalltime.win` (the `staging` git branch) and `api-staging.courtofalltime.win` (its own Worker, D1, and KV) |
| Site deploys | A **new** Pages project connected to GitHub. Merges to `main` go live, and PRs get preview links. The old direct-upload project is deleted after cutover |
| Preview links | Only the `staging` branch gets duel mode. PR previews build the static site only (a small build change in phase 2) |
| Who does the work | The agent does everything `wrangler` and the repo can do. The owner does dashboard-only and identity steps. **The agent stops for the owner's OK before anything goes live on `courtofalltime.win`** |
| Sign-in email | Resend, free plan (3,000 a month, 100 a day), from `Court of All Time <signin@courtofalltime.win>`. Upgrade only if sign-ins approach 100 a day |
| Flag review | The owner reviews, daily for the first launch weeks and weekly after. An upheld flag only keeps the account off the board, for now |
| Analytics at launch | Cloudflare Web Analytics only. The interest form and event analytics are a later phase |
| Launch | A soft launch: live but unannounced for about a week while the owner and friends play every mode, then announce |
| Sessions | One phase per session, in order |

## Rules for every phase

- **Branches and verification.** Work on a branch per phase (`deploy-p1-site`,
  and so on) for any repo change. Run the full "How to verify" list in
  `F09-continuation-handoff.md` before merging.
- **Stop before going live.** Before any step that changes what visitors to
  `courtofalltime.win` see, stop and ask the owner. That covers attaching a
  domain, setting the production `VITE_DUEL_API`, deploying the production
  Worker, and deleting the old project. Staging steps need no stop.
- **Secrets.** Generate each with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
  Set it with `wrangler secret put`, and have the owner save it in a password
  manager. Secrets never go in the repo, a commit message, or this file.
  **`EMAIL_HASH_SECRET` and `DUEL_POOL_SALT` must never be lost or rotated**:
  every account is keyed by the first, and puzzle ids by the second.
- **Ids are not secrets.** D1 database ids and KV namespace ids go in
  `worker/wrangler.jsonc` and are committed.
- **Back up before migrating.** Take a D1 export before every remote
  migration: `wrangler d1 export <db> --remote --output backup-<date>.sql`.
  Keep it out of git. D1 Time Travel also keeps 30 days of history on
  Workers Paid.
- **Record as you go.** Each phase ends by filling in its "Record" section
  below: what was created (names and ids, never secrets), the checks and
  their results, and anything that differed from the plan.

## Phase 1: the site on courtofalltime.win

**Goal.** `https://courtofalltime.win` serves the current `main`, rebuilt on
every merge. PRs get preview links. Web Analytics is on. The old project is
gone. (`www` was dropped on 2026-09-26; its steps are struck through below.)

**Owner steps (dashboard):**

1. Run `! npx wrangler login` in the agent session and approve full access.
2. Workers & Pages, then Create, then Pages, then **Connect to Git**. Pick
   `DevPatel1919/nbahistoricalmatchups`.
   - Project name: `courtofalltime`.
   - Production branch: `main`.
   - Build settings: framework preset **None**; root directory `frontend`;
     build command `npm run build`; output directory `dist`.
   - Environment variable (production and preview): `NODE_VERSION` = `22`.
   - Set no `VITE_*` variables yet. Duel mode stays off.
3. In the new project, go to Custom domains and add `courtofalltime.win`
   ~~then `www.courtofalltime.win`~~. The zone is on the same account, so
   Cloudflare creates the DNS records.
4. In the project, go to Metrics and enable **Web Analytics**.

**Agent steps:**

1. Confirm the first production build succeeded, then check the site:
   - `curl -sI https://<new>.pages.dev/` answers 200;
   - `/data/index.json` answers 200;
   - a deep link such as `/tournament` answers 200 (the `_redirects` SPA
     fallback);
   - a matchup page renders, using the `browser-automation` skill if
     available.
2. ~~Add a redirect from `www` to the apex.~~ Dropped: no `www`.
3. Once the owner confirms the domain is attached, check it:
   - `https://courtofalltime.win` loads;
   - ~~`https://www.courtofalltime.win/about` 301s to the apex~~ (no `www`);
   - HTTPS works.
4. Open a trivial docs PR to confirm a preview link is posted and builds.
5. **Stop and ask.** Then delete the old project:
   `npx wrangler pages project delete court-of-all-time`.
6. Update the "Existing architecture" section of `HANDOFF.md`: Pages Git
   integration and the domain.

**Done when:**

- the apex serves `main` (no `www`);
- a merge to `main` redeploys on its own;
- PRs get preview links;
- Web Analytics shows visits;
- the old project is deleted.

**Rollback.** Remove the custom domain from the new project. Nothing else
depends on it yet.

**Record.** 2026-09-26. Phase 1 is done.

- **Login.** No new `wrangler login` was needed: the existing login already
  had `pages`, `workers`, and `d1` write access. `zone` is read-only, so zone
  rules and DNS stay owner steps.
- **A false start.** The first "Create" in the dashboard made a Workers
  Builds project (a Worker named `nbahistoricalmatchups`), not Pages. It
  failed with `Could not read package.json`, because no root directory was
  set. The agent deleted it. The Pages flow is Create, then the Pages option,
  then Import an existing Git repository.
- **Pages project `courtofalltime`.** Created on 2026-09-26:
  - GitHub `DevPatel1919/nbahistoricalmatchups`, production branch `main`;
  - root `frontend`, `npm run build`, output `dist`;
  - `NODE_VERSION=22` in production and preview, and no `VITE_*` variables;
  - PR previews and PR comments are on.
- **First build.** Built from `ecd4006` (deployment `dc4e1cf1`). Checked on
  `courtofalltime.pages.dev`:
  - `/`, `/data/index.json`, `/data/teams/1998-bulls.json`, `/tournament`,
    `/about`, `/duel`, and `/1998-bulls-vs-2017-warriors` all answer 200;
  - the JS bundle `index-CTn4GtRt.js` is identical to a clean-clone local
    build;
  - the Bulls vs Warriors page renders (73.8%) with no console errors, and no
    Duel link shows.
- **Domain.** The owner attached `courtofalltime.win`, and Pages shows it
  active. `https://courtofalltime.win/`, `/data/index.json`, and
  `/tournament` answer 200 with a valid certificate. `http://` 301s to
  `https://`.
- **Differed from the plan:**
  - no `www` (owner decision);
  - the owner also decided to remove the pricing page and to do a whole-site
    usability pass before launch. That is recorded as F10 and in the HANDOFF
    decision log.
- **Finished:**
  - Web Analytics is on, and its beacon is served on `courtofalltime.win`;
  - PR #10 got a Pages preview (`6ab338a8`) and a preview comment;
  - merging PR #10 (`503b23f`) redeployed production on its own
    (deployment `0fa4d553`);
  - the old `court-of-all-time` project was deleted with the owner's OK, and
    `court-of-all-time.pages.dev` no longer resolves.
- **Left for the owner:** the deleted Worker's Workers Builds trigger still
  posts a failing "Workers Builds: nbahistoricalmatchups" check on PRs. It is
  not required and does not block merges. Disconnect it in the dashboard; the
  agent's token cannot reach build settings.

**Kickoff prompt:**

```text
Deploy Court of All Time, phase 1 (the site on courtofalltime.win). Read
CONTRIBUTING.md, docs/product/HANDOFF.md, and docs/product/DEPLOYMENT.md in
full. Follow phase 1 exactly: have me run `npx wrangler login` first, walk me
through the dashboard steps I must do, do the agent steps, and stop for my OK
before attaching the domain changes and before deleting the old Pages
project. Fill in phase 1's Record and commit it on a branch.
```

## Phase 2: staging duel server

**Goal.** Guest duel mode works end to end on `staging.courtofalltime.win`,
against `api-staging.courtofalltime.win`, with the real pool. The load test
has run there, and its figures are recorded.

**Repo changes (a branch, then merge):**

1. **Two Worker environments.** In `worker/wrangler.jsonc`:
   - The top level is production.
   - Add `env.staging` with:
     - `name`: `court-of-all-time-duel-staging`;
     - its own `d1_databases` and `kv_namespaces` entries;
     - `routes`: `[{ "pattern": "api-staging.courtofalltime.win", "custom_domain": true }]`;
     - `vars`: `ALLOWED_ORIGINS` = `https://staging.courtofalltime.win`,
       `APP_ORIGIN` = the same, and `EMAIL_FROM` = the phase 4 sender.
   - Wrangler does not inherit `vars` or bindings into an environment, so
     repeat every var in `env.staging`, and the cron trigger too.
   - The production top level gets the same set, with
     `ALLOWED_ORIGINS` = `https://courtofalltime.win` and
     `APP_ORIGIN` = `https://courtofalltime.win`.
   - Leave the production ids as placeholders until phase 3.
2. **Preview builds without duel mode.** In `frontend/vite.config.ts`, blank
   `VITE_DUEL_API` and `VITE_TURNSTILE_SITE_KEY` unless `CF_PAGES_BRANCH` is
   `main` or `staging`, or the build is local (the variable is unset). Pages
   sets that variable at build time. Add a unit test for the rule, and keep
   the e2e config working locally.
3. **Pool scripts.** Add `--env` to `worker/scripts/build-pool-kv.mjs` usage
   docs if it needs to differ. The upload itself is a `wrangler` command.

**Owner steps:**

- Create the `staging` branch from `main` once the repo changes are merged:
  `git push origin main:staging`. The agent can do this.
- In Pages, go to Custom domains and add `staging.courtofalltime.win`, then
  point it at the `staging` branch. This is a CNAME to
  `staging.courtofalltime.pages.dev`; the agent adds it if the token allows.
- Pages environment variables (**preview**): `VITE_DUEL_API` =
  `https://api-staging.courtofalltime.win`. The build rule from step 2 keeps
  it off the PR previews.
- Save each secret the agent generates in a password manager.

**Agent steps:**

1. Create the resources, and put the ids in `env.staging`:
   - `npx wrangler d1 create court-of-all-time-duel-staging`;
   - `npx wrangler kv namespace create POOL --env staging`;
   - `npx wrangler kv namespace create RATE_LIMITS --env staging`.
2. Set the secrets: `wrangler secret put GUEST_TOKEN_SECRET --env staging`,
   then `SET_TOKEN_SECRET` and `ADMIN_TOKEN` the same way. Account secrets
   wait for phase 4.
3. Apply the migrations:
   `npx wrangler d1 migrations apply DB --remote --env staging`. That applies
   all six, `0001` to `0006`.
4. **Build a new pool.**
   - Generate `DUEL_POOL_SALT`, write it to the repo-root `.env` (gitignored),
     and have the owner save it in a password manager.
   - Run `python scripts/generate_duel_pool.py`.
   - Run `cd worker && node scripts/build-pool-kv.mjs`.
   - Upload each file with
     `npx wrangler kv bulk put --binding POOL --remote --env staging .pool-kv/<file>`.
   - Set `POOL_VERSION` to the version the generator reports, if it differs
     from `duel-pool-v1`.
   - Check `python -m pytest tests/test_duel_pool.py`, which now runs the
     artifact tests.
5. Deploy: `npx wrangler deploy --env staging`. Confirm the cron trigger
   under the Worker's Triggers. Confirm
   `https://api-staging.courtofalltime.win/v1/health` returns the pool
   version.
6. Once Pages has built the `staging` branch, play a solo, a bot, and a
   friend set on `https://staging.courtofalltime.win/duel`. Check that no
   answer appears in any pre-lock network response.
7. **Load test.**
   - Set `RATE_LIMIT_SCALE` to `"100"` in `env.staging` and redeploy.
   - Run `node scripts/load-test.mjs --api https://api-staging.courtofalltime.win --players 20 --seconds 120 --out <scratchpad>/staging-load.json`.
   - Record p50 and p95 per route, and the dashboard's CPU time per request.
   - Restore `"1"` and redeploy.
   - Copy the figures into the F09 Session 8 record, under "Load and abuse
     test", as the staging run.
   - The ranked part runs only against a local Worker (it needs the auth
     doubles). Staging measures the guest and board paths.

**Done when:**

- `/duel` on staging plays every guest mode;
- the explorer on staging still works with the API blocked, for example by
  blocking `api-staging.*` in devtools;
- PR previews show no duel mode;
- the staging load run has 0 server errors and 18 of 18 probes, with its
  figures recorded;
- `RATE_LIMIT_SCALE` is back to `"1"`.

**Rollback.** `npx wrangler delete --env staging` removes the Worker. Its
data stays in D1 and KV until deleted.

**Record.** 2026-09-29. Phase 2 is done: every agent step and every "Done
when" check passed. One owner step remains; see "Left for the owner" at the
end of this Record.

- **Repo changes.** PR #12 (`deploy-p2-staging`), merged as `f1a9d6b`
  together with the phase 1 Record (#11, `40e2c12`).
  - `worker/wrangler.jsonc`:
    - the top level is production, with `https://courtofalltime.win`
      origins, and its ids are still placeholders;
    - `env.staging` is filled in;
    - `EMAIL_FROM` is set to the phase 4 sender in both, which is inert
      until `EMAIL_API_KEY` exists.
  - Because the top level now names the production origins, every local
    run overrides `ALLOWED_ORIGINS` and `APP_ORIGIN` to localhost:
    - the Worker tests, in `worker/vitest.config.ts`;
    - Playwright's `wrangler dev`, in `frontend/playwright.config.ts`;
    - `npm run dev`, in `worker/.dev.vars.example` (copy it to `.dev.vars`);
    - the local load test, in the header of `worker/scripts/load-test.mjs`.
  - `frontend/buildEnv.ts`, used by `vite.config.ts`, blanks
    `VITE_DUEL_API` and `VITE_TURNSTILE_SITE_KEY` when `CF_PAGES_BRANCH`
    is set to anything but `main` or `staging`. Its tests are in
    `tests/unit/build-env.test.ts`. Real builds confirmed it: a feature
    branch's bundle contained neither value, while `staging` and local
    builds kept both.
  - Verified: frontend build, lint, 146 unit, and 48 Playwright tests; the
    Worker's tsc and 123 tests; 40 Python tests; the leakage guard exits 0.
- **Resources.** Ids, not secrets:
  - D1 `court-of-all-time-duel-staging`, id
    `5e7c6705-01e9-4679-82ae-ded466c52deb`. Migrations `0001`–`0006` are
    applied remotely.
  - KV `court-of-all-time-duel-staging-POOL`, id
    `459faa0bc11d4797a92485c1e421e37d`.
  - KV `court-of-all-time-duel-staging-RATE_LIMITS`, id
    `93571ede4ee54dfa93f4e5f03313aec8`.
  - Worker `court-of-all-time-duel-staging`, first version `4df977a9`:
    - custom domain `api-staging.courtofalltime.win`;
    - cron `*/15 * * * *`;
    - `workers.dev` off.
  - Secrets: `GUEST_TOKEN_SECRET`, `SET_TOKEN_SECRET`, and `ADMIN_TOKEN`,
    set with `wrangler secret bulk --env staging`. Their values were written
    only to the agent's session scratchpad (`staging-secrets.json`) for the
    owner to save. That file is temporary: the owner saves the values in a
    password manager, then the file is deleted. **If they were not saved
    before the file was lost, generate new ones and `wrangler secret put`
    them again.** Staging secrets can be replaced; the salt below cannot.
- **Pool.**
  - A new `DUEL_POOL_SALT` is in the repo-root `.env`. That file did not
    exist before; it is gitignored and holds only this line.
  - **The owner must save the salt in a password manager.** Phase 3 uploads
    this same pool to production, and puzzle ids depend on it.
  - The generator reported `duel-pool-v1` (23,705 unranked and 6,684 ranked
    puzzles), so `POOL_VERSION` is unchanged.
  - `build-pool-kv.mjs` wrote 30,413 KV entries in 4 files. All four were
    uploaded with `kv bulk put --binding POOL --remote --env staging`.
  - `reports/duel_pool_report.json` changed only because the salt decides
    which games fall in each partition.
  - The old local pool, whose salt was never recorded, was copied to the
    agent's scratchpad before it was overwritten. It is not needed.
- **Worker checks.**
  - `https://api-staging.courtofalltime.win/v1/health` answers
    `{"ok":true,"poolVersion":"duel-pool-v1"}`.
  - `POST /v1/guests` from origin `https://staging.courtofalltime.win`
    answers 201 with `Access-Control-Allow-Origin` set to that origin.
- **Pages.**
  - The `staging` branch was pushed from `main` at `f1a9d6b`.
  - The owner added the custom domain `staging.courtofalltime.win` and
    pointed its CNAME at `staging.courtofalltime.pages.dev`. It resolves and
    answers 200.
  - The preview variable is `VITE_DUEL_API` =
    `https://api-staging.courtofalltime.win` (Text).
  - As of 2026-09-28 the Production variables are only `NODE_VERSION`
    (checked through the API).
  - The owner retried the `staging` build: deployment `1e2882b8`. Checked
    on 2026-09-29:
    - `staging.courtofalltime.win` serves its bundle `index-DiocxOKC.js`,
      which contains `api-staging.courtofalltime.win`;
    - `courtofalltime.win` serves `index-CTn4GtRt.js`, which does not;
    - the Production variables are still only `NODE_VERSION`.
- **Play-test.** On 2026-09-29, in Chrome on
  `https://staging.courtofalltime.win/duel`, as a guest. A `fetch` wrapper
  kept every API response body, and each one was searched for answer
  fields: `actualWinner`, `modelHomeWinProbability`, a winner, a score, a
  date, and the other player's picks.
  - **Sparring Partner, any era.** The only response before lock was
    `POST /v1/sets`, and it held pre-game fields only. Its `setToken`
    decodes to the guest id, the duel id, and the expiry, plus a signature.
    Answers appeared first in the submission response. The result showed the
    Sparring Partner disclosure and the model benchmark.
  - **Solo, any era.** Same outcome, with no answers before lock.
  - **Friend, era 2005–2011.** All five games came from that era.
    - After the creator locked in, their duel answered `waiting`, with no
      answers.
    - A second guest accepted the invite. The accept response held no
      answers and none of the creator's picks.
    - Once the second guest locked in, both sides showed the same revealed
      result (100 to −103).
  - Ranked is shown disabled, with "Needs an account".
- **Explorer with the API blocked.** Playwright loaded staging with every
  request to `api-staging.courtofalltime.win` aborted from the first load.
  `/`, `/1998-bulls-vs-2017-warriors`, `/tournament`, `/about`, and `/duel`
  all rendered, with no API request and no console error. The duel page
  makes no request until a set is started.
- **PR previews.** The `deploy-p2-finish` branch preview (`f39e6ab8`) serves
  `index-L9s-Q1rf.js`, which contains neither API address. Its header has no
  Duel link, and `/duel` says duel mode isn't available. The only console
  errors there came from the Web Analytics beacon, which CORS blocks on
  `*.pages.dev` hosts.
- **Load test.** 2026-09-30, 00:12–00:21 UTC, from the owner's Windows
  machine (edge `MIA`; D1 runs in `ENAM`).
  - The staging Worker was deployed with
    `--var RATE_LIMIT_SCALE:100` (version `b283c7e5`) rather than by editing
    `wrangler.jsonc`. A plain `npx wrangler deploy --env staging` then
    restored `"1"` (version `130bfc0e`). After that, `POST /v1/guests` from
    the same address answered 429, as it should.
  - Results: 4,542 requests at 37 a second, **0 server errors, and 18 of 18
    probes**. The guest burst hit 429 at request 996 (10 an hour × 100, less
    the run's own guests). The full figures are in the F09 Session 8 record,
    "Load and abuse test".
  - The first attempt failed at once: Cloudflare's edge refuses a
    client-supplied `cf-connecting-ip` with 403 (error 1000). The script
    now sends that header only on local runs.
- **Verified on this branch:** frontend build, lint, 146 unit, and 48
  Playwright tests; the Worker's tsc and 123 tests; 40 Python tests; the
  leakage guard exits 0. One Playwright account test
  (`account.spec.ts:141`) failed once and then passed on a rerun of all 48.
- **Differed from the plan.**
  - Claude Code's auto-mode classifier refused to let the agent change the
    Pages project through the API ("Modify Shared Resources"). Pages
    variables and domains are therefore owner dashboard steps.
  - Reading the project through the API is allowed. Use
    `GET /accounts/<id>/pages/projects/courtofalltime` with the wrangler
    OAuth token from `%APPDATA%/xdg.config/.wrangler/config/default.toml`.
    In Git Bash, set `MSYS_NO_PATHCONV=1` so the path is not rewritten.
  - The token cannot read DNS (zone read returns 403).
  - **Dashboard trap:** the Settings page has one environment selector, a
    box in the right-hand column that defaults to **Production**. A variable
    goes to whatever it shows. `VITE_DUEL_API` landed in Production twice
    (once as a Secret) before it was moved to Preview. No production build
    ran while it was there. Check this before every merge to `main` until
    phase 3.
  - Worker analytics can be read through the GraphQL API
    (`workersInvocationsAdaptive`) with the same token. Its CPU and wall
    times are in microseconds.
  - Machine dates: this machine's local date runs behind UTC in the
    evening. Analytics windows are in UTC.
- **Secrets saved.** On 2026-09-29 the owner confirmed that
  `DUEL_POOL_SALT` and the three staging secrets are saved. The agent then
  deleted the scratchpad `staging-secrets.json`. The staging secrets were
  also shown once in the agent's chat transcript. Replace them with
  `wrangler secret put … --env staging` if that is ever a concern.
- **Left for the owner:** disconnect the Workers Builds trigger left from
  phase 1 (see phase 1's Record).
**Kickoff prompt:**

```text
Deploy Court of All Time, phase 2 (staging duel server). Read
CONTRIBUTING.md, docs/product/HANDOFF.md, docs/product/DEPLOYMENT.md (phase 1
Record included), and docs/product/features/F09-continuation-handoff.md.
Make the repo changes on a branch with tests, then create and deploy the
staging Worker, D1, and KV, upload a freshly salted pool, turn on guest duel
mode on staging.courtofalltime.win, and run and record the load test. Tell me
exactly which dashboard steps and secrets I must handle. Fill in phase 2's
Record.
```

## Phase 3: guest duel mode in production

**Goal.** Guests play duel mode on `courtofalltime.win` against
`api.courtofalltime.win`. The sign-in form says sign-in isn't set up yet,
which is the built behaviour without a Turnstile site key. The firewall rate
limit and usage alerts are on.

**Agent steps:**

1. Create `court-of-all-time-duel`, plus its `POOL` and `RATE_LIMITS`
   namespaces (no `--env`). Put their ids in the top level of
   `wrangler.jsonc`, in a PR.
2. Set the production secrets: `GUEST_TOKEN_SECRET`, `SET_TOKEN_SECRET`, and
   `ADMIN_TOKEN`. Each is new; never reuse staging's.
3. Apply the migrations with `npx wrangler d1 migrations apply DB --remote`.
   Upload the **same** pool files as staging (same salt) with no `--env`.
4. **Stop and ask.** Deploy with `npx wrangler deploy`, add the custom domain
   route `api.courtofalltime.win`, and check `/v1/health`.
5. Firewall: add a WAF rate-limiting rule on `api.courtofalltime.win/v1/*`,
   for example 120 requests per 10 s per IP, with action block. The KV limits
   are soft; this rule is the hard edge. The owner adds it in the dashboard
   if the token cannot.
6. **Stop and ask.** Set the production Pages variable `VITE_DUEL_API` =
   `https://api.courtofalltime.win`, then retry the latest production
   deployment.
7. Check the live site:
   - `/duel` plays every guest mode;
   - the explorer and tournaments work with the API blocked;
   - the About page's duel privacy paragraph shows;
   - `/account` says sign-in isn't set up.
8. Usage alerts: have the owner add Cloudflare notifications for **Workers
   usage** and **D1 usage**. Set them against the Session 8 triggers: D1 rows
   read above 20B a month, and KV writes above 5M a month.

**Done when:**

- guests play on the live site;
- the WAF rule and usage alerts exist;
- a one-hour check shows no 5xx in the Worker's logs.

**Rollback.** Remove `VITE_DUEL_API` from production and redeploy the site.
Duel mode disappears, and the rest keeps working.

**Record.** _(fill in)_

**Kickoff prompt:**

```text
Deploy Court of All Time, phase 3 (guest duel mode in production). Read
CONTRIBUTING.md, docs/product/HANDOFF.md, and docs/product/DEPLOYMENT.md
(phases 1-2 Records included). Create the production Worker, D1, and KV, set
fresh secrets, upload the same pool as staging, and stop for my OK before
deploying the Worker and before switching VITE_DUEL_API on for production.
Set up the WAF rule and usage alerts with me. Fill in phase 3's Record.
```

## Phase 4: accounts and ranked, staging then production

**Goal.** Sign-in by email link, display names, ranked duels, and the
leaderboard work on staging, then on production.

**Owner steps:**

1. **Resend.**
   - Sign up, then add the domain `courtofalltime.win` and give the agent the
     DNS records it lists (SPF and DKIM TXT records, and an MX record for the
     bounce subdomain). The agent adds them to the zone.
   - Once Resend shows the domain verified, create an API key with **sending
     access only**, for this domain.
2. **Turnstile.**
   - In the dashboard, add one widget named "Court of All Time sign-in", in
     managed mode, with hostnames `courtofalltime.win` and
     `staging.courtofalltime.win`.
   - Give the agent the site key; it is public. Keep the secret key for
     `wrangler secret put`.

**Agent steps, staging first:**

1. Set the staging secrets with `wrangler secret put <NAME> --env staging`:
   - `EMAIL_HASH_SECRET`: new; the owner saves it, never to be rotated;
   - `EMAIL_API_KEY`: from Resend;
   - `TURNSTILE_SECRET_KEY`: from Turnstile.

   Set `EMAIL_FROM` in `env.staging.vars` to
   `Court of All Time <signin@courtofalltime.win>`. Never set
   `AUTH_TEST_DOUBLES`.
2. Set the Pages preview variable `VITE_TURNSTILE_SITE_KEY`. Then deploy the
   Worker to staging, and rebuild the `staging` branch.
3. On staging, run the whole account path with the owner's real email:
   - request a link, sign in, and check guest history carries over;
   - set a display name;
   - reach ranked eligibility (10 sets);
   - with a second account (a friend, or the owner's second address), play a
     ranked duel through the queue;
   - see both players on the leaderboard after the next scheduled run;
   - run `ADMIN_TOKEN=… DUEL_API=https://api-staging.courtofalltime.win node scripts/review-queue.mjs list`;
   - delete a test account.
4. **Stop and ask.** Repeat for production:
   - production secrets, each new, with `EMAIL_HASH_SECRET` separate from
     staging's;
   - `EMAIL_FROM` at the top level;
   - the production Pages variable `VITE_TURNSTILE_SITE_KEY`;
   - `npx wrangler deploy`, then redeploy the site;
   - sign in once on production to confirm, then delete that test account
     unless the owner keeps it.

**Done when:**

- sign-in, names, ranked, the board, review, and deletion work on production;
- email arrives from `signin@courtofalltime.win` and passes SPF and DKIM (check
  the message headers).

**Rollback.** Remove `VITE_TURNSTILE_SITE_KEY` from production and redeploy.
Sign-in shows "isn't set up", and guest play continues. Existing accounts stay
in D1.

**Record.** _(fill in)_

**Kickoff prompt:**

```text
Deploy Court of All Time, phase 4 (accounts and ranked). Read
CONTRIBUTING.md, docs/product/HANDOFF.md, and docs/product/DEPLOYMENT.md
(phases 1-3 Records included). Walk me through Resend and Turnstile setup,
add the DNS records, set the account secrets on staging, test the whole
account and ranked path there with me, then stop for my OK before doing the
same in production. Fill in phase 4's Record.
```

## Phase 5: soft launch

**Goal.** A week of real play by the owner and invited friends, then a public
announcement.

**Steps:**

1. The owner invites a handful of friends. Everyone plays each mode, and at
   least two players play ranked against each other repeatedly.
2. **Daily:**
   - the owner runs `review-queue.mjs list` and clears or upholds each flag;
   - the agent (when in session) checks the Worker's logs for 5xx and the
     usage figures.
3. Collect friction. Any bug found becomes a normal fix PR, verified on
   staging first.
4. **After a week with no open 5xx and no unexplained flags**, the owner
   announces.
5. Update `HANDOFF.md`: the live URL, the date, and the decision-log entry
   "Duel mode launched on courtofalltime.win".

**Done when:** the owner has announced, and the launch is recorded.

**Record.** _(fill in)_

**Kickoff prompt:**

```text
Court of All Time, phase 5 (soft launch). Read docs/product/DEPLOYMENT.md
(phases 1-4 Records). Check the Worker's logs and usage since launch, help me
review the flag queue, and turn anything the testers found into fix PRs
verified on staging first. When I say we're ready, record the launch in
HANDOFF.md.
```

## Phase 6 (later): interest form and event analytics

This is not part of the launch. When the owner wants it:

- choose an event-analytics provider (see `features/F05-growth-and-demand.md`
  and `analytics/weekly-dashboard.md`); the price-interest form and its
  `VITE_INTEREST_ENDPOINT` were removed with the pricing page;
- set the provider settings in Pages;
- confirm the About page's privacy text still matches what is collected.

## What each phase costs

Everything runs inside the Workers Paid base price of $5 a month at launch
volume (F09 Session 8 cost model). Additional costs:

- **The domain:** already bought.
- **Resend:** free up to 3,000 emails a month.
- **Turnstile, Web Analytics, Pages, and the WAF rule:** free on this plan.
