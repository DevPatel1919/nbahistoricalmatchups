import { useEffect, useRef, useState } from "react";
import { shortTeamLabel } from "../../daily/share";
import type { Side } from "../../daily/types";
import {
  REVEAL_START,
  SIMULATED_GAME_LABEL,
  advanceReveal,
  atFinal,
  clockText,
  fullTeamName,
  gameSecondsAt,
  oddsLine,
  playText,
  playsBy,
  scoreAfter,
  seasonTeamName,
  skipGame,
} from "../../lib/dailyFormat";
import type { PuzzleGame } from "../../lib/dailyPuzzle";

const TICK_MS = 100;
const TICKER_LINES = 4;

interface Props {
  games: PuzzleGame[];
  picks: Side[];
  /** Called once every game has played, or on Skip all. */
  onDone: () => void;
}

/**
 * Plays the day's games one after another, about 20 seconds each: a
 * scoreboard, the quarter clock, and the last few scoring plays. The ticking
 * board is hidden from screen readers; a polite live region announces each
 * game's start and final instead.
 */
export default function DailyReveal({ games, picks, onDone }: Props) {
  const [clock, setClock] = useState(REVEAL_START);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (clock.done) return;
    let last = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      const delta = now - last;
      last = now;
      setClock((c) => advanceReveal(c, delta, games.length));
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [clock.done, games.length]);

  useEffect(() => {
    if (clock.done) doneRef.current();
  }, [clock.done]);

  const current = games[clock.index];
  const { teams, sim, game } = current;
  const final = atFinal(clock);
  const t = final ? Infinity : gameSecondsAt(clock.elapsed);
  const shown = final ? sim.plays.length : playsBy(sim, t);
  const score = final ? sim.final : scoreAfter(sim, shown);
  const recent = sim.plays.slice(Math.max(0, shown - TICKER_LINES), shown).reverse();
  const pick = picks[clock.index];
  const right = pick === sim.winner;
  const isLast = clock.index === games.length - 1;

  const announcement = final
    ? `Game ${clock.index + 1} final: ${fullTeamName(teams[0])} ${sim.final[0]}, ${fullTeamName(teams[1])} ${sim.final[1]}. Your pick was ${right ? "right" : "wrong"}.`
    : `Game ${clock.index + 1} under way: ${fullTeamName(teams[0])} against ${fullTeamName(teams[1])}.`;

  return (
    <section className="daily-reveal" aria-labelledby="daily-reveal-heading">
      <div className="daily-game__header">
        <h2 id="daily-reveal-heading" ref={headingRef} tabIndex={-1}>
          Game {clock.index + 1} of {games.length}
          {game.featured && <span className="daily-game__badge">⭐ Featured</span>}
        </h2>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>

      <div className="daily-board" aria-hidden="true">
        {([0, 1] as const).map((side) => (
          <div
            key={side}
            className={`daily-board__row daily-board__row--${side === 0 ? "a" : "b"}${final && sim.winner === side ? " is-winner" : ""}`}
          >
            <span className="daily-board__team">
              {shortTeamLabel(teams[side])}
              {pick === side && <span className="daily-board__picked"> · your pick</span>}
            </span>
            <span className="daily-board__points scoreboard">{score[side]}</span>
          </div>
        ))}
        <div className="daily-board__clock scoreboard">{final ? "Final" : clockText(t)}</div>
      </div>

      <ol className="daily-ticker" aria-hidden="true">
        {recent.map((play) => (
          <li key={`${play.t}-${play.side}-${play.score[0]}-${play.score[1]}`} className={`daily-ticker__play daily-ticker__play--${play.side === 0 ? "a" : "b"}`}>
            <span className="daily-ticker__clock tabular">{clockText(play.t)}</span>{" "}
            <span className="daily-ticker__team">{teams[play.side].name}</span> {playText(play, teams[play.side].starters)}
          </li>
        ))}
      </ol>

      {final && (
        <div className="daily-reveal__final">
          <p className={`daily-reveal__verdict ${right ? "is-right" : "is-wrong"}`}>
            <span aria-hidden="true">{right ? "✅" : "❌"}</span> Your pick was {right ? "right" : "wrong"}.
          </p>
          <p className="daily-final__odds">{oddsLine(game.p, sim.winner, seasonTeamName(teams[sim.winner]))}</p>
        </div>
      )}

      <p className="daily-final__label">{SIMULATED_GAME_LABEL}</p>

      <div className="picker-actions daily-reveal__actions">
        <button type="button" className="btn" onClick={() => setClock((c) => skipGame(c, games.length))}>
          {final ? (isLast ? "See results" : "Next game") : "Skip"}
        </button>
        <button type="button" className="btn" onClick={() => onDone()}>
          Skip all
        </button>
      </div>
    </section>
  );
}
