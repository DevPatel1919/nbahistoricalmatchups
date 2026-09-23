# F00: Commercial rights and brand gate

Status: **blocked on owner/legal action**. Research exists; written clearance
does not.

## Outcome

Produce a written, reviewable basis for every intended commercial use of the
data and derived model output. Establish independent brand rules that product
agents can apply without guessing.

This feature permits commercial launch; it does not implement product UI.

## Read first

- `docs/product/HANDOFF.md`
- `reports/monetization_research.md`
- `backend/scripts/import_dataset.py`
- the current data-provider terms linked by the research report

## Work

1. Inventory every source used by the training, profile, export, and public
   display pipelines.
2. Request written terms or quotes covering historical storage, ML training,
   derived probabilities, public display, consumer subscriptions, advertising,
   sponsorship, creator deliverables, API responses, white-label widgets, and
   archival retention after termination.
3. Compare at least two commercially licensable routes with the current source.
4. Have qualified counsel review the selected route and the intended product.
5. Record approved attribution, retention, branding, and prohibited-use rules.
6. Review the Court of All Time name, plain-text team references, disclaimer,
   colors, and representative screens.

## Deliverable

Create `docs/product/commercial-rights-register.md` containing:

- source/provider and contract owner;
- written permission or contract reference;
- effective/renewal dates and cost;
- approved and prohibited uses;
- attribution and deletion/retention obligations;
- approved branding rules and disclaimer;
- counsel review date and unresolved questions.

Do not store confidential contracts, quotes, credentials, or legal advice in
the repository. Link to their controlled location using a non-secret reference.

## Completion criteria

- Every data source in the production lineage is accounted for.
- Each product use in the master handoff is explicitly allowed, prohibited, or
  deferred; there are no "probably allowed" cells.
- The owner can identify which commercial features may launch and the cost floor
  they add to unit economics.
- Brand and attribution rules can be applied by F02, F06, F07, and F08 without
  interpretation.

## Agent kickoff prompt

> Own F00. Read `CONTRIBUTING.md`, `docs/product/HANDOFF.md`, and this brief.
> Audit the complete production data lineage and prepare or update the
> non-confidential commercial-rights register. Do not infer permission from a
> public license label; record written evidence and exact permitted uses. Do not
> enable payments or advertising. Finish by updating this brief's status and
> listing every unresolved owner/legal action.

## Handoff record

Record dated evidence, remaining decisions, and the next responsible party here.

