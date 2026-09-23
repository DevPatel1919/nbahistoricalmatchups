# F05: Sharing, analytics, and demand validation

Status: **integrates after F02; extend after F04**.

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

