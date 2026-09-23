import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import type { IndexTeam, OpponentResult } from "../types";
import { loadIndex, loadTeamFile } from "../lib/dataLoader";
import { buildMatchupSlug, canonicalOrder, parseMatchupSlug } from "../lib/slug";
import { track } from "../lib/analytics";
import WinnerCard from "../components/WinnerCard";
import SeriesOdds from "../components/SeriesOdds";
import StatComparison from "../components/StatComparison";
import SearchPicker from "../components/SearchPicker";
import RandomMatchupButton from "../components/RandomMatchupButton";

export default function ResultPage() {
  const { matchupSlug = "" } = useParams();
  const navigate = useNavigate();

  const [teams, setTeams] = useState<IndexTeam[] | null>(null);
  // Keyed by the pair it belongs to, so a result for a previous matchup is
  // discarded during render rather than cleared by a setState in the effect.
  const [loaded, setLoaded] = useState<{ pair: string; result: OpponentResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [changing, setChanging] = useState<"a" | "b" | null>(null);

  const parsed = parseMatchupSlug(matchupSlug);

  useEffect(() => {
    loadIndex()
      .then((data) => setTeams(data.teams))
      .catch((e) => setError(String(e)));
  }, []);

  const keyA = parsed?.[0];
  const keyB = parsed?.[1];
  const teamA = teams?.find((t) => t.key === keyA);
  const teamB = teams?.find((t) => t.key === keyB);

  const pair = teamA && teamB ? `${teamA.key}|${teamB.key}` : null;
  // Only the result belonging to the pair currently on screen counts. A result
  // left over from a previous pair is ignored here, during render, so the
  // effect below never has to clear it synchronously.
  const result = loaded && loaded.pair === pair ? loaded.result : null;

  useEffect(() => {
    // The canonical-order check below can redirect the SAME mounted ResultPage
    // to a new matchupSlug (react-router keeps this component instance across
    // a <Navigate> to a sibling match), which re-fires this effect with a new
    // (teamA, teamB) pair while the previous pair's fetch may still be in
    // flight. Guard against that stale response overwriting a newer one.
    let cancelled = false;
    if (!teamA || !teamB || !pair) return;
    loadTeamFile(teamA.key)
      .then((file) => {
        if (cancelled) return;
        const r = file.opponents[teamB.key];
        if (!r) {
          setError(`No result found for ${teamA.key} vs ${teamB.key}`);
          return;
        }
        setLoaded({ pair, result: r });
        track({
          name: "matchup_viewed",
          matchup: buildMatchupSlug(teamA.key, teamB.key),
          teamA: teamA.key,
          teamB: teamB.key,
        });
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [teamA, teamB, pair]);

  if (error) {
    return <p className="center-note">{error}</p>;
  }

  if (!teams) {
    return (
      <p className="center-note">
        <span className="loading-dot" aria-hidden="true" /> Loading&hellip;
      </p>
    );
  }

  if (!parsed || !teamA || !teamB) {
    return (
      <div className="center-note">
        <p>We couldn't find that matchup.</p>
        <RandomMatchupButton teams={teams} className="btn btn--primary" />
      </div>
    );
  }

  const [canonicalA, canonicalB] = canonicalOrder(teamA.key, teamA.season, teamB.key, teamB.season);
  if (canonicalA !== teamA.key) {
    return <Navigate to={`/${buildMatchupSlug(canonicalA, canonicalB)}`} replace />;
  }

  const handleSwap = (side: "a" | "b", newTeam: IndexTeam) => {
    const other = side === "a" ? teamB : teamA;
    const [first, second] = canonicalOrder(newTeam.key, newTeam.season, other.key, other.season);
    const matchup = buildMatchupSlug(first, second);
    setChanging(null);
    track({ name: "matchup_team_swapped", side, matchup });
    navigate(`/${matchup}`);
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      track({ name: "matchup_link_copied", matchup: buildMatchupSlug(teamA.key, teamB.key) });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable; nothing more we can do here.
    }
  };

  return (
    <>
      <div className="matchup-header">
        <a href="/">&larr; Pick another matchup</a>
      </div>

      {result ? (
        <>
          <WinnerCard teamA={teamA} teamB={teamB} p={result.p} m={result.m} />
          <SeriesOdds teamA={teamA} teamB={teamB} p={result.p} />
          <StatComparison teamA={teamA} teamB={teamB} />

          <div className="result-actions">
            <button type="button" className="btn" onClick={handleCopyLink}>
              Copy link{copied && <span className="copy-feedback">Copied!</span>}
            </button>
            <button type="button" className="btn" onClick={() => setChanging(changing === "a" ? null : "a")}>
              Change {teamA.name}
            </button>
            <button type="button" className="btn" onClick={() => setChanging(changing === "b" ? null : "b")}>
              Change {teamB.name}
            </button>
            <RandomMatchupButton teams={teams} label="Random matchup" />
          </div>

          {changing && (
            <div style={{ marginTop: 16 }}>
              <SearchPicker
                teams={teams}
                excludeKey={changing === "a" ? teamB.key : teamA.key}
                placeholder={`Replace ${changing === "a" ? teamA.name : teamB.name} with...`}
                onSelect={(t) => handleSwap(changing, t)}
                autoFocus
              />
            </div>
          )}
        </>
      ) : (
        <p className="center-note">
          <span className="loading-dot" aria-hidden="true" /> Crunching the matchup&hellip;
        </p>
      )}
    </>
  );
}
