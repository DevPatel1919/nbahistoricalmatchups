import type { IndexTeam } from "../types";

interface Props {
  teamA: IndexTeam;
  teamB: IndexTeam;
}

interface Row {
  label: string;
  format: (t: IndexTeam) => string;
  value: (t: IndexTeam) => number;
  lowerIsBetter?: boolean;
}

const ROWS: Row[] = [
  {
    label: "Record",
    format: (t) => `${t.wins}-${t.losses}`,
    value: (t) => t.wins / Math.max(1, t.wins + t.losses),
  },
  {
    label: "Net rating",
    format: (t) => t.netRating.toFixed(2),
    value: (t) => t.netRating,
  },
  {
    label: "Offensive rating",
    format: (t) => t.offRating.toFixed(1),
    value: (t) => t.offRating,
  },
  {
    label: "Defensive rating",
    format: (t) => t.defRating.toFixed(1),
    value: (t) => t.defRating,
    lowerIsBetter: true,
  },
  {
    label: "Pace",
    format: (t) => t.pace.toFixed(1),
    value: (t) => t.pace,
  },
  {
    label: "True shooting %",
    format: (t) => `${(t.trueShooting * 100).toFixed(1)}%`,
    value: (t) => t.trueShooting,
  },
];

export default function StatComparison({ teamA, teamB }: Props) {
  return (
    <div className="stat-comparison">
      <h2>Stat comparison</h2>
      {ROWS.map((row) => {
        const va = row.value(teamA);
        const vb = row.value(teamB);
        const aBetter = row.lowerIsBetter ? va < vb : va > vb;
        const bBetter = row.lowerIsBetter ? vb < va : vb > va;
        return (
          <div className="stat-row" key={row.label}>
            <span className={`stat-row__value stat-row__value--left${aBetter ? " stat-row__value--better" : ""}`}>
              {row.format(teamA)}
            </span>
            <span className="stat-row__label">{row.label}</span>
            <span className={`stat-row__value stat-row__value--right${bBetter ? " stat-row__value--better" : ""}`}>
              {row.format(teamB)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
