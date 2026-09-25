import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import DuelUnavailable from "../components/duel/DuelUnavailable";
import { track } from "../lib/analytics";
import { DUEL_API, DuelApiError, describeDuelError, redeemSignInLink } from "../lib/duelApi";
import { readGuestToken } from "../lib/duelStorage";

function linkTokenFromFragment(): string | null {
  return new URLSearchParams(window.location.hash.slice(1)).get("token");
}

/** /account/verify#token=… : the landing page for a magic-link email. */
export default function AccountVerifyPage() {
  const navigate = useNavigate();
  const [token] = useState(linkTokenFromFragment);
  const [failure, setFailure] = useState<string | null>(null);
  // A link redeems once; StrictMode's second effect run must not spend it again.
  const started = useRef(false);

  useEffect(() => {
    if (!DUEL_API || !token || started.current) return;
    started.current = true;
    // Keep the token out of the address bar and history once it has been read.
    window.history.replaceState(window.history.state, "", window.location.pathname);
    const mergedGuest = readGuestToken() !== null;
    redeemSignInLink(token)
      .then(() => {
        track({ name: "account_signed_in", mergedGuest });
        navigate("/account", { replace: true, state: { welcome: true, mergedGuest } });
      })
      .catch((e) => {
        setFailure(describeDuelError(e));
        track({ name: "app_error", surface: "account-verify", code: e instanceof DuelApiError ? e.code : "unknown" });
      });
  }, [navigate, token]);

  const error = token ? failure : describeDuelError(new DuelApiError("link_invalid", 400));

  if (!DUEL_API) return <DuelUnavailable />;

  return (
    <section className="duel account" aria-labelledby="verify-heading">
      <h1 id="verify-heading">Signing in</h1>
      {error ? (
        <>
          <p className="duel__error" role="alert">
            {error}
          </p>
          <p>
            <Link to="/account">Request a new link</Link> or <Link to="/duel">keep playing as a guest</Link>.
          </p>
        </>
      ) : (
        <p className="center-note" role="status">
          Checking your link…
        </p>
      )}
    </section>
  );
}
