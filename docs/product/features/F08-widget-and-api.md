# F08: Publisher widget and derived-results API

Status: **discovery only until F00 and the B2B demand gate are satisfied**.

## Outcome

Let an approved publisher embed the fan experience or consume narrowly scoped
derived matchup results while preserving rights, attribution, performance, and
support boundaries.

## Entry requirements

- F00 explicitly permits paid third-party embeds/API delivery and defines
  attribution, caching, redistribution, and prohibited uses.
- F01 supplies a versioned model/export contract.
- F05 can measure publisher engagement.
- Ten qualified demos yield at least one written pilot commitment.
- A standard pilot agreement defines permitted display, rate limits, support,
  termination, data retention, and prohibited gambling use.

## Product order

Build the hosted iframe/widget before a general API. It delivers the complete
experience, is easier to version, limits redistribution, and proves publisher
value. Add an API only after a customer demonstrates a use the widget cannot
serve.

## Widget pilot

- allowlisted publisher origins;
- responsive hosted embed with matchup or tournament configuration;
- publisher theme tokens within brand/accessibility limits;
- visible required attribution and independent-product disclaimer;
- isolated analytics for impressions, completed interactions, shares, and
  email handoff where approved;
- versioned postMessage events with origin validation;
- graceful loading/error states and a global disable switch.

## Candidate API

Return derived results only, never bulk source profiles or downloadable model
artifacts. Start with a versioned matchup endpoint, authentication, per-customer
rate limits, idempotent usage metering, structured errors, and model/data version
metadata. Do not promise real-time data; the historical export refresh is annual.

## Completion criteria

- A pilot publisher can embed the widget without custom code beyond the supplied
  snippet and can measure the agreed outcome.
- Origin checks, content security policy, rate limits, cache behavior, tenant
  isolation, required attribution, and disable/termination behavior are tested.
- Widget events are documented and versioned.
- Any API response stays inside F00 rights and contract boundaries.
- The support burden and contribution margin are measured during the pilot.
- Pilot continuation is decided from retained usage and customer outcome, not
  initial enthusiasm.

## Agent kickoff prompt

> Own F08 discovery or implementation according to its gates. Read
> `CONTRIBUTING.md`, `docs/product/HANDOFF.md`, this brief, F00's rights
> register, and F05's B2B evidence. If the gate is unmet, conduct demos and
> document requirements rather than building infrastructure. If met, build the
> hosted widget first with strict origin, attribution, analytics, and disable
> controls. Add an API only for a validated unmet use. Update this brief with
> customer evidence, interface versions, tests, economics, and support findings.

## Handoff record

Record pilot customer type, validated outcome, widget/API contracts, test
evidence, economics, and next decision.

