# Weekly growth dashboard (F05)

One page, reviewed weekly. Every number is a count of analytics events for the
ISO week (Monday to Sunday, UTC) unless stated. Event names and properties are
the schema in `frontend/src/lib/analytics.ts` (`ANALYTICS_SCHEMA_VERSION` 1,
sent as the `schema` property). Always record the **denominator** next to
each rate; a rate without its count is not reported.

Status: **defined, not yet live.** Custom events need a provider. The code sends
them to Plausible once `VITE_PLAUSIBLE_DOMAIN` is set for the Pages build (see
"Provider setup"). Until then, only Cloudflare Web Analytics page views exist.

## Provider setup (owner)

1. Choose the provider. Plausible (cloud or self-hosted) is wired in
   `frontend/src/lib/analyticsProviders.ts`: cookie-free, no consent banner,
   custom properties. Any other provider is one new sink in that file.
2. In Plausible, add the site and create a **goal** for each event name below
   (Custom event goals). Add each property name under custom properties.
3. In the Cloudflare Pages build environment, set `VITE_PLAUSIBLE_DOMAIN`
   (and `VITE_PLAUSIBLE_HOST` if self-hosted). Redeploy.
4. For email interest and creator demo requests, set `VITE_INTEREST_ENDPOINT`
   to a form endpoint the owner controls (a form service, or the F09 Worker once
   it exists). It receives `{ email, kind, source }` as JSON. Without it, the
   forms say sign-ups are not open and no email is collected.
5. Confirm on a preview deploy: complete a matchup and see `matchup_completed`
   in the provider's realtime view.

Visitors are excluded when they opt out on `/about`, or when the browser sends
Global Privacy Control or Do Not Track. Report the counts as "among visitors
who allow analytics".

## Public-product gate (HANDOFF.md)

| Metric | Formula | Gate |
|---|---|---|
| Visits | count `visit_started` (one per browser session) | 1,000 targeted visits |
| Activation | unique visitors converting on the `matchup_completed` goal / unique visitors (not an event ratio: one visitor can complete many matchups) | >= 25% complete a matchup |
| Share or email | (unique visitors converting on `matchup_shared` or `tournament_shared` or `email_interest_submitted`) / unique visitors | >= 8% |
| 7-day return (cohort) | for cohort week W: count `visit_started` where `firstReturn = true` and `daysSinceFirstVisit = 1-7` and `cohortWeek = W`, divided by count `visit_started` where `visitKind = first` and `cohortWeek = W`. Read W two weeks back, so every member has had 7 days. | >= 20% |

Unique visitors come from the provider's own daily-rotating, cookie-free
counting. The site never sends an identifier.

## Funnel detail

| Metric | Formula |
|---|---|
| Matchup starts by surface | `matchup_started` grouped by `entrySurface` |
| Start -> complete | `matchup_completed` / `matchup_started` (a gap means load errors or challenge links left unanswered) |
| Extrapolation share | `matchup_completed` with `extrapolationWarning = true` / all `matchup_completed` |
| Tournament funnel | `tournament_started` -> `bracket_predictions_completed` -> `tournament_revealed` -> `tournament_shared`, each by `tournamentId` |
| Reveal mode | `tournament_revealed` grouped by `revealMode` |
| Share method | `matchup_shared` and `tournament_shared` grouped by `shareMethod` |
| Errors | `app_error` grouped by `surface` and `code` (e.g. invalid tournament links) |
| Top teams | `teamA` and `teamB` of `matchup_completed`, combined |
| Top tournaments | `tournament_started` grouped by `tournamentId` |

## Fan-payment gate

| Metric | Formula | Gate |
|---|---|---|
| Offer exposure | `offer_viewed` where `audience = fan`, by `surface` | denominator |
| Qualified price intent | unique visitors converting on `price_intent_clicked` with `audience = fan` and `qualified = true` | >= 25 |
| Intent by offer | `price_intent_clicked` (fan) grouped by `offerId` / fan `offer_viewed` on the same surfaces | the $49/year vs $9.99 test |
| Follow-up step | `email_interest_submitted` whose `sourceSurface` ends in a fan offer id | >= 10 |
| Repeat use | the public-product 7-day return | must pass first |
| Paid job named in interviews | **missing: interview notes, manual** | recorded in F07 |

## Creator-product gate

| Metric | Formula | Gate |
|---|---|---|
| Creator offer exposure | `offer_viewed` where `audience = creator` | denominator |
| Creator price intent | `price_intent_clicked` where `audience = creator` | tracked, no gate |
| Inbound demo requests | `creator_demo_requested` | supplementary |
| Outreaches, replies, calls, paid pilots, renewals | **missing: tracked manually in the F06 pilot log** | 30 / 5 / 2 / 1 |
| Repeated production step | **missing: F06 interview notes** | named in F06 |

## B2B gate

Demonstrations, pilot commitments, and embed engagement are not measurable
until F08 exists. **Missing** from this dashboard by design.

## Experiments

Live and past experiments are recorded in
[`../experiments.md`](../experiments.md), with numerators, denominators, and
dates. The share-framing arm is not an event property on the recipient side;
compare `matchup_started` with `entrySurface = shared-plain` against
`shared-challenge`, and `matchup_shared` grouped by `variant`.

## Unmet measurement needs

- No provider is configured, so no custom event is collected yet (owner step 1-3).
- No email endpoint is configured, so `email_interest_submitted` and
  `creator_demo_requested` cannot fire (owner step 4).
- Unique-visitor rates depend on the provider's cookie-free visitor counting,
  which resets daily; multi-day uniqueness uses the cohort events instead.
- Creator and B2B gates are mostly manual (F06, F08).
