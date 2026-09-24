import type { CSSProperties } from "react";
import type { IndexTeam } from "../types";
import { getTeamColors, TEAM_COLORS_APPROVED } from "../data/team-colors";
import { formatMargin } from "../lib/margin";
import CountUpPercent from "./CountUpPercent";

interface Props {
  teamA: IndexTeam;
  teamB: IndexTeam;
  /** Team A's neutral win probability and projected margin (positive = A wins by that much). */
  p: number;
  m: number;
}

function accentStyle(team: IndexTeam, side: "a" | "b"): CSSProperties {
  if (TEAM_COLORS_APPROVED) {
    const colors = getTeamColors(team.name);
    return { "--accent-color": colors.primary, "--accent-glow": `${colors.primary}55` } as CSSProperties;
  }
  // Independent palette: the accent marks the side, not the franchise.
  return {
    "--accent-color": `var(--side-${side})`,
    "--accent-glow": `color-mix(in srgb, var(--side-${side}) 33%, transparent)`,
  } as CSSProperties;
}

function TeamSide({ team, side, isWinner }: { team: IndexTeam; side: "a" | "b"; isWinner: boolean }) {
  const style = accentStyle(team, side);

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

  return (
    <div className="winner-card">
      <div className="winner-card__sides">
        <TeamSide team={teamA} side="a" isWinner={winnerIsA} />
        <span className="winner-card__vs">vs</span>
        <TeamSide team={teamB} side="b" isWinner={!winnerIsA} />
      </div>

      <div className="winner-card__result">
        <div className="winner-card__prob">
          <CountUpPercent value={winProb} />
        </div>
        <div className="winner-card__prob-label">
          {winner.city} {winner.name} to beat the {loser.city} {loser.name}
        </div>
        <div className="winner-card__margin">wins {formatMargin(m)}</div>
      </div>
    </div>
  );
}
