import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { IndexTeam, OpponentResult } from "../types";
import { loadIndex, loadTeamFile } from "../lib/dataLoader";
import { buildMatchupSlug, canonicalOrder, parseMatchupSlug } from "../lib/slug";
import { track, type MatchupEntry, type ShareVariant } from "../lib/analytics";
import { experimentVariant, markCoreJobDone } from "../lib/visitor";
import { drawMatchupCard } from "../share/cards";
import { matchupCardData } from "../share/cardData";
import WinnerCard from "../components/WinnerCard";
import SeriesOdds from "../components/SeriesOdds";
import StatComparison from "../components/StatComparison";
import SearchPicker from "../components/SearchPicker";
import RandomMatchupButton from "../components/RandomMatchupButton";
import ShareImageButton from "../components/ShareImageButton";

/** F05 experiment: a plain result link vs a "make your pick first" challenge link. */
export const SHARE_FRAMING_EXPERIMENT = "share-framing-v1";
const SHARE_VARIANTS: readonly ShareVariant[] = ["plain", "challenge"];

/** How the visitor arrived: in-app navigation passes `state.entry`; shared links carry `?via=`. */
function entryFor(state: unknown, via: string | null): MatchupEntry {
  const entry = (state as { entry?: MatchupEntry } | null)?.entry;
  if (entry) return entry;
  if (via === "challenge") return "shared-challenge";
  if (via === "share") return "shared-plain";
  return "direct";
}

