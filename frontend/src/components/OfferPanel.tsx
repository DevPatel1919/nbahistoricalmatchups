// Clearly priced, non-transactional offers (F05 demand tests). A click records
// price intent; nothing is sold. Intent counts as "qualified" only when this
// browser has already completed a core job (a matchup or a revealed bracket).

import { useEffect, useRef, useState } from "react";
import { track } from "../lib/analytics";
import { hasCompletedCoreJob } from "../lib/visitor";
import type { Audience, Offer } from "../data/offers";
import InterestForm from "./InterestForm";

interface Props {
  /** Where the panel is shown, e.g. "plans" or "tournament-summary". */
  surface: string;
  audience: Audience;
  offers: readonly Offer[];
  heading: string;
  intro?: string;
}

export default function OfferPanel({ surface, audience, offers, heading, intro }: Props) {
  const [chosen, setChosen] = useState<Offer | null>(null);
  const reported = useRef(false);

  // The exposure count: the denominator for every price-intent rate.
  useEffect(() => {
    if (reported.current) return;
    reported.current = true;
    track({ name: "offer_viewed", surface, audience });
  }, [surface, audience]);

  const handleIntent = (offer: Offer) => {
    setChosen(offer);
    track({
      name: "price_intent_clicked",
      audience: offer.audience,
      offerId: offer.id,
      displayedPrice: offer.price,
      qualified: hasCompletedCoreJob(),
    });
  };

  return (
    <section className="offer-panel" aria-label={heading}>
      <h2>{heading}</h2>
      {intro && <p className="offer-panel__intro">{intro}</p>}
      <p className="offer-panel__badge">Not on sale yet. We're checking what people would pay for.</p>
      <div className="offer-panel__grid">
        {offers.map((offer) => (
          <article key={offer.id} className={`offer${chosen?.id === offer.id ? " offer--chosen" : ""}`}>
            <h3>{offer.name}</h3>
            <p className="offer__price">
              <span className="scoreboard">{offer.price}</span> <span className="offer__cadence">{offer.cadence}</span>
            </p>
            <p className="offer__pitch">{offer.pitch}</p>
            <ul>
              {offer.includes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {chosen?.id === offer.id ? (
              <InterestForm
                sourceSurface={`${surface}:${offer.id}`}
                kind={offer.audience === "creator" ? "creator-demo" : "email-interest"}
                prompt={
                  offer.audience === "creator"
                    ? "Leave your email and we'll set up a short demo."
                    : "It isn't available yet. Want an email when it is?"
                }
              />
            ) : (
              <button type="button" className="btn btn--primary" onClick={() => handleIntent(offer)}>
                {offer.audience === "creator" ? `I'd pay ${offer.price} for this` : `I'd buy this for ${offer.price}`}
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
