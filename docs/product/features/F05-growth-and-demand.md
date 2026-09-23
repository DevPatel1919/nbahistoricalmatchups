# F05: Sharing, analytics, and demand validation

Status: **built (2026-09-23); measurement starts when the owner configures a provider.** See the handoff record.

## Outcome

Measure whether users complete, share, return, and express qualified purchase
intent. Create attractive original sharing artifacts without introducing a
paywall or collecting unnecessary personal data.

## Canonical events

Use these names across features:

| Event | Required properties |
|---|---|
| `matchup_started` | entry surface |
| `matchup_completed` | team keys, extrapolation warning present |
| `matchup_shared` | surface, share method |
| `tournament_started` | tournament id, entrant count |
| `bracket_predictions_completed` | tournament id |
| `tournament_revealed` | tournament id, reveal mode |
| `tournament_shared` | tournament id, share method |
| `email_interest_submitted` | source surface |
| `price_intent_clicked` | audience, offer id, displayed price |
| `creator_demo_requested` | source surface |

Do not send names, email addresses, free text, full URLs containing personal
state, or other sensitive data as analytics properties.

## Work

1. Add a vendor-neutral typed analytics adapter; initially connect the approved
   privacy-preserving provider.
2. Track the funnel without blocking core interactions when analytics fails.
3. Generate original matchup and tournament share images, or provide a stable
   render route that can later drive server-side social previews.
4. Add explicit interest actions with visible proposed prices. Before F00 clears
   commerce, these collect intent and do not take payment.
5. Define a small weekly dashboard for activation, sharing, return, price intent,
   creator leads, errors, and top teams/tournaments.
6. Document experiment start/end dates and preserve denominator counts.

## Demand experiments

- Test `$49/year` Fan membership against a `$9.99` tournament pass as
  non-transactional intent.
- Test creator positioning around time saved, not model accuracy.
- Compare a plain result share with a challenge framing: "Make your pick before
  revealing the model."
- Count qualified intent only after a user has completed the relevant core job.

## Completion criteria

- Every canonical event fires once at its defined transition and is covered by
  tests or a development event log.
- Opt-out or analytics failure leaves the product fully usable.
- A matchup and completed tournament produce readable 1200x630 original share
  images without logos or player imagery.
- The weekly dashboard can calculate every public-product, creator, and fan-
  payment gate from `HANDOFF.md` or explicitly states which metric is missing.
- An experiment record identifies variant, audience, dates, numerator,
  denominator, result, and decision.

## Agent kickoff prompt

> Implement F05 against the current F02/F04 surfaces. Read
> `CONTRIBUTING.md`, `docs/product/HANDOFF.md`, and this brief. Preserve the
> canonical event vocabulary, add a typed failure-tolerant adapter, build
> original share artifacts, and implement clearly priced intent actions without
> checkout. Avoid sensitive analytics properties. Update this brief with event
> locations, provider/configuration, dashboard query, and experiment results.

## Handoff record

Record provider, event schema version, dashboard location, experiment results,
and unmet measurement needs.

### 2026-09-23: growth v1

**Provider and configuration.** `frontend/src/lib/analytics.ts` stays the one
typed, vendor-neutral adapter (`track` + sinks); a throwing sink is swallowed.
`lib/analyticsProviders.ts` adds a Plausible events-API sink (cookie-free, so
the "no consent banner" decision holds), registered in `main.tsx` only when
`VITE_PLAUSIBLE_DOMAIN` is set (`VITE_PLAUSIBLE_HOST` for self-hosting). It
sends origin + path only (no query or fragment) and adds `schema: 1`.
**No provider is configured yet: choosing one is an owner step.** Typed env
vars are in `src/env.d.ts`. In development every event is also logged to
`window.__ctAnalytics`, which the e2e suite reads.

Opt-out: `/about` has a "Privacy & analytics" section with a toggle
(`ct:analytics-opt-out` in localStorage). Global Privacy Control and Do Not
Track are always honored. Opted out, `track` sends nothing and the product is
unchanged (tested).

**Event schema v1 and locations.** The F02 names `matchup_viewed` and
`matchup_link_copied` were alternate names for canonical actions and are
replaced.