export default function ResultPage() {
  const { matchupSlug = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const via = searchParams.get("via");

  const [teams, setTeams] = useState<IndexTeam[] | null>(null);
  // Keyed by the pair it belongs to, so a result for a previous matchup is
  // discarded during render rather than cleared by a setState in the effect.
  const [loaded, setLoaded] = useState<{ pair: string; result: OpponentResult } | null>(null);
  // The pair whose challenge the visitor has answered, and their pick.
  const [answer, setAnswer] = useState<{ pair: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [changing, setChanging] = useState<"a" | "b" | null>(null);
  // Events already reported, keyed by navigation + pair, so StrictMode's
  // double effects and re-renders never report the same transition twice.
  const reported = useRef(new Set<string>());

  const parsed = parseMatchupSlug(matchupSlug);

  useEffect(() => {
    loadIndex()
      .then((data) => setTeams(data.teams))
      .catch((e) => {
        track({ name: "app_error", surface: "matchup", code: "index-load-failed" });
        setError(String(e));
      });
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
  const isCanonical = teamA && teamB ? canonicalOrder(teamA.key, teamA.season, teamB.key, teamB.season)[0] === teamA.key : false;
  const challengeOpen = via === "challenge" && (answer === null || answer.pair !== pair);
  const shown = result !== null && !challengeOpen;

  useEffect(() => {
    // The canonical-order check below can redirect the SAME mounted ResultPage
    // to a new matchupSlug (react-router keeps this component instance across
    // a <Navigate> to a sibling match), which re-fires this effect with a new
    // (teamA, teamB) pair while the previous pair's fetch may still be in
    // flight. Guard against that stale response overwriting a newer one.
    let cancelled = false;
    if (!teamA || !teamB || !pair || !isCanonical) return;
    const startKey = `started|${location.key}|${pair}`;
    if (!reported.current.has(startKey)) {
      reported.current.add(startKey);
      track({ name: "matchup_started", entrySurface: entryFor(location.state, via) });
    }
    loadTeamFile(teamA.key)
      .then((file) => {
        if (cancelled) return;
        const r = file.opponents[teamB.key];
        if (!r) {
          track({ name: "app_error", surface: "matchup", code: "missing-matchup" });
          setError(`No result found for ${teamA.key} vs ${teamB.key}`);
          return;
        }
        setLoaded({ pair, result: r });
      })
      .catch((e) => {
        if (cancelled) return;
        track({ name: "app_error", surface: "matchup", code: "team-file-load-failed" });
        setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [teamA, teamB, pair, isCanonical, location.key, location.state, via]);

  // A matchup is complete when its result is actually on screen.
  useEffect(() => {
    if (!shown || !teamA || !teamB) return;
    const doneKey = `completed|${location.key}|${pair}`;
    if (reported.current.has(doneKey)) return;
    reported.current.add(doneKey);
    markCoreJobDone();
    track({
      name: "matchup_completed",
      teamA: teamA.key,
      teamB: teamB.key,
      extrapolationWarning: !teamA.madePlayoffs || !teamB.madePlayoffs,
    });
  }, [shown, teamA, teamB, pair, location.key]);

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

  if (!isCanonical) {
    const [canonicalA, canonicalB] = canonicalOrder(teamA.key, teamA.season, teamB.key, teamB.season);
    // Keep ?via= and the entry state, so attribution survives the redirect.
    return <Navigate to={`/${buildMatchupSlug(canonicalA, canonicalB)}${location.search}`} state={location.state} replace />;
  }

  const handleSwap = (side: "a" | "b", newTeam: IndexTeam) => {
    const other = side === "a" ? teamB : teamA;
    const [first, second] = canonicalOrder(newTeam.key, newTeam.season, other.key, other.season);
    const matchup = buildMatchupSlug(first, second);
    setChanging(null);
    track({ name: "matchup_team_swapped", side, matchup });
    navigate(`/${matchup}`, { state: { entry: "swap" } });
  };

  const shareVariant = () => experimentVariant(SHARE_FRAMING_EXPERIMENT, SHARE_VARIANTS);

  const handleCopyLink = async () => {
    const variant = shareVariant();
    const url = `${window.location.origin}/${buildMatchupSlug(teamA.key, teamB.key)}?via=${variant === "challenge" ? "challenge" : "share"}`;
    try {
      await navigator.clipboard.writeText(url);
      track({ name: "matchup_shared", surface: "result-page", shareMethod: "copy", variant });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable; nothing more we can do here.
    }
  };

  const handleAnswer = (key: string) => {
    if (!pair || !result) return;
    const modelPick = result.p >= 0.5 ? teamA.key : teamB.key;
    setAnswer({ pair, key });
    track({ name: "challenge_answered", agreedWithModel: key === modelPick });
  };

  if (challengeOpen) {
    return (
      <>
        <div className="matchup-header">
          <a href="/">&larr; Pick another matchup</a>
        </div>
        <section className="challenge" aria-labelledby="challenge-heading">
          <p className="challenge__kicker">Someone sent you a matchup</p>
          <h1 id="challenge-heading">Who wins on a neutral court?</h1>
          <p className="challenge__hint">Make your call before you see what the model says.</p>
          <div className="challenge__choices">
            {[teamA, teamB].map((team) => (
              <button
                key={team.key}
                type="button"
                className="btn challenge__choice"
                disabled={!result}
                onClick={() => handleAnswer(team.key)}
              >
                <span className="challenge__season tabular">{team.season}</span>
                <span>
                  {team.city} {team.name}
                </span>
                <span className="challenge__record tabular">
                  {team.wins}-{team.losses}
                </span>
              </button>
            ))}
          </div>
        </section>
      </>
    );
  }

  const answeredKey = answer && answer.pair === pair ? answer.key : null;
  const answeredTeam = answeredKey === teamA.key ? teamA : answeredKey === teamB.key ? teamB : null;

  return (
    <>
      <div className="matchup-header">
        <a href="/">&larr; Pick another matchup</a>
      </div>

      {result ? (
        <>
          {answeredTeam && (
            <p className="challenge__verdict" role="status">
              You picked the {answeredTeam.season} {answeredTeam.name}.{" "}
              {(result.p >= 0.5) === (answeredTeam.key === teamA.key) ? "The model agrees." : "The model disagrees."}
            </p>
          )}
          <WinnerCard teamA={teamA} teamB={teamB} p={result.p} m={result.m} />
          <SeriesOdds teamA={teamA} teamB={teamB} p={result.p} />
          <StatComparison teamA={teamA} teamB={teamB} />

          <div className="result-actions">
            <button type="button" className="btn" onClick={handleCopyLink}>
              Copy link{copied && <span className="copy-feedback">Copied!</span>}
            </button>
            <ShareImageButton
              draw={(ctx) => drawMatchupCard(ctx, matchupCardData(teamA, teamB, result))}
              filename={`${buildMatchupSlug(teamA.key, teamB.key)}.png`}
              title={`${teamA.season} ${teamA.name} vs ${teamB.season} ${teamB.name}`}
              onShared={() => track({ name: "matchup_shared", surface: "result-page", shareMethod: "image", variant: shareVariant() })}
            />
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
