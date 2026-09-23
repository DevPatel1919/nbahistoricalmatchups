import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { IndexTeam } from "../types";
import { loadIndex } from "../lib/dataLoader";
import { buildMatchupSlug, canonicalOrder } from "../lib/slug";
import SearchPicker from "../components/SearchPicker";
import BrowseGrid from "../components/BrowseGrid";
import RandomMatchupButton from "../components/RandomMatchupButton";

const SUGGESTIONS: [string, string][] = [
  ["1998-bulls", "2017-warriors"],
  ["2001-lakers", "2008-celtics"],
  ["1998-jazz", "2016-cavaliers"],
  ["2015-warriors", "2023-nuggets"],
];

export default function HomePage() {
  const [teams, setTeams] = useState<IndexTeam[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slotA, setSlotA] = useState<IndexTeam | null>(null);
  const [slotB, setSlotB] = useState<IndexTeam | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadIndex()
      .then((data) => setTeams(data.teams))
      .catch((e) => setError(String(e)));
  }, []);

  const byKey = (key: string) => teams?.find((t) => t.key === key);

  const handlePick = (team: IndexTeam) => {
    if (!slotA) {
      setSlotA(team);
    } else if (!slotB && team.key !== slotA.key) {
      setSlotB(team);
    }
  };

  const goToMatchup = (a: IndexTeam, b: IndexTeam) => {
    const [first, second] = canonicalOrder(a.key, a.season, b.key, b.season);
    navigate(`/${buildMatchupSlug(first, second)}`);
  };

  useEffect(() => {
    if (slotA && slotB) {
      goToMatchup(slotA, slotB);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotA, slotB]);

  if (error) {
    return <p className="center-note">Couldn't load team data: {error}</p>;
  }

  if (!teams) {
    return (
      <p className="center-note">
        <span className="loading-dot" aria-hidden="true" /> Loading team-seasons&hellip;
      </p>
    );
  }

  return (
    <>
      <section className="hero">
        <h1>Any two teams. Any two seasons. One neutral court.</h1>
        <p>
          835 team-seasons since 1998. Pick two, and the model calls a winner, a margin, and best-of-7 series odds.
        </p>

        <SearchPicker
          teams={teams}
          onSelect={handlePick}
          excludeKey={slotA?.key}
          placeholder='Try "98 bulls" or "2017 warriors"'
          autoFocus
        />

        <div className="picker-slots">
          <span className={`picker-slot${slotA ? " picker-slot--filled" : ""}`}>
            {slotA ? `${slotA.season} ${slotA.city} ${slotA.name}` : "Pick a first team"}
          </span>
          <span className="picker-vs">vs</span>
          <span className={`picker-slot${slotB ? " picker-slot--filled" : ""}`}>
            {slotB ? `${slotB.season} ${slotB.city} ${slotB.name}` : "Pick a second team"}
          </span>
        </div>

        <div className="picker-actions">
          {(slotA || slotB) && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setSlotA(null);
                setSlotB(null);
              }}
            >
              Clear
            </button>
          )}
          <RandomMatchupButton teams={teams} className="btn btn--primary" />
        </div>
      </section>

      <section className="browse" style={{ marginTop: 32 }}>
        <h2>Suggested matchups</h2>
        <div className="browse-grid">
          {SUGGESTIONS.map(([keyA, keyB]) => {
            const a = byKey(keyA);
            const b = byKey(keyB);
            if (!a || !b) return null;
            return (
              <button key={keyA + keyB} type="button" onClick={() => goToMatchup(a, b)}>
                <span className="franchise-name">
                  {a.season} {a.name}
                </span>
                <span className="franchise-count">
                  vs {b.season} {b.name}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <BrowseGrid teams={teams} onSelect={handlePick} />
    </>
  );
}
