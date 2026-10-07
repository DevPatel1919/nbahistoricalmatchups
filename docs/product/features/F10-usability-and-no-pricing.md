# F10: Usability pass and pricing removal

Status: **pricing removal done (PR remove-pricing-page); usability pass not started. Decided 2026-09-26.**

## Outcome

The whole public site is easier to use, and nothing on it shows prices or
asks for purchase intent. The matchup explorer stays the core of the product
and keeps working exactly as it does now: pick any two team-seasons, get the
neutral-court result, and share a stable link.

## Decisions (owner, 2026-09-26)

- **The pricing page goes away completely.** That means:
  - the `/plans` route and `pages/PlansPage.tsx`;
  - the "Plans" link in `components/Layout.tsx`;
  - the fan-plan `OfferPanel` on the tournament summary
    (`pages/TournamentPage.tsx`);
  - `components/OfferPanel.tsx`, `components/InterestForm.tsx`, and
    `data/offers.ts`, once nothing imports them;
  - the `price_intent_clicked` and `email_interest_submitted` analytics
    events, unless another surface still sends them;
  - the About page's privacy text that mentions "a price button clicked".
- **An old `/plans` link must not land on a broken page.** `/plans` currently
  falls through to the `:matchupSlug` route once its own route is removed, so
  send it to the home page (a `<Navigate replace>` route) or to the site's
  not-found state. Add a test for it.
- **The matchup explorer is protected.** Every change in this brief keeps the
  explorer, tournaments, and share links working with the duel API
  unreachable, and keeps every existing matchup URL stable.
- **"Easier to use" covers the full site.** That includes the home page, the
  matchup page, tournaments, duel mode, account, and About. The session starts
  with an audit and agrees the change list with the owner before building.
- **This supersedes earlier decisions.** Showing prices and collecting purchase intent
  from launch (HANDOFF monetization step 2, F05 demand experiments) is
  paused. It comes back only with an owner decision, after F00 clears the
  data rights.

## Owned surface

- `frontend/` UI: layout, navigation, pages, components, copy, and styles;
- removing the pricing surfaces listed above and their tests;
- the unit and Playwright tests for everything changed.

F10 does not own the model, the exported data, the tournament engine math,
the duel Worker, or its API contract.

## Audit starting points

The deployment session noticed these on the live site on 2026-09-26. They are
starting points for the audit, not an agreed list:

- The top navigation offers Tournament, Plans, and About. With Plans gone,
  check whether the matchup picker and duel mode are easy to find from every
  page.
- The home page is long. Suggested matchups and 30 franchise tiles follow the
  picker and the Champions Bracket card. Check how it reads on a phone.
- The Champions Bracket card says "reveal how the model's plays out".
  Something is missing after "model's".

## Completion criteria

- No page, link, or component shows a price, plan, or purchase-intent button.
  `grep -rniE "price|plans|offer" frontend/src` finds only unrelated uses.
- `/plans` redirects or shows not-found, with a test.
- The agreed usability changes are built and checked at phone and desktop
  widths.
- The explorer, tournaments, and share links pass their tests with the duel
  API unreachable.
- `npm run build`, `npm run lint`, `npm test`, and `npm run test:e2e` pass in
  `frontend/`.
- The PR's Cloudflare Pages preview link was checked before merging.
- HANDOFF.md's product boundaries and F05's demand-experiment section say
  pricing is removed.

## Agent kickoff prompt

```text
Build F10 (usability pass and pricing removal) for Court of All Time. Read
CONTRIBUTING.md, docs/product/HANDOFF.md, and
docs/product/features/F10-usability-and-no-pricing.md in full. Remove every
pricing surface the brief lists. Then audit the whole site for ease of use at
phone and desktop widths, and propose a short change list to me before
building. Keep the matchup explorer and every existing URL working. Work on
the branch f10-usability, run the brief's completion checks, check the PR
preview link, and fill in the handoff record.
```

## Handoff record

_(fill in)_
