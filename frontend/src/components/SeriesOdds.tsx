import type { IndexTeam } from "../types";
import { seriesWinProbability } from "../lib/series";

interface Props {
  teamA: IndexTeam;
  teamB: IndexTeam;
  p: number; // team A's single-game neutral win probability
}

export default function SeriesOdds({ teamA, teamB, p }: Props) {
  const winnerIsA = p >= 0.5;
  const winner = winnerIsA ? teamA : teamB;
  const gameProb = winnerIsA ? p : 1 - p;
  const seriesProb = seriesWinProbability(gameProb);

  return (
    <div className="series-odds">
      <div className="series-odds__headline">
        In a best-of-7: {winner.city} {winner.name} win the series{" "}
        <strong className="tabular">{Math.round(seriesProb * 100)}%</strong> of the time.
      </div>
      <div className="series-odds__label">Neutral court, each game independent</div>
    </div>
  );
}
