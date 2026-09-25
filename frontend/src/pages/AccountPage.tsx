import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import TurnstileWidget from "../components/account/TurnstileWidget";
import DuelUnavailable from "../components/duel/DuelUnavailable";
import type { AccountView } from "../duel";
import { track } from "../lib/analytics";
import {
  DUEL_API,
  DuelApiError,
  TURNSTILE_SITE_KEY,
  describeDuelError,
  fetchAccount,
  requestSignInLink,
  signOut,
  updateDisplayName,
} from "../lib/duelApi";

type State = { kind: "loading" } | { kind: "signed-out" } | { kind: "signed-in"; account: AccountView } | { kind: "error"; message: string };

function errorCode(e: unknown): string {
  return e instanceof DuelApiError ? e.code : "unknown";
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function SignInForm() {
  const [email, setEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [widgetKey, setWidgetKey] = useState(0);
  const [widgetFailed, setWidgetFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!TURNSTILE_SITE_KEY) {
    return (
      <p className="center-note" role="status">
        Sign-in isn't set up on this version of the site. You can still play every mode as a guest.
      </p>
    );
  }

  if (sentTo) {
    return (
      <div className="account__sent" role="status">
        <h2>Check your email</h2>
        <p>
          If <strong>{sentTo}</strong> can receive mail, a sign-in link is on its way. It works once and expires in
          15 minutes. Open it in this browser to bring your guest history with you.
        </p>
        <button type="button" className="btn" onClick={() => setSentTo(null)}>
          Use a different address
        </button>
      </div>
    );
  }

  const submit = async () => {
    if (!turnstileToken) return;
    setBusy(true);
    setError(null);
    try {
      await requestSignInLink(email.trim(), turnstileToken);
      setSentTo(email.trim());
    } catch (e) {
      setError(describeDuelError(e));
      track({ name: "app_error", surface: "account-link", code: errorCode(e) });
    } finally {
      // A Turnstile token is single-use: every attempt needs a fresh widget.
      setTurnstileToken(null);
      setWidgetKey((k) => k + 1);
      setBusy(false);
    }
  };

  return (
    <form
      className="account__form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="account__field">
        <span>Email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <TurnstileWidget
        key={widgetKey}
        siteKey={TURNSTILE_SITE_KEY}
        onToken={setTurnstileToken}
        onLoadError={() => setWidgetFailed(true)}
      />
      {widgetFailed && (
        <p className="duel__error" role="alert">
          The verification check couldn't load. Check your connection or content blocker, then reload.
        </p>
      )}
      <button type="submit" className="btn btn--primary" disabled={busy || !turnstileToken || !email.trim()}>
        {busy ? "Sending…" : "Email me a sign-in link"}
      </button>
      {error && (
        <p className="duel__error" role="alert">
          {error}
        </p>
      )}
      <p className="duel__fine">
        No password. We store a one-way hash of your address to recognise you, never the address itself, and send
        nothing but sign-in links.
      </p>
    </form>
  );
}

function NameForm({ account, onSaved }: { account: AccountView; onSaved: (a: AccountView) => void }) {
  const [name, setName] = useState(account.displayName ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const locked = account.nextRenameAt !== null;

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const updated = await updateDisplayName(name);
      onSaved(updated);
      setName(updated.displayName ?? "");
      setMessage({ kind: "ok", text: "Saved." });
    } catch (e) {
      setMessage({ kind: "error", text: describeDuelError(e) });
      track({ name: "app_error", surface: "account-name", code: errorCode(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="account__form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="account__field">
        <span>Display name</span>
        <input
          type="text"
          name="displayName"
          autoComplete="nickname"
          required
          minLength={3}
          maxLength={20}
          value={name}
          disabled={locked}
          onChange={(e) => setName(e.target.value)}
          aria-describedby="name-rules"
        />
      </label>
      <p id="name-rules" className="duel__fine">
        {locked
          ? "You can change it again on " + formatDate(account.nextRenameAt as number) + "."
          : account.displayName
            ? "One change now, then one every 30 days."
            : "3 to 20 letters or digits. This is the name other players will see."}
      </p>
      {!locked && (
        <button type="submit" className="btn btn--primary" disabled={busy || name.trim() === (account.displayName ?? "")}>
          {busy ? "Saving…" : account.displayName ? "Change name" : "Save name"}
        </button>
      )}
      {message && (
        <p className={message.kind === "error" ? "duel__error" : "account__ok"} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </form>
  );
}

function RankedStatus({ account }: { account: AccountView }) {
  const { ranked, completedDuels } = account;
  const done = Math.min(completedDuels, ranked.minCompletedDuels);
  return (
    <div className="account__ranked">
      <h2>Ranked play</h2>
      {ranked.eligible ? (
        <>
          <p>
            You're eligible. <Link to="/duel">Choose Ranked on the duel page</Link> to be matched with a player near your
            rating.
          </p>
          {account.rating ? (
            <p data-testid="account-rating">
              Rating: <strong className="scoreboard">{account.rating.rating.toLocaleString("en-US")}</strong> after{" "}
              {account.rating.ratedDuels} rated {account.rating.ratedDuels === 1 ? "duel" : "duels"}
              {account.rating.provisional ? " (provisional for your first 10)." : "."}
            </p>
          ) : (
            <p>Your rating starts at 1,200 with your first rated duel.</p>
          )}
        </>
      ) : (
        <ul className="account__checklist">
          <li className={completedDuels >= ranked.minCompletedDuels ? "is-done" : undefined}>
            Complete {ranked.minCompletedDuels} sets: {done} of {ranked.minCompletedDuels}
            <progress max={ranked.minCompletedDuels} value={done} aria-label="Completed sets" />
          </li>
          <li className={ranked.needsDisplayName ? undefined : "is-done"}>
            {ranked.needsDisplayName ? "Choose a display name" : "Display name chosen"}
          </li>
        </ul>
      )}
    </div>
  );
}

export default function AccountPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // Router state survives reloads: read the sign-in welcome once, then clear it.
  const [arrival] = useState(() => location.state as { welcome?: boolean; mergedGuest?: boolean } | null);
  const welcome = arrival?.welcome === true;
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (location.state) navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (!DUEL_API) return;
    let cancelled = false;
    fetchAccount()
      .then((account) => {
        if (!cancelled) setState(account ? { kind: "signed-in", account } : { kind: "signed-out" });
      })
      .catch((e) => {
        if (cancelled) return;
        setState({ kind: "error", message: describeDuelError(e) });
        track({ name: "app_error", surface: "account-load", code: errorCode(e) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!DUEL_API) return <DuelUnavailable />;

  return (
    <section className="duel account" aria-labelledby="account-heading">
      <header className="duel__header">
        <p className="challenge__kicker">Duel mode</p>
        <h1 id="account-heading">{state.kind === "signed-in" ? "Your account" : "Sign in"}</h1>
        {state.kind !== "signed-in" && (
          <p className="duel__lede">
            An account is optional. Guests play every practice mode. Ranked play needs an account
            so ratings can't be farmed with throwaway identities.
          </p>
        )}
      </header>

      {state.kind === "loading" && (
        <p className="center-note" role="status">
          Loading…
        </p>
      )}
      {state.kind === "error" && (
        <p className="duel__error" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === "signed-out" && <SignInForm />}
      {state.kind === "signed-in" && (
        <>
          {welcome && (
            <p className="account__ok" role="status">
              You're signed in.
              {arrival?.mergedGuest && state.account.completedDuels > 0
                ? " Sets you played as a guest in this browser now count for this account."
                : ""}
            </p>
          )}
          <NameForm account={state.account} onSaved={(account) => setState({ kind: "signed-in", account })} />
          <RankedStatus account={state.account} />
          <div className="account__actions">
            <Link to="/duel" className="btn btn--primary">
              Play a set
            </Link>
            <button
              type="button"
              className="btn"
              onClick={() => {
                void signOut().then(() => setState({ kind: "signed-out" }));
              }}
            >
              Sign out
            </button>
          </div>
        </>
      )}
      <p className="duel__fine">
        <Link to="/duel">Back to duel mode</Link>
      </p>
    </section>
  );
}
