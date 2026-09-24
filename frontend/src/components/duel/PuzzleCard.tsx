import { CONFIDENCE_LEVELS, type Confidence, type PuzzleView, type Side } from "../../duel";
import {
  CONFIDENCE_LABELS,
  ERA_LABELS,
  formatLastTen,
  formatMissing,
  formatPoints,
  formatRecord,
  formatRest,
  teamLabel,
  tierStakes,
} from "../../lib/duelFormat";
import type { DraftPick } from "../../lib/duelStorage";

type Props = {
  puzzle: PuzzleView;
  index: number;
  total: number;
  pick: DraftPick;
  onPick: (pick: DraftPick) => void;
};

const ROWS: { label: string; hint?: string; value: (t: PuzzleView["home"]) => string }[] = [
  { label: "Record entering", value: (t) => formatRecord(t.winsEntering, t.lossesEntering) },
  { label: "Last 10 games", value: formatLastTen },
  { label: "Rest", value: formatRest },
  {
    label: "Rotation players out",
    hint: "Combined recent Game Score of regular rotation players who sat this game. Higher means more missing.",
    value: (t) => formatMissing(t.missingRotationStrength),
  },
];

export default function PuzzleCard({ puzzle, index, total, pick, onPick }: Props) {
  const sides: { side: Side; label: string }[] = [
    { side: "away", label: "Away" },
    { side: "home", label: "Home" },
  ];
  const headingId = "puzzle-heading-" + puzzle.puzzleId;

  return (
    <section className="puzzle" aria-labelledby={headingId}>
      <header className="puzzle__header">
        <h2 id={headingId} tabIndex={-1}>
          Game {index + 1} of {total}
        </h2>
        <p className="puzzle__meta">
          <span>{ERA_LABELS[puzzle.era]}</span>
          {puzzle.isPlayoffGame && <span className="puzzle__badge">Playoff game</span>}
        </p>
      </header>

      <div className="table-scroll">
        <table className="data-table puzzle__table">
          <caption className="visually-hidden">Pre-game information for both teams</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Stat</span>
              </th>
              {sides.map(({ side, label }) => (
                <th scope="col" key={side}>
                  <span className="puzzle__side-label">{label}</span>
                  <span className="puzzle__team">{teamLabel(puzzle[side])}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label}>
                <th scope="row">
                  {row.label}
                  {row.hint && <span className="puzzle__hint">{row.hint}</span>}
                </th>
                {sides.map(({ side }) => (
                  <td key={side} className="num">
                    {row.value(puzzle[side])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="puzzle__choices" role="group" aria-label="Who won?">
        {sides.map(({ side }) => (
          <button
            key={side}
            type="button"
            className={"btn puzzle__choice" + (pick.side === side ? " puzzle__choice--picked" : "")}
            aria-pressed={pick.side === side}
            onClick={() => onPick({ ...pick, side })}
          >
            {puzzle[side].name} won
          </button>
        ))}
      </div>

      <fieldset className="confidence">
        <legend>How sure are you?</legend>
        {CONFIDENCE_LEVELS.map((c: Confidence) => {
          const [right, wrong] = tierStakes(c);
          return (
            <label key={c} className={"confidence__option" + (pick.confidence === c ? " confidence__option--chosen" : "")}>
              <input
                type="radio"
                name={"confidence-" + puzzle.puzzleId}
                value={c}
                checked={pick.confidence === c}
                onChange={() => onPick({ ...pick, confidence: c })}
              />
              <span className="confidence__name">{CONFIDENCE_LABELS[c]}</span>
              <span className="confidence__stakes">
                {formatPoints(right)} right / {formatPoints(wrong)} wrong
              </span>
            </label>
          );
        })}
      </fieldset>
    </section>
  );
}
