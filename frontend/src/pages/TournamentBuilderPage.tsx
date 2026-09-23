// Local custom tournament (F04): pick eight team-seasons, choose the seeding
// and series length, and get a shareable /t/<code> link. Nothing is stored
// server-side; the link is the whole definition.

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { encodeTournament, generateSeed, type SeriesBestOf } from "../tournament";
import { loadIndex } from "../lib/dataLoader";
import type { IndexTeam } from "../types";
import SearchPicker from "../components/SearchPicker";

const SIZE = 8;
const BEST_OF: SeriesBestOf[] = [1, 3, 5, 7];

type Seeding = "net-rating" | "as-added";

export default function TournamentBuilderPage() {
  const navigate = useNavigate();
  const [teams, setTeams] = useState<IndexTeam[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<IndexTeam[]>([]);
  const [seeding, setSeeding] = useState<Seeding>("net-rating");
  const [bestOf, setBestOf] = useState<SeriesBestOf>(7);

  useEffect(() => {
    loadIndex()
      .then((data) => setTeams(data.teams))
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <p className="center-note">Couldn't load team data: {error}</p>;
  if (!teams) {
    return (
      <p className="center-note">
        <span className="loading-dot" aria-hidden="true" /> Loading team-seasons&hellip;
      </p>
    );
  }

  const chosen = new Set(field.map((t) => t.key));
  const available = teams.filter((t) => !chosen.has(t.key));
  const seeded =
    seeding === "net-rating"
      ? [...field].sort((a, b) => b.netRating - a.netRating || (a.key < b.key ? -1 : 1))
      : field;

  const handleCreate = () => {
    const encoded = encodeTournament({
      version: 1,
      entrants: seeded.map((t) => t.key),
      seed: generateSeed(Math.random),
      seriesBestOf: bestOf,
    });
    if (encoded.ok) navigate(`/t/${encoded.value}`);
  };

  return (
    <div className="tournament">
      <header className="tournament__header">
        <h1>Build a tournament</h1>
        <p className="tournament__meta">Eight team-seasons, one neutral court, one shareable link.</p>
      </header>

      {field.length < SIZE ? (
        <SearchPicker
          teams={available}
          onSelect={(team) => setField((f) => (f.length < SIZE ? [...f, team] : f))}
          placeholder={`Add team ${field.length + 1} of ${SIZE}, e.g. "98 bulls"`}
          autoFocus
        />
      ) : (
        <p className="tournament__hint">Field complete. Remove a team to swap it out.</p>
      )}

      <h2>
        Field <span className="tabular">({field.length} of {SIZE})</span>
      </h2>
      {field.length === 0 ? (
        <p className="tournament__hint">No teams yet.</p>
      ) : (
        <ol className="builder__list">
          {seeded.map((team, i) => (
            <li key={team.key} className="builder__item">
              <span className="bracket__seed tabular">{i + 1}</span>
              <span className="builder__name">
                {team.season} {team.city} {team.name}
              </span>
              <span className="builder__stat tabular">
                {team.netRating > 0 ? "+" : ""}
                {team.netRating.toFixed(1)}
              </span>
              <button
                type="button"
                className="btn btn--small"
                aria-label={`Remove ${team.season} ${team.city} ${team.name}`}
                onClick={() => setField((f) => f.filter((t) => t.key !== team.key))}
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}

      <fieldset className="builder__options">
        <legend>Seeding</legend>
        <label>
          <input
            type="radio"
            name="seeding"
            checked={seeding === "net-rating"}
            onChange={() => setSeeding("net-rating")}
          />{" "}
          By regular-season net rating
        </label>
        <label>
          <input type="radio" name="seeding" checked={seeding === "as-added"} onChange={() => setSeeding("as-added")} />{" "}
          In the order I added them
        </label>
      </fieldset>

      <fieldset className="builder__options">
        <legend>Series length</legend>
        {BEST_OF.map((n) => (
          <label key={n}>
            <input type="radio" name="best-of" checked={bestOf === n} onChange={() => setBestOf(n)} />{" "}
            {n === 1 ? "Single game" : `Best-of-${n}`}
          </label>
        ))}
      </fieldset>

      <div className="tournament__actions">
        <button type="button" className="btn btn--primary" disabled={field.length !== SIZE} onClick={handleCreate}>
          Create tournament
        </button>
        <Link className="btn" to="/tournament">
          Play the Champions bracket instead
        </Link>
      </div>
    </div>
  );
}
