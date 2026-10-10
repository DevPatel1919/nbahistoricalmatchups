import type { Side } from "../../daily/types";
import { formatRecord, fullTeamName, seasonLabel, starterStatLine } from "../../lib/dailyFormat";
import type { CardTeam, PuzzleGame } from "../../lib/dailyPuzzle";

interface Props {
  puzzleGame: PuzzleGame;
  pick: Side | null;
  onPick: (side: Side) => void;
}

/**
 * One matchup before lock-in: two team cards, each a radio. Nothing the model
 * says (p, m, the simulated result) is read here.
 */
export default function DailyPickCard({ puzzleGame, pick, onPick }: Props) {
  const { index, game, teams } = puzzleGame;
  const headingId = `daily-game-${index + 1}`;
  return (
    <section className="daily-game" aria-labelledby={headingId}>
      <div className="daily-game__header">
        <h2 id={headingId}>Game {index + 1}</h2>
        {game.featured && <span className="daily-game__badge">⭐ Featured</span>}
      </div>
      <fieldset className="daily-game__teams">
        <legend className="visually-hidden">Pick the winner of game {index + 1}</legend>
        {([0, 1] as const).map((side) => (
          <TeamOption
            key={side}
            team={teams[side]}
            side={side}
            name={headingId}
            picked={pick === side}
            onPick={() => onPick(side)}
          />
        ))}
      </fieldset>
    </section>
  );
}

function TeamOption({
  team,
  side,
  name,
  picked,
  onPick,
}: {
  team: CardTeam;
  side: Side;
  name: string;
  picked: boolean;
  onPick: () => void;
}) {
  // The whole card is the radio's label, so it is one big tap target; the
  // radio's accessible name stays short.
  return (
    <label className={`daily-team daily-team--${side === 0 ? "a" : "b"}${picked ? " is-picked" : ""}`}>
      <input
        type="radio"
        className="daily-team__radio"
        name={name}
        value={team.key}
        checked={picked}
        onChange={onPick}
        aria-label={`Pick the ${fullTeamName(team)}`}
      />
      <span className="daily-team__season">{seasonLabel(team.season)}</span>
      <span className="daily-team__name">
        {team.city} {team.name}
      </span>
      <span className="daily-team__record scoreboard">{formatRecord(team.wins, team.losses)}</span>
      <span className="daily-team__five-label">Starting five</span>
      <span className="daily-team__five">
        {team.starters.map((s) => (
          <span key={s.name} className="daily-starter">
            <span className="daily-starter__name">
              <span className="daily-starter__full">{s.name}</span>
              <span className="daily-starter__short" aria-hidden="true">
                {s.short}
              </span>
            </span>
            <span className="daily-starter__stats tabular">{starterStatLine(s)}</span>
          </span>
        ))}
      </span>
      <span className="daily-team__pick" aria-hidden="true">
        {picked ? "✓ Your pick" : "Pick"}
      </span>
    </label>
  );
}
