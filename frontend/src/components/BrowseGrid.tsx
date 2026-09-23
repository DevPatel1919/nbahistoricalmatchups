import { useMemo, useState } from "react";
import type { IndexTeam } from "../types";

interface Props {
  teams: IndexTeam[];
  onSelect: (team: IndexTeam) => void;
}

interface Franchise {
  franchiseId: number;
  label: string;
  seasons: IndexTeam[];
}

export default function BrowseGrid({ teams, onSelect }: Props) {
  const [openFranchise, setOpenFranchise] = useState<number | null>(null);

  const franchises = useMemo<Franchise[]>(() => {
    const byId = new Map<number, IndexTeam[]>();
    for (const t of teams) {
      const list = byId.get(t.franchiseId) ?? [];
      list.push(t);
      byId.set(t.franchiseId, list);
    }
    const result: Franchise[] = [];
    for (const [franchiseId, seasons] of byId) {
      seasons.sort((a, b) => a.season - b.season);
      const newest = seasons[seasons.length - 1];
      result.push({ franchiseId, label: `${newest.city} ${newest.name}`, seasons });
    }
    result.sort((a, b) => a.label.localeCompare(b.label));
    return result;
  }, [teams]);

  const active = franchises.find((f) => f.franchiseId === openFranchise);

  if (active) {
    return (
      <section className="browse">
        <h2>
          <button
            type="button"
            className="btn"
            style={{ marginRight: 10, padding: "4px 10px", fontSize: "0.78rem" }}
            onClick={() => setOpenFranchise(null)}
          >
            Back
          </button>
          {active.label} by season
        </h2>
        <div className="browse-grid">
          {[...active.seasons].reverse().map((team) => (
            <button key={team.key} type="button" onClick={() => onSelect(team)}>
              <span className="franchise-name tabular">{team.season}</span>
              <span className="franchise-count">
                {team.wins}-{team.losses}
                {!team.madePlayoffs && " · missed playoffs"}
              </span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="browse">
      <h2>Browse by franchise</h2>
      <div className="browse-grid">
        {franchises.map((f) => (
          <button key={f.franchiseId} type="button" onClick={() => setOpenFranchise(f.franchiseId)}>
            <span className="franchise-name">{f.label}</span>
            <span className="franchise-count">{f.seasons.length} seasons</span>
          </button>
        ))}
      </div>
    </section>
  );
}
