import { useState } from "react";
import { useNavigate } from "react-router-dom";
import DuelUnavailable from "../components/duel/DuelUnavailable";
import { BOT_DISCLOSURE, BOT_DISPLAY_NAME, CONFIDENCE_LEVELS, ERA_KEYS, type EraKey, type PlayMode } from "../duel";
import { track } from "../lib/analytics";
import { DUEL_API, DuelApiError, describeDuelError } from "../lib/duelApi";
import { beginDuel } from "../lib/duelStart";
import { CONFIDENCE_LABELS, ERA_LABELS, formatPoints, tierStakes } from "../lib/duelFormat";

export default function DuelHomePage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<PlayMode>("bot");
  const [era, setEra] = useState<EraKey | "any">("any");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!DUEL_API) return <DuelUnavailable />;

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
        </fieldset>

        <label className="duel__era">
          <span>Era</span>
          <select value={era} onChange={(e) => setEra(e.target.value as EraKey | "any")}>
            <option value="any">Any era</option>
            {ERA_KEYS.map((k) => (
              <option key={k} value={k}>
                {ERA_LABELS[k]}
              </option>
            ))}
          </select>
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
    </section>
  );
}
