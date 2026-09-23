# Experiment record

One row per experiment arm. An experiment starts on the date its provider
starts collecting events (not the code merge date) and ends on a pre-set date.
Record numerator and denominator counts, not only rates; a result without its
denominator is not a result. Metric definitions are in
[`analytics/weekly-dashboard.md`](analytics/weekly-dashboard.md).

Status as of 2026-09-23: **built, not started.** No analytics provider is
configured, so no experiment has collected data. Fill in Start when the
provider goes live.

| ID | Variant | Audience | Start | End | Numerator | Denominator | Result | Decision |
|---|---|---|---|---|---|---|---|---|
| `fan-price-v1` | `fan-annual-49`: Fan membership $49/year | visitors shown fan offers (`/plans`, tournament summary) | - | start + 6 weeks, or 1,000 fan `offer_viewed` | qualified `price_intent_clicked` for this offer | fan `offer_viewed` | - | - |
| `fan-price-v1` | `tournament-pass-999`: Tournament pass $9.99 | same | - | same | qualified `price_intent_clicked` for this offer | fan `offer_viewed` | - | - |
| `share-framing-v1` | `plain`: result link (`?via=share`) | sharers, assigned 50/50 per browser | - | start + 6 weeks, or 200 shares per arm | recipients' `matchup_completed` after `matchup_started` with `entrySurface = shared-plain` | `matchup_started` with `entrySurface = shared-plain` | - | - |
| `share-framing-v1` | `challenge`: "make your pick first" link (`?via=challenge`) | same | - | same | recipients' `challenge_answered` (then `matchup_completed`) | `matchup_started` with `entrySurface = shared-challenge` | - | - |
| `creator-positioning-v1` | `creator-pilot-99`: "Skip the research", time-saved copy | visitors to `/plans` | - | with `fan-price-v1` | `creator_demo_requested` + creator `price_intent_clicked` | creator `offer_viewed` | - | - |

## Design notes

- **Fan price.** Both offers are shown side by side, not split between
  visitors: at this traffic level a split halves an already small sample.
  The comparison is clicks per exposure for each offer. Only `qualified = true`
  clicks (the browser had completed a matchup or revealed a bracket) count
  toward the fan-payment gate. The $49 vs $9.99 comparison favors the cheaper
  option on raw clicks, so read it together with the follow-up email step.
- **Share framing.** The arm is sticky per sharer browser
  (`localStorage` key `ct:experiment:share-framing-v1`), and recipients see the
  arm through the link's `?via=`. Secondary: re-share rate among recipients,
  `matchup_shared` after a `shared-*` entry in the same session.
- **Creator positioning.** Only one creator message is live, so this measures
  demand for the time-saved framing; it is not a comparison. A second message is
  a new row with a new offer id.
- Changing a price or message means a new offer id and a new row. Never edit a
  running arm.