| Event | Fired | Properties |
|---|---|---|
| `matchup_started` | `ResultPage`, once per navigation + pair, when a canonical pair begins loading | `entrySurface`: home-search, browse, suggested, random, swap, direct, shared-plain, shared-challenge |
| `matchup_completed` | `ResultPage`, when the result is on screen (after the pick on a challenge link) | `teamA`, `teamB`, `extrapolationWarning` (a team missed the playoffs) |
| `matchup_shared` | copy link, or share image | `surface`, `shareMethod` (copy/image), `variant` |
| `tournament_*`, `bracket_predictions_completed` | F04 (see its brief); `tournament_shared` also has `shareMethod: image` | unchanged |
| `price_intent_clicked` | `OfferPanel` buttons | `audience`, `offerId`, `displayedPrice`, `qualified` (browser already completed a matchup or revealed a bracket) |
| `email_interest_submitted` / `creator_demo_requested` | `InterestForm`, only after the owner endpoint accepts the email | `sourceSurface` (`<surface>:<offerId>`) |
| `visit_started` *(added)* | `main.tsx`, once per browser session | `visitKind`, `cohortWeek` (ISO week of first visit), `daysSinceFirstVisit` bucket, `firstReturn` |
| `offer_viewed` *(added)* | `OfferPanel` mount, once | `surface`, `audience` (the price-test denominator) |
| `challenge_answered` *(added)* | challenge link pick | `agreedWithModel` |
| `app_error` *(added)* | data-load failures, invalid tournament links | `surface`, `code` |

No property carries a name, email, free text, or URL (tested). The email goes only
to `VITE_INTEREST_ENDPOINT`. Return measurement stores only the first-visit date
and a returned flag locally (`lib/visitor.ts`); no identifier leaves the browser.

**Share artifacts.** `src/share/cards.ts` draws original 1200x630 cards
(court lines, hardwood, type; no logos or player imagery) for a matchup and a
tournament. Uses: the "Share image" button on the result page and tournament
summary (share sheet with the PNG when the browser can share files, otherwise
a download; the fan can opt in to printing their score), and the stable render routes
`/card/m/<matchup-slug>` and `/card/t/<tournament-code>`. The routes render
outside the layout at exactly 1200x630 and set `data-card-state="ready"` (or
`"error"`) on the canvas, for a later server-side screenshotter to produce
`og:image`. Tournament cards from the route show the model story only, never
picks. Percentages never round to 100% or 0% (">99.9%", "<0.1%"). Drawing waits
for the non-blocking Google Fonts stylesheet before `document.fonts.load`, which
otherwise resolves immediately on a cold load.

**Intent actions.** `/plans` (header nav "Plans") and the tournament summary
show the offers in `src/data/offers.ts`: Fan membership `$49/year`
(`fan-annual-49`), Tournament pass `$9.99` (`tournament-pass-999`), Creator pilot
`$99` for four weekly packages (`creator-pilot-99`, F06's test price, time-saved
copy). Every panel says "Not on sale yet". A click records intent, then offers an
email follow-up, or says sign-ups are not open when no endpoint is configured.
There is no checkout or payment field (tested).

**Challenge framing.** A sharer's browser is assigned `plain` or `challenge`
(50/50, sticky). Copied links get `?via=share` or `?via=challenge`; a challenge
link asks the recipient to pick before showing the result, then says whether the
model agrees. `?via=` survives the reverse-order redirect.

**Dashboard.** [`../analytics/weekly-dashboard.md`](../analytics/weekly-dashboard.md)
defines every public-product and fan-payment gate metric from these events, and
lists the creator/B2B metrics that stay manual.

**Experiments.** [`../experiments.md`](../experiments.md) records
`fan-price-v1`, `share-framing-v1`, and `creator-positioning-v1` with variant,
audience, end rule, numerator, and denominator. None has started: there is no
provider yet.

**Verification.**

| Check | Command | Result |
|---|---|---|
| Unit | `cd frontend && npm test` | 103 passed (13 new in `tests/unit/growth.test.ts`) |
| E2E | `cd frontend && npx playwright test` | 34 passed (12 new in `tests/e2e/growth.spec.ts`) |
| Types + build | `cd frontend && npm run build` | passes |
| Lint | `cd frontend && npm run lint` | clean |

E2E covers: every matchup event exactly once from the home search, with the
copied link's `?via=`; the extrapolation flag; the challenge flow and its event
order; attribution through the redirect; opt-out and GPC silence with the
product still working; both card routes at 1200x630 with real pixel content
and error states; the result-page PNG download (dimensions read from the PNG
header); qualified vs unqualified price intent with no payment inputs; the
tournament summary image share and offer exposure.

**Unmet measurement needs (owner).**
1. Choose and configure the analytics provider (dashboard doc, "Provider setup").
2. Provide an email/demo endpoint and approve its privacy wording.
3. Server-side `og:image` previews: the render routes exist, but link unfurls
   need a Worker or build step to screenshot them (F09 introduces the Worker).
4. F00 still blocks any sale; the offers stay intent-only.

