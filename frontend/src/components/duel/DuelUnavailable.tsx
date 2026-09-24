import { Link } from "react-router-dom";

/** Shown when this build has no duel API, so the rest of the site is untouched. */
export default function DuelUnavailable() {
  return (
    <section className="duel duel--unavailable">
      <h1>Duel mode</h1>
      <p className="center-note" role="status">
        Duel mode isn't available right now. The <Link to="/">matchup explorer</Link> and{" "}
        <Link to="/tournament">tournament</Link> work as usual.
      </p>
    </section>
  );
}
