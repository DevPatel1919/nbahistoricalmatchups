import type { TitleOddsResult } from "../../tournament";
import { roundName, teamLabel } from "../../lib/bracket";
import type { EntrantInfo } from "./BracketView";

interface Props {
  odds: TitleOddsResult;
  entrants: Map<string, EntrantInfo>;
}

function formatShare(share: number): string {
  if (share === 0) return "0%";
  if (share < 0.001) return "<0.1%";
  return `${(share * 100).toFixed(1)}%`;
}

/**
 * Title probabilities across many seeded runs: the uncertainty behind the one
 * story bracket. Shows reaching the semifinals and final plus winning it all.
 */
export default function TitleOddsTable({ odds, entrants }: Props) {
  const rounds = odds.entrants[0].advancement.length;
  // advancement[r] = won round r; winning the round before the semis = reached them.
  const columns = [
    { label: `Reach ${roundName(rounds - 2, rounds).toLowerCase()}`, round: rounds - 3 },
    { label: "Reach final", round: rounds - 2 },
    { label: "Win title", round: rounds - 1 },
  ];
  const sorted = [...odds.entrants].sort((a, b) => b.titleProbability - a.titleProbability || a.seed - b.seed);

  return (
    <div className="table-scroll">
      <table className="data-table">
        <caption>
          Title odds from {odds.runs.toLocaleString("en-US")} simulated tournaments with the same entrants and seeding
        </caption>
        <thead>
          <tr>
            <th scope="col">Seed</th>
            <th scope="col">Team</th>
            {columns.map((c) => (
              <th key={c.label} scope="col" className="num">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => (
            <tr key={e.key}>
              <td className="tabular">{e.seed}</td>
              <th scope="row">{teamLabel(entrants.get(e.key)!.team)}</th>
              {columns.map((c) => (
                <td key={c.label} className="num tabular">
                  {formatShare(e.advancement[c.round])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
