import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import DuelUnavailable from "../components/duel/DuelUnavailable";
import type { AccountView, LeaderboardKind, LeaderboardView } from "../duel";
import { track } from "../lib/analytics";
import { DUEL_API, DuelApiError, describeDuelError, fetchAccount, fetchLeaderboard, isSignedIn } from "../lib/duelApi";
import { boardDescription, boardEmpty, formatPoints, formatWinLoss } from "../lib/duelFormat";

/** The last answer, for whichever board it belongs to; a different board than the one shown means loading. */
type Result = { board: LeaderboardKind } & ({ kind: "loaded"; view: LeaderboardView } | { kind: "error"; message: string });

const BOARDS: { key: LeaderboardKind; label: string }[] = [
  { key: "daily", label: "Today" },
  { key: "30d", label: "Last 30 days" },
];

export default function DuelLeaderboardPage() {
  const [params, setParams] = useSearchParams();
  const board: LeaderboardKind = params.get("board") === "30d" ? "30d" : "daily";
  const [result, setResult] = useState<Result | null>(null);
  const [account, setAccount] = useState<AccountView | null>(null);

  useEffect(() => {
    if (!DUEL_API) return;
    let live = true;
    fetchLeaderboard(board)
      .then((view) => {
        if (live) setResult({ board, kind: "loaded", view });
      })
      .catch((e) => {
        if (!live) return;
        setResult({ board, kind: "error", message: describeDuelError(e) });
        track({ name: "app_error", surface: "duel-leaderboard", code: e instanceof DuelApiError ? e.code : "unknown" });
      });
    return () => {
      live = false;
    };
  }, [board]);

  useEffect(() => {
    if (!DUEL_API || !isSignedIn()) return;
    let live = true;
    fetchAccount()
      .then((a) => {
        if (live) setAccount(a);
      })
      .catch(() => {
        // The board reads the same without the account; only "(you)" is missing.
      });
    return () => {
      live = false;
    };
  }, []);

  if (!DUEL_API) return <DuelUnavailable />;

  const you = account?.displayName ?? null;
  const state = result?.board === board ? result : { kind: "loading" as const };

  return (
    <section className="duel board" aria-labelledby="board-heading">
      <header className="duel__header">
        <p className="challenge__kicker">Duel mode</p>
        <h1 id="board-heading">Leaderboard</h1>
        <p className="duel__lede">Ranked duels between two players. Practice sets and the Sparring Partner never count here.</p>
      </header>

      <div className="board__tabs" role="group" aria-label="Board">
        {BOARDS.map((b) => (
          <button
            key={b.key}
            type="button"
            className="btn btn--small"
            aria-pressed={board === b.key}
            onClick={() => setParams(b.key === "daily" ? {} : { board: b.key }, { replace: true })}
          >
            {b.label}
          </button>
        ))}
      </div>

      {account?.hiddenFromBoard && (
        <p className="board__notice" role="status" data-testid="board-hidden">
          Your account isn't shown on the leaderboard right now because of an integrity review. You can keep playing
          ranked, and your rating still counts.
        </p>
      )}

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
      {state.kind === "loaded" && (
        <>
          <p className="duel__fine">{boardDescription(state.view.board, state.view.minDuels)}</p>
          {state.view.entries.length === 0 ? (
            <p className="center-note" data-testid="board-empty">
              {boardEmpty(state.view.board, state.view.minDuels)}
            </p>
          ) : (
            <table className="data-table board__table">
              <caption className="visually-hidden">{board === "daily" ? "Today's leaderboard" : "Leaderboard for the last 30 days"}</caption>
              <thead>
                <tr>
                  <th scope="col" className="num">
                    #
                  </th>
                  <th scope="col">Player</th>
                  <th scope="col" className="num">
                    Rating
                  </th>
                  <th scope="col" className="num">
                    <abbr title="Wins–losses, then draws if any">W–L</abbr>
                  </th>
                  <th scope="col" className="num">
                    {board === "daily" ? "Today" : "30 days"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.view.entries.map((e) => {
                  const mine = you !== null && e.name === you;
                  return (
                    <tr key={e.rank} className={mine ? "is-you" : undefined} aria-current={mine ? "true" : undefined}>
                      <td className="num">{e.rank}</td>
                      <th scope="row" className="board__name">
                        {e.name}
                        {mine && <span className="board__you"> (you)</span>}
                      </th>
                      <td className="num scoreboard">
                        {e.rating.toLocaleString("en-US")}
                        {e.provisional && (
                          <abbr className="board__prov" title="Provisional: fewer than 10 rated duels">
                            P
                          </abbr>
                        )}
                      </td>
                      <td className="num">{formatWinLoss(e.wins, e.losses, e.draws)}</td>
                      <td className={"num" + (e.change > 0 ? " board__up" : e.change < 0 ? " board__down" : "")}>{formatPoints(e.change)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}

      <p className="duel__fine">
        Accounts under an integrity review are left off until the review is finished. Reviews never change a rating or
        stop anyone playing. A <abbr title="Provisional">P</abbr> marks a provisional rating (fewer than 10 rated
        duels). For fun only: no entry fees, prizes, or betting.
      </p>
      <p className="duel__account">
        <Link to="/duel">Play a set</Link>
        {isSignedIn() ? (
          <>
            {" "}
            · <Link to="/account">Your account</Link>
          </>
        ) : (
          <>
            {" "}
            · <Link to="/account">Sign in</Link> to play ranked
          </>
        )}
      </p>
    </section>
  );
}
