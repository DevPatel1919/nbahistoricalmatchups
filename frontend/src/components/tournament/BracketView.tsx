// The tournament bracket (F04), in two modes:
//   predict -- the fan's own bracket, one choice per series;
//   reveal  -- the model's seeded story, revealed round by round, with the
//              fan's pick for each position marked right or wrong.
// Rounds are rendered as ordered lists of labelled groups, which is also the
// accessible list alternative: on narrow screens the columns simply stack.

import { useId } from "react";
import type { BracketResult, SeriesResult } from "../../tournament";
import { roundName, teamLabel, type Picks, type Slot } from "../../lib/bracket";
import type { EntrantInfo } from "../../lib/tournamentLoader";

type Mode =
  | { kind: "predict"; slots: Slot[][]; onPick: (round: number, index: number, key: string) => void }
  | { kind: "reveal"; model: BracketResult; revealed: number };

interface Props {
  entrants: Map<string, EntrantInfo>;
  picks: Picks;
  mode: Mode;
}

export default function BracketView({ entrants, picks, mode }: Props) {
  const baseId = useId();
  const rounds = picks.length;

  return (
    <div className="bracket" data-rounds={rounds}>
      {picks.map((roundPicks, r) => {
        const headingId = `${baseId}-round-${r}`;
        return (
          <section key={r} className="bracket__round" aria-labelledby={headingId}>
            <h3 id={headingId} className="bracket__round-name">
              {roundName(r, rounds)}
            </h3>
            <ol className="bracket__series-list">
              {roundPicks.map((pick, i) => (
                <li key={i} className="bracket__series-item">
                  {mode.kind === "predict" ? (
                    <PredictSeries
                      slot={mode.slots[r][i]}
                      pick={pick}
                      entrants={entrants}
                      label={`${roundName(r, rounds)}, series ${i + 1}`}
                      onPick={(key) => mode.onPick(r, i, key)}
                    />
                  ) : (
                    <RevealSeries
                      series={seriesIfKnown(mode.model, r, mode.revealed, i)}
                      shown={r < mode.revealed}
                      pick={pick}
                      entrants={entrants}
                    />
                  )}
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

/** A round's matchups are known once the previous round is revealed. */
function seriesIfKnown(model: BracketResult, round: number, revealed: number, index: number): SeriesResult | null {
  return round <= revealed ? model.rounds[round][index] : null;
}

function Seed({ info }: { info: EntrantInfo }) {
  return (
    <span className="bracket__seed tabular" aria-label={`seed ${info.seed}`}>
      {info.seed}
    </span>
  );
}

interface PredictProps {
  slot: Slot;
  pick: string | null;
  entrants: Map<string, EntrantInfo>;
  label: string;
  onPick: (key: string) => void;
}

function PredictSeries({ slot, pick, entrants, label, onPick }: PredictProps) {
  const sides = [slot.top, slot.bottom];
  return (
    <div className="bracket__series" role="group" aria-label={label}>
      {sides.map((key, side) => {
        const info = key ? entrants.get(key) : undefined;
        if (!key || !info) {
          return (
            <div key={side} className="bracket__team bracket__team--empty">
              Waiting on an earlier pick
            </div>
          );
        }
        const chosen = pick === key;
        return (
          <button
            key={side}
            type="button"
            className={`bracket__team bracket__team--choice${chosen ? " bracket__team--picked" : ""}`}
            aria-pressed={chosen}
            onClick={() => onPick(key)}
          >
            <Seed info={info} />
            <span className="bracket__name">{teamLabel(info.team)}</span>
            {chosen && <span className="bracket__mark">Your pick</span>}
          </button>
        );
      })}
    </div>
  );
}

interface RevealProps {
  series: SeriesResult | null;
  shown: boolean;
  pick: string | null;
  entrants: Map<string, EntrantInfo>;
}

function RevealSeries({ series, shown, pick, entrants }: RevealProps) {
  const pickInfo = pick ? entrants.get(pick) : undefined;
  const correct = shown && series !== null && pick === series.winner;

  return (
    <div className={`bracket__series${shown ? " bracket__series--shown" : ""}`}>
      {series ? (
        [series.top, series.bottom].map((key) => {
          const info = entrants.get(key)!;
          const won = shown && series.winner === key;
          const wins = key === series.top ? series.topWins : series.bottomWins;
          return (
            <div
              key={key}
              className={`bracket__team${won ? " bracket__team--won" : ""}${shown && !won ? " bracket__team--lost" : ""}`}
            >
              <Seed info={info} />
              <span className="bracket__name">{teamLabel(info.team)}</span>
              {shown && <span className="bracket__wins scoreboard">{wins}</span>}
            </div>
          );
        })
      ) : (
        <div className="bracket__team bracket__team--empty">To be decided</div>
      )}
      <p className="bracket__pick-line">
        {pickInfo ? (
          <>
            Your pick: {teamLabel(pickInfo.team)}
            {shown && (
              <span className={correct ? "bracket__verdict--right" : "bracket__verdict--wrong"}>
                {correct ? " ✓ correct" : " ✗ missed"}
              </span>
            )}
          </>
        ) : (
          "No pick"
        )}
        {series && !shown && <span className="bracket__hidden"> &middot; result hidden</span>}
      </p>
    </div>
  );
}
