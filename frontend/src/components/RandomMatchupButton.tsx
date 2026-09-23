import { useNavigate } from "react-router-dom";
import type { IndexTeam } from "../types";
import { buildMatchupSlug, canonicalOrder } from "../lib/slug";

interface Props {
  teams: IndexTeam[];
  label?: string;
  className?: string;
}

export default function RandomMatchupButton({ teams, label = "Random matchup", className = "btn" }: Props) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (teams.length < 2) return;
    const a = teams[Math.floor(Math.random() * teams.length)];
    let b = teams[Math.floor(Math.random() * teams.length)];
    while (b.key === a.key) {
      b = teams[Math.floor(Math.random() * teams.length)];
    }
    const [first, second] = canonicalOrder(a.key, a.season, b.key, b.season);
    navigate(`/${buildMatchupSlug(first, second)}`);
  };

  return (
    <button type="button" className={className} onClick={handleClick}>
      {label}
    </button>
  );
}
