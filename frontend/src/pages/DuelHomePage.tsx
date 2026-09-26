import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import DuelUnavailable from "../components/duel/DuelUnavailable";
import { BOT_DISCLOSURE, BOT_DISPLAY_NAME, CONFIDENCE_LEVELS, ERA_KEYS, type AccountView, type EraKey, type PlayMode } from "../duel";
import { track } from "../lib/analytics";
import { DUEL_API, DuelApiError, describeDuelError, fetchAccount, isSignedIn } from "../lib/duelApi";
import { beginDuel } from "../lib/duelStart";
import { CONFIDENCE_LABELS, ERA_LABELS, formatPoints, tierStakes } from "../lib/duelFormat";

export default function DuelHomePage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<PlayMode>("bot");
  const [era, setEra] = useState<EraKey | "any">("any");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountView | null>(null);

  useEffect(() => {
    if (!DUEL_API || !isSignedIn()) return;
    let live = true;
    fetchAccount()
      .then((a) => {
        if (live) setAccount(a);
      })
      .catch(() => {
        // Ranked stays unavailable until the account loads; every other mode still works.
      });
    return () => {
      live = false;
    };
  }, []);

  if (!DUEL_API) return <DuelUnavailable />;

  const rankedReady = account?.ranked.eligible === true;
  const rankedNote = !account
    ? "Needs an account."
    : rankedReady
      ? "Matched with a player near your rating. Moves your rating" +
        (account.rating ? " (" + account.rating.rating.toLocaleString("en-US") + (account.rating.provisional ? ", provisional" : "") + ")." : ".")
      : "Unlocks after " + account.ranked.minCompletedDuels + " completed sets and a display name (" +
        Math.min(account.completedDuels, account.ranked.minCompletedDuels) + " of " + account.ranked.minCompletedDuels + " sets).";

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await beginDuel(mode, era === "any" ? { kind: "random" } : { kind: "era", era }, navigate);
    } catch (e) {
      setError(describeDuelError(e));
      track({ name: "app_error", surface: "duel-start", code: e instanceof DuelApiError ? e.code : "unknown" });
      setBusy(false);
    }
  };

  return (
    <section className="duel" aria-labelledby="duel-heading">
      <header className="duel__header">
        <p className="challenge__kicker">Duel mode</p>
        <h1 id="duel-heading">Call five real games</h1>
        <p className="duel__lede">
          Each game is a real NBA game from 1998 to 2026 with the date and score hidden. You see only what was known
          before tip-off: records, recent form, rest, and who sat out. Pick the winner and how sure you are.
        </p>
      </header>

      <div className="duel__scoring">
        <h2>Scoring</h2>
        <p>Being honest about how sure you are scores best over time. Overconfidence costs more than it wins.</p>
        <table className="data-table">
          <caption className="visually-hidden">Points by confidence</caption>
          <thead>
            <tr>
              <th scope="col">Confidence</th>
              <th scope="col" className="num">
                Right
              </th>
              <th scope="col" className="num">
                Wrong
              </th>
            </tr>
          </thead>
          <tbody>
            {CONFIDENCE_LEVELS.map((c) => {
              const [right, wrong] = tierStakes(c);
              return (
                <tr key={c}>
                  <th scope="row">{CONFIDENCE_LABELS[c]}</th>
                  <td className="num">{formatPoints(right)}</td>
                  <td className="num">{formatPoints(wrong)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form
        className="duel__setup"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <fieldset>
          <legend>Opponent</legend>
          <label className="duel__option">
            <input type="radio" name="mode" value="bot" checked={mode === "bot"} onChange={() => setMode("bot")} />
            <span>
              <strong>{BOT_DISPLAY_NAME}</strong>
              <span className="duel__option-note">{BOT_DISCLOSURE}</span>
            </span>
          </label>
          <label className="duel__option">
            <input type="radio" name="mode" value="solo" checked={mode === "solo"} onChange={() => setMode("solo")} />
            <span>
              <strong>Solo</strong>
              <span className="duel__option-note">Just you, with the pre-game model as a benchmark.</span>
            </span>
          </label>
          <label className="duel__option">
            <input type="radio" name="mode" value="friend" checked={mode === "friend"} onChange={() => setMode("friend")} />
            <span>
              <strong>A friend</strong>
              <span className="duel__option-note">Play first, then send a link. Your friend gets the same five games. Unranked.</span>
            </span>
          </label>
          <label className={"duel__option" + (rankedReady ? "" : " is-disabled")}>
            <input
              type="radio"
              name="mode"
              value="ranked"
              checked={mode === "ranked"}
              disabled={!rankedReady}
              onChange={() => setMode("ranked")}
            />
            <span>
              <strong>Ranked</strong>
              <span className="duel__option-note">{rankedNote}</span>
            </span>
          </label>
        </fieldset>

        <label className="duel__era">
          <span>Era</span>
          <select value={mode === "ranked" ? "any" : era} disabled={mode === "ranked"} onChange={(e) => setEra(e.target.value as EraKey | "any")}>
            <option value="any">Any era</option>
            {ERA_KEYS.map((k) => (
              <option key={k} value={k}>
                {ERA_LABELS[k]}
              </option>
            ))}
          </select>
          {mode === "ranked" && <span className="duel__option-note">Ranked games are drawn from every era.</span>}
        </label>

        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? "Dealing games…" : "Start a set"}
        </button>
        {error && (
          <p className="duel__error" role="alert">
            {error}
          </p>
        )}
      </form>

      <p className="duel__fine">
        Every set shows the pre-game model's calls after you lock in, as a fixed benchmark. Guests play without an
        account. For fun only: no entry fees, prizes, or betting.
      </p>

      <p className="duel__board">
        <Link to="/duel/leaderboard">Leaderboard</Link>: today's and the last 30 days' top ranked players.
      </p>

      <p className="duel__account">
        {isSignedIn() ? (
          <>
            {rankedReady ? "You're signed in and ranked is open to you." : "You're signed in, so your sets count toward ranked eligibility."}{" "}
            <Link to="/account">Your account</Link>
          </>
        ) : (
          <>
            Playing as a guest. <Link to="/account">Sign in</Link> (optional) to keep your history across devices and
            qualify for ranked play.
          </>
        )}
      </p>
    </section>
  );
}
