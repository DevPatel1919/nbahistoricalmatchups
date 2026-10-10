import { Link } from "react-router-dom";
import { shortTeamLabel } from "../../daily/share";
import type { Side } from "../../daily/types";
import { SIMULATED_GAME_LABEL, fullTeamName, oddsLine, seasonTeamName } from "../../lib/dailyFormat";
import type { PuzzleGame } from "../../lib/dailyPuzzle";
import { buildMatchupSlug } from "../../lib/slug";

interface Props {
  puzzleGame: PuzzleGame;
  pick: Side;
}

/** One game's final, after lock-in: the score, the player's verdict, the model's odds (Q1), and the points-only box. */
export default function DailyFinal({ puzzleGame, pick }: Props) {
  const { index, game, teams, sim } = puzzleGame;
  const right = pick === sim.winner;
  const winner = teams[sim.winner];
  const headingId = `daily-final-${index + 1}`;
  return (
    <article className={`daily-final ${right ? "daily-final--right" : "daily-final--wrong"}`} aria-labelledby={headingId}>
      <div className="daily-game__header">
        <h3 id={headingId}>
          Game {index + 1}
          {game.featured && <span className="daily-game__badge">⭐ Featured</span>}
        </h3>
        <span className="daily-final__verdict">
          <span aria-hidden="true">{right ? "✅" : "❌"}</span> {right ? "Right" : "Wrong"}
        </span>
      </div>

      <p className="visually-hidden">
        Final: {fullTeamName(teams[0])} {sim.final[0]}, {fullTeamName(teams[1])} {sim.final[1]}. You picked the{" "}
        {seasonTeamName(teams[pick])}, so your pick was {right ? "right" : "wrong"}.
      </p>
      <div className="daily-final__score" aria-hidden="true">
        {([0, 1] as const).map((side) => (
          <div
            key={side}
            className={`daily-final__row daily-final__row--${side === 0 ? "a" : "b"}${sim.winner === side ? " is-winner" : ""}`}
          >
            <span className="daily-final__team">
              {shortTeamLabel(teams[side])}
              {pick === side && <span className="daily-final__picked"> · your pick</span>}
            </span>
            <span className="daily-final__points scoreboard">{sim.final[side]}</span>
          </div>
        ))}
        <span className="daily-final__clock">Final</span>
      </div>

      <p className="daily-final__odds">{oddsLine(game.p, sim.winner, seasonTeamName(winner))}</p>

      <div className="daily-final__box">
        <p className="daily-final__box-label">Simulated points</p>
        {([0, 1] as const).map((side) => (
          <p key={side} className="daily-final__box-line">
            <span className="daily-final__box-team">{shortTeamLabel(teams[side])}:</span>{" "}
            {boxLine(teams[side].starters.map((s, i) => [s.short, sim.box[side].starters[i]]), sim.box[side].bench)}
          </p>
        ))}
      </div>

      <p className="daily-final__label">{SIMULATED_GAME_LABEL}</p>
      <Link className="daily-final__explore" to={`/${buildMatchupSlug(game.a, game.b)}`}>
        Explore {shortTeamLabel(teams[0])} vs {shortTeamLabel(teams[1])} in the matchup explorer
      </Link>
    </article>
  );
}

/** "M. Jordan 31 · S. Pippen 18 · … · Bench 22", each name kept with its points when the line wraps. */
function boxLine(starters: [string, number][], bench: number): string {
  return [...starters, ["Bench", bench] as [string, number]]
    .map(([name, points]) => `${name} ${points}`.replace(/ /g, " "))
    .join(" · ");
}
