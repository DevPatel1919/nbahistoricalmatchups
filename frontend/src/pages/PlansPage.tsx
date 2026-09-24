// Proposed plans (F05 demand test). Everything here is free today; the cards
// record purchase intent and nothing is sold. See data/offers.ts.

import { Link } from "react-router-dom";
import OfferPanel from "../components/OfferPanel";
import { CREATOR_OFFER, FAN_OFFERS } from "../data/offers";

export default function PlansPage() {
  return (
    <div className="plans">
      <header className="tournament__header">
        <h1>Plans</h1>
        <p className="tournament__meta">
          Matchups, the Champions bracket, and sharing are free and stay free. We're gauging interest in these paid
          extras before building them.
        </p>
      </header>

      <OfferPanel surface="plans" audience="fan" offers={FAN_OFFERS} heading="For fans" />

      <OfferPanel
        surface="plans"
        audience="creator"
        offers={[CREATOR_OFFER]}
        heading="For creators"
        intro="Podcasts, newsletters, and video channels: an all-time debate every week without the research hours."
      />

      <p className="tournament__hint">
        Prices are proposals and may change. Results are model estimates for entertainment, not betting advice. Start
        with a free <Link to="/tournament">Champions bracket</Link>.
      </p>
    </div>
  );
}
