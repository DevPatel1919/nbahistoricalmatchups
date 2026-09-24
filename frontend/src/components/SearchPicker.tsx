import { useId, useMemo, useState, type KeyboardEvent } from "react";
import type { IndexTeam } from "../types";
import { searchTeams } from "../lib/search";

interface Props {
  teams: IndexTeam[];
  onSelect: (team: IndexTeam) => void;
  placeholder?: string;
  excludeKey?: string;
  autoFocus?: boolean;
}

export default function SearchPicker({ teams, onSelect, placeholder, excludeKey, autoFocus }: Props) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const listId = useId();

  const results = useMemo(() => {
    if (query.trim().length === 0) return [];
    const matches = searchTeams(teams, query, 30);
    return excludeKey ? matches.filter((t) => t.key !== excludeKey) : matches;
  }, [teams, query, excludeKey]);

  const handleSelect = (team: IndexTeam) => {
    onSelect(team);
    setQuery("");
    setHighlighted(0);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSelect(results[highlighted]);
    } else if (e.key === "Escape") {
      setQuery("");
    }
  };

  return (
    <div className="search-box" role="combobox" aria-expanded={results.length > 0} aria-haspopup="listbox" aria-owns={listId}>
      <input
        type="text"
        value={query}
        placeholder={placeholder ?? "Try \"98 bulls\" or \"2017 warriors\""}
        aria-label={placeholder ?? "Search for a team and season"}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={results.length > 0 ? `${listId}-opt-${highlighted}` : undefined}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlighted(0);
        }}
        onKeyDown={handleKeyDown}
      />
      {results.length > 0 && (
        <ul className="search-results" id={listId} role="listbox">
          {results.map((team, i) => (
            <li key={team.key} role="presentation">
              <button
                type="button"
                role="option"
                id={`${listId}-opt-${i}`}
                aria-selected={i === highlighted}
                className="search-results__item"
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => handleSelect(team)}
              >
                <span>
                  {team.city} {team.name}
                  {!team.madePlayoffs && " (missed playoffs)"}
                </span>
                <span className="search-results__season tabular">{team.season}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
