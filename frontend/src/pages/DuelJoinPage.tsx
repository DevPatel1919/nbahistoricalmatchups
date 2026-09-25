import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import DuelUnavailable from "../components/duel/DuelUnavailable";
import { track } from "../lib/analytics";
import { DUEL_API, DuelApiError, acceptInvite, describeDuelError } from "../lib/duelApi";

function inviteFromFragment(): string | null {
  return new URLSearchParams(window.location.hash.slice(1)).get("invite");
}

/**
 * /duel/join#invite=… : a friend's duel invite. Nothing is claimed until the
 * player chooses to start, because starting begins their 20 minutes.
 */
export default function DuelJoinPage() {
  const navigate = useNavigate();
  const [invite] = useState(inviteFromFragment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    invite ? null : describeDuelError(new DuelApiError("invite_unavailable", 404)),
  );

  if (!DUEL_API) return <DuelUnavailable />;

  const start = async () => {
    if (!invite) return;
    setBusy(true);
    setError(null);
    try {
      const { duelId, set } = await acceptInvite(invite);
      if (set) track({ name: "duel_started", mode: "friend", drawKind: set.draw.kind, era: set.draw.kind === "era" ? set.draw.era : "any" });
      navigate("/duel/" + duelId, { replace: true, state: set ? { set } : null });
    } catch (e) {
      setError(describeDuelError(e));
      track({ name: "app_error", surface: "duel-join", code: e instanceof DuelApiError ? e.code : "unknown" });
      setBusy(false);
    }
  };

  return (
    <section className="duel" aria-labelledby="join-heading">
      <header className="duel__header">
        <p className="challenge__kicker">Friend duel</p>
        <h1 id="join-heading">You've been challenged</h1>
        <p className="duel__lede">
          A friend has called five real NBA games from 1998 to 2026, with the dates and scores hidden. You get the same
          five. Pick each winner and how sure you are. When you lock in, you both see each other's picks and the
          results, with the pre-game model as a benchmark.
        </p>
      </header>
      <p className="duel__fine">
        You'll have 20 minutes once you start. No account needed. Friend duels are unranked. For fun only: no entry fees,
        prizes, or betting.
      </p>
      {invite && (
        <p className="picker-actions">
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void start()}>
            {busy ? "Dealing games…" : "Start the duel"}
          </button>
        </p>
      )}
      {error && (
        <>
          <p className="duel__error" role="alert">
            {error}
          </p>
          <p>
            <Link to="/duel">Play your own set</Link> instead.
          </p>
        </>
      )}
    </section>
  );
}
