# F07: Paid plans and entitlements

Status: **deferred until F00 clearance and a demand gate is met**.

## Outcome

Add reliable payment, cancellation, access, and audit behavior for an already-
validated paid job. F07 monetizes proven value; it does not create demand.

## Entry requirements

All must be true:

- F00 explicitly permits the intended paid use and the data license cost is in
  unit economics;
- the payment provider has accepted an accurate entertainment/creator product
  description;
- either F06's creator-product gate or `HANDOFF.md`'s fan-payment gate is met;
- the owner has approved exact offer names, prices, refund terms, and launch
  geography;
- privacy policy, terms, cancellation, and support contact are ready.

If a requirement is missing, leave checkout disabled and continue collecting
explicit price intent through F05.

## Owned interface

```ts
type Entitlement =
  | "fan_private_tournaments"
  | "fan_saved_history"
  | "creator_exports"
  | "creator_brand_kit"
  | "publisher_embed";

type AccessDecision = {
  allowed: boolean;
  reason: "granted" | "upgrade_required" | "signed_out" | "unavailable";
};
```

Other features consume this interface. They do not inspect provider product IDs
or subscription status directly.

## Work

1. Write a short decision record comparing the approved payment options,
   merchant-of-record/tax responsibility, fees, webhook guarantees, and product
   restrictions.
2. Implement server-owned checkout/session creation and signed webhook handling.
3. Make webhook processing idempotent and preserve an auditable subscription
   state transition log without storing card data.
4. Implement account linkage, entitlement evaluation, billing portal,
   cancellation, refunds/support flow, and failure recovery.
5. Keep the free core fully functional.
6. Add a global commerce kill switch independent from deployment.

## Completion criteria

- Test-mode purchase, renewal, cancellation, failed payment, refund, duplicate
  webhook, delayed webhook, and out-of-order webhook scenarios pass.
- Entitlements are derived server-side and cannot be granted by client changes.
- A user can cancel without contacting support and retains access only for the
  documented period.
- Checkout is impossible when the rights or commerce kill switch is closed.
- Prices, trial terms, renewal, refund, and cancellation copy match the approved
  offer.
- Unit economics include processor, tax/MoR, data license, hosting, refund, and
  support assumptions.

## Agent kickoff prompt

> Implement F07 only after proving every entry requirement in this brief. Read
> `CONTRIBUTING.md`, `docs/product/HANDOFF.md`, F00's rights register, and the
> applicable F05/F06 evidence. Write the provider decision record, then build
> server-owned checkout, idempotent webhooks, cancellation, entitlements, and a
> commerce kill switch. Preserve the free core. Update this brief with approved
> offers, architecture, test scenarios/results, and rollback instructions.

## Handoff record

Record satisfied gates, provider, offer IDs in secure configuration, deployment,
test evidence, and rollback procedure.

