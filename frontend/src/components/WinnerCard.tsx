import type { CSSProperties } from "react";
import type { IndexTeam } from "../types";
import { getTeamColors } from "../data/team-colors";
import CountUpPercent from "./CountUpPercent";

interface Props {
  teamA: IndexTeam;
  teamB: IndexTeam;
  /** Team A's neutral win probability and projected margin (positive = A wins by that much). */
  p: number;
  m: number;
}

function TeamSide({ team, isWinner }: { team: IndexTeam; isWinner: boolean }) {
  const colors = getTeamColors(team.name);
  const style = {
    "--accent-color": colors.primary,
    "--accent-glow": `${colors.primary}55`,
  } as CSSProperties;

  return (
    <div className={`team-side${isWinner ? " team-side--winner" : ""}`} style={style}>
      <div className="team-side__bar" />
      <div className="team-side__season tabular">{team.season}</div>
      <div className="team-side__name">
        {team.city} {team.name}
      </div>
      <div className="team-side__record tabular">
        {team.wins}-{team.losses}
      </div>
      {!team.madePlayoffs && <div className="team-side__badge">Missed the playoffs</div>}
    </div>
  );
}

export default function WinnerCard({ teamA, teamB, p, m }: Props) {
  const winnerIsA = p >= 0.5;
  const winner = winnerIsA ? teamA : teamB;
  const loser = winnerIsA ? teamB : teamA;
  const winProb = winnerIsA ? p : 1 - p;
  const winMargin = Math.abs(winnerIsA ? m : -m);

  return (
    <div className="winner-card">
      <div className="winner-card__sides">
        <TeamSide team={teamA} isWinner={winnerIsA} />
        <span className="winner-card__vs">vs</span>
        <TeamSide team={teamB} isWinner={!winnerIsA} />
      </div>

      <div className="winner-card__result">
        <div className="winner-card__prob">
          <CountUpPercent value={winProb} />
        </div>
        <div className="winner-card__prob-label">
          {winner.city} {winner.name} to beat the {loser.city} {loser.name}
        </div>
        <div className="winner-card__margin">wins by {winMargin.toFixed(1)}</div>
      </div>
    </div>
  );
}
