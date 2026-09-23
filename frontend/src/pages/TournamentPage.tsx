// The tournament journey (F04): entrants and assumptions, the fan's picks,
// the round-by-round reveal of the model's seeded story, score, title odds,
// and sharing.
//
//   /tournament   the curated Champions bracket
//   /t/:code      any definition, in the F03 URL format (shared links)
//
// A shared link carries the definition only. The fan's picks stay in local
// storage (lib/tournamentStorage.ts) and are never put in a URL.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  buildMatchupTable,
  decodeTournament,
  encodeTournament,
  generateSeed,
  runBracket,
  runTitleOdds,
  validateDefinition,
  type BracketResult,
  type MatchupTable,
  type TournamentDefinition,
} from "../tournament";
import { CHAMPIONS, CURATED_TOURNAMENTS, type CuratedTournament } from "../data/curated-tournaments";
import { loadIndex, loadTeamFile } from "../lib/dataLoader";
import {
  biggestDisagreement,
  emptyPicks,
  isComplete,
  pickCount,
  pickSlots,
  roundName,
  roundPoints,
  scorePicks,
  setPick,
  teamLabel,
} from "../lib/bracket";
import { clearProgress, loadProgress, saveProgress, type TournamentProgress } from "../lib/tournamentStorage";
import { track } from "../lib/analytics";
import BracketView, { type EntrantInfo } from "../components/tournament/BracketView";
import TitleOddsTable from "../components/tournament/TitleOddsTable";
import type { IndexTeam } from "../types";

interface Loaded {
  code: string;
  definition: TournamentDefinition;
  curated: CuratedTournament | null;
  entrants: Map<string, EntrantInfo>;
  table: MatchupTable;
  bracket: BracketResult;
}

type LoadState = { kind: "loading" } | { kind: "invalid"; message: string } | { kind: "error"; message: string } | ({ kind: "ready" } & Loaded);

function curatedFor(code: string): CuratedTournament | null {
  return CURATED_TOURNAMENTS.find((t) => {
    const encoded = encodeTournament(t.definition);
    return encoded.ok && encoded.value === code;
  }) ?? null;
}

export default function TournamentPage() {
  const { code } = useParams();
  // A new code (e.g. after "run another") is a new tournament: remount.
  return <TournamentLoader key={code ?? ""} code={code} />;
}

function TournamentLoader({ code }: { code: string | undefined }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const settle = (next: LoadState) => {
      if (!cancelled) setState(next);
    };

    loadIndex()
      .then(async (index) => {
        const known = new Set(index.teams.map((t) => t.key));
        const decoded = code === undefined ? validateDefinition(CHAMPIONS.definition, known) : decodeTournament(code, known);
        if (!decoded.ok) {
          settle({ kind: "invalid", message: decoded.error.message });
          return;
        }
        const definition = decoded.value;
        const encoded = encodeTournament(definition);
        if (!encoded.ok) {
          settle({ kind: "invalid", message: encoded.error.message });
          return;
        }
        const files = await Promise.all(definition.entrants.map((key) => loadTeamFile(key)));
        const table = buildMatchupTable(files);
        if (!table.ok) {
          settle({ kind: "invalid", message: table.error.message });
          return;
        }
        const bracket = runBracket(definition, table.value);
        if (!bracket.ok) {
          settle({ kind: "invalid", message: bracket.error.message });
          return;
        }
        const byKey = new Map<string, IndexTeam>(index.teams.map((t) => [t.key, t]));
        const entrants = new Map<string, EntrantInfo>(
          definition.entrants.map((key, i) => [key, { team: byKey.get(key)!, seed: i + 1 }]),
        );
        settle({
          kind: "ready",
          code: encoded.value,
          definition,
          curated: curatedFor(encoded.value),
          entrants,
          table: table.value,
          bracket: bracket.value,
        });
      })
      .catch((e) => settle({ kind: "error", message: String(e) }));

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (state.kind === "loading") {
    return (
      <p className="center-note">
        <span className="loading-dot" aria-hidden="true" /> Loading the tournament&hellip;
      </p>
    );
  }
  if (state.kind === "invalid" || state.kind === "error") {
    return (
      <div className="center-note tournament-invalid" role="alert">
        <h1>{state.kind === "invalid" ? "This tournament link doesn't work" : "Couldn't load the tournament"}</h1>
        <p>
          {state.kind === "invalid"
            ? "It may have been copied incompletely, edited, or made for a team-season we no longer list."
            : "The team data failed to load. Check your connection and try again."}
        </p>
        <p className="tournament-invalid__detail">{state.message}</p>
        <div className="picker-actions">
          <Link className="btn btn--primary" to="/tournament">
            Open the Champions bracket
          </Link>
          <Link className="btn" to="/tournament/new">
            Build your own
          </Link>
        </div>
      </div>
    );
  }
  return <TournamentJourney {...state} />;
}

function TournamentJourney({ code, definition, curated, entrants, table, bracket }: Loaded) {
  const navigate = useNavigate();
  const size = definition.entrants.length;
  const rounds = bracket.rounds.length;
  const tournamentId = curated?.id ?? `custom-${size}`;

  const [progress, setProgress] = useState<TournamentProgress>(
    () =>
      loadProgress(code, definition.entrants) ?? {
        started: false,
        picks: emptyPicks(size),
        revealed: 0,
        completionTracked: false,
      },
  );
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const resultHeading = useRef<HTMLHeadingElement>(null);

  const update = (next: TournamentProgress) => {
    setProgress(next);
    saveProgress(code, next);
  };

  const { picks, revealed } = progress;
  const complete = isComplete(picks);
  const fullyRevealed = revealed === rounds;
  const slots = useMemo(() => pickSlots(definition.entrants, picks), [definition.entrants, picks]);
  const score = scorePicks(picks, bracket, revealed);
  const count = pickCount(picks);

  // Title odds only once the story is fully revealed; ~30 ms for 16 teams.
  const odds = useMemo(() => {
    if (!fullyRevealed) return null;
    const result = runTitleOdds(definition, table);
    return result.ok ? result.value : null;
  }, [fullyRevealed, definition, table]);

  const disagreement = useMemo(
    () => (fullyRevealed ? biggestDisagreement(definition.entrants, picks, table, definition.seriesBestOf) : null),
    [fullyRevealed, definition, picks, table],
  );

  useEffect(() => {
    if (fullyRevealed) resultHeading.current?.focus();
  }, [fullyRevealed]);

  const nameOf = (key: string) => teamLabel(entrants.get(key)!.team);

  const handleStart = () => {
    update({ ...progress, started: true });
    track({ name: "tournament_started", tournamentId, entrantCount: size });
  };

  const handlePick = (round: number, index: number, key: string) => {
    const nextPicks = setPick(definition.entrants, picks, round, index, key);
    const nowComplete = isComplete(nextPicks);
    update({ ...progress, picks: nextPicks, completionTracked: progress.completionTracked || nowComplete });
    if (nowComplete && !progress.completionTracked) {
      track({ name: "bracket_predictions_completed", tournamentId });
    }
  };

  const handleReveal = (mode: "round" | "all") => {
    const next = mode === "all" ? rounds : revealed + 1;
    update({ ...progress, revealed: next });
    if (revealed === 0) track({ name: "tournament_revealed", tournamentId, revealMode: mode });
    const nextScore = scorePicks(picks, bracket, next);
    setStatus(
      next === rounds
        ? `All rounds revealed. You scored ${nextScore.points} of ${nextScore.maxPoints} points.`
        : `${roundName(next - 1, rounds)} revealed: ${nextScore.rounds[next - 1].correct} of ${nextScore.rounds[next - 1].games} picks correct.`,
    );
  };

  const handleStartOver = () => {
    clearProgress(code);
    setProgress({ started: true, picks: emptyPicks(size), revealed: 0, completionTracked: progress.completionTracked });
    setStatus("Picks cleared.");
  };

  const handleRunAnother = () => {
    const nextDefinition = { ...definition, seed: generateSeed(Math.random) };
    const encoded = encodeTournament(nextDefinition);
    if (!encoded.ok) return;
    // Carry the fan's picks over, so they can be scored against a new story.
    saveProgress(encoded.value, { ...progress, revealed: 0 });
    navigate(`/t/${encoded.value}`);
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/t/${code}`;
    const title = curated?.title ?? "Court of All Time tournament";
    const text = "Make your picks before you reveal the model's bracket.";
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, text, url });
        track({ name: "tournament_shared", tournamentId, shareMethod: "native" });
        return;
      }
      await navigator.clipboard.writeText(url);
      track({ name: "tournament_shared", tournamentId, shareMethod: "copy" });
      setShareNote("Link copied. It shares the tournament and the model's story, not your picks.");
    } catch {
      // Share sheet dismissed or clipboard unavailable: nothing was shared.
    }
  };

  const title = curated?.title ?? `Custom ${size}-team tournament`;
  const champion = bracket.champion;
  const fanChampion = picks[rounds - 1][0];

  return (
    <div className="tournament">
      <header className="tournament__header">
        <h1>{title}</h1>
        <p className="tournament__meta">
          {size} teams &middot; best-of-{definition.seriesBestOf} series &middot; neutral court
        </p>
      </header>

      <p className="visually-hidden" aria-live="polite">
        {status}
      </p>

      {!progress.started ? (
        <Intro curated={curated} definition={definition} entrants={entrants} onStart={handleStart} />
      ) : revealed === 0 ? (
        <section aria-labelledby="predict-heading">
          <div className="tournament__bar">
            <h2 id="predict-heading">Your picks</h2>
            <p className="tournament__progress tabular">
              {count.made} of {count.total} series picked
            </p>
          </div>
          <p className="tournament__hint">
            Pick the winner of every series, then reveal how the model's bracket played out. Changing a pick clears
            later picks that depended on it.
          </p>
          <BracketView entrants={entrants} picks={picks} mode={{ kind: "predict", slots, onPick: handlePick }} />
          <div className="tournament__actions">
            {complete ? (
              <>
                <button type="button" className="btn btn--primary" onClick={() => handleReveal("round")}>
                  Reveal round by round
                </button>
                <button type="button" className="btn" onClick={() => handleReveal("all")}>
                  Reveal everything
                </button>
              </>
            ) : (
              <p className="tournament__hint">Pick every series to unlock the model's bracket.</p>
            )}
            {count.made > 0 && (
              <button type="button" className="btn" onClick={handleStartOver}>
                Clear picks
              </button>
            )}
          </div>
        </section>
      ) : (
        <section aria-labelledby="reveal-heading">
          {fullyRevealed ? (
            <div className="tournament-summary">
              <h2 id="reveal-heading" ref={resultHeading} tabIndex={-1}>
                {nameOf(champion)} win the title
              </h2>
              <dl className="tournament-summary__facts">
                <div>
                  <dt>Your score</dt>
                  <dd className="scoreboard">
                    {score.points} <span className="tournament-summary__of">/ {score.maxPoints}</span>
                  </dd>
                </div>
                <div>
                  <dt>Correct picks</dt>
                  <dd className="scoreboard">
                    {score.correct} <span className="tournament-summary__of">/ {score.games}</span>
                  </dd>
                </div>
                <div>
                  <dt>Your champion</dt>
                  <dd>
                    {fanChampion ? nameOf(fanChampion) : "None"}
                    {fanChampion === champion ? " ✓" : ""}
                  </dd>
                </div>
              </dl>
              <p className="tournament-summary__line">
                {disagreement
                  ? `Your boldest call: ${nameOf(disagreement.winner)} over ${nameOf(disagreement.loser)} in the ${roundName(
                      disagreement.round,
                      rounds,
                    ).toLowerCase()}. The model gives that ${formatPercent(disagreement.seriesProbability)} in a best-of-${
                      definition.seriesBestOf
                    }.`
                  : "You picked the model's favorite in every series."}
              </p>
            </div>
          ) : (
            <div className="tournament__bar">
              <h2 id="reveal-heading">The model's bracket</h2>
              <p className="tournament__progress tabular">
                {score.points} points so far
              </p>
            </div>
          )}

          <BracketView entrants={entrants} picks={picks} mode={{ kind: "reveal", model: bracket, revealed }} />

          {!fullyRevealed && (
            <div className="tournament__actions">
              <button type="button" className="btn btn--primary" onClick={() => handleReveal("round")}>
                Reveal {roundName(revealed, rounds).toLowerCase()}
              </button>
              <button type="button" className="btn" onClick={() => handleReveal("all")}>
                Reveal the rest
              </button>
            </div>
          )}

          {fullyRevealed && (
            <>
              <div className="table-scroll">
                <table className="data-table">
                  <caption>Your score by round</caption>
                  <thead>
                    <tr>
                      <th scope="col">Round</th>
                      <th scope="col" className="num">
                        Correct
                      </th>
                      <th scope="col" className="num">
                        Points each
                      </th>
                      <th scope="col" className="num">
                        Points
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {score.rounds.map((r, i) => (
                      <tr key={i}>
                        <th scope="row">{roundName(i, rounds)}</th>
                        <td className="num tabular">
                          {r.correct} / {r.games}
                        </td>
                        <td className="num tabular">{roundPoints(i)}</td>
                        <td className="num tabular">{r.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <section className="tournament-odds" aria-labelledby="odds-heading">
                <h2 id="odds-heading">How likely was that?</h2>
                <p>
                  The bracket above is one seeded story: this link always plays out the same way. Replaying the same
                  field many times shows how open the title really is.
                </p>
                {odds && <TitleOddsTable odds={odds} entrants={entrants} />}
              </section>

              <div className="tournament__actions">
                <button type="button" className="btn btn--primary" onClick={handleShare}>
                  Share this tournament
                </button>
                <button type="button" className="btn" onClick={handleRunAnother}>
                  Run another story
                </button>
                <button type="button" className="btn" onClick={handleStartOver}>
                  Start over
                </button>
              </div>
              {shareNote && <p className="tournament__hint">{shareNote}</p>}
              <p className="tournament__hint">
                "Run another story" plays the same field with a new seed and gives it a new link. Your picks come
                with you.
              </p>
            </>
          )}
        </section>
      )}

      <Assumptions bestOf={definition.seriesBestOf} />
    </div>
  );
}

function formatPercent(p: number): string {
  const pct = p * 100;
  return pct < 1 ? "under 1%" : `${Math.round(pct)}%`;
}

interface IntroProps {
  curated: CuratedTournament | null;
  definition: TournamentDefinition;
  entrants: Map<string, EntrantInfo>;
  onStart: () => void;
}

function Intro({ curated, definition, entrants, onStart }: IntroProps) {
  return (
    <section aria-labelledby="entrants-heading">
      {curated && <p className="tournament__lede">{curated.summary}</p>}
      <div className="tournament__actions">
        <button type="button" className="btn btn--primary" onClick={onStart}>
          Make my picks
        </button>
      </div>
      <h2 id="entrants-heading">Entrants</h2>
      <p className="tournament__hint">
        {curated?.seedingNote ??
          "Seeded in the order the tournament's creator chose. Seed 1 plays seed " + definition.entrants.length + " in the first round."}
      </p>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Seed</th>
              <th scope="col">Team</th>
              <th scope="col" className="num">
                Record
              </th>
              <th scope="col" className="num">
                Net rating
              </th>
            </tr>
          </thead>
          <tbody>
            {definition.entrants.map((key) => {
              const { team, seed } = entrants.get(key)!;
              return (
                <tr key={key}>
                  <td className="tabular">{seed}</td>
                  <th scope="row">
                    {team.season} {team.city} {team.name}
                  </th>
                  <td className="num tabular">
                    {team.wins}-{team.losses}
                  </td>
                  <td className="num tabular">
                    {team.netRating > 0 ? "+" : ""}
                    {team.netRating.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Assumptions({ bestOf }: { bestOf: number }) {
  return (
    <aside className="tournament-assumptions" aria-labelledby="assumptions-heading">
      <h2 id="assumptions-heading">How this works</h2>
      <ul>
        <li>Every game is on a neutral court. No home advantage, travel, or rest.</li>
        <li>
          Each game is independent, decided at the model's single-game win probability for that pair. A best-of-
          {bestOf} series ends when a team reaches {Math.ceil(bestOf / 2)} {bestOf === 1 ? "win" : "wins"}.
        </li>
        <li>
          The results are a model estimate for entertainment, from full-season team statistics. No box scores or
          player statistics are simulated. Not betting advice.
        </li>
        <li>
          The bracket is one seeded story: anyone opening the same link sees the same results. The title odds come from
          thousands of replays of the same field. See <Link to="/about">About</Link> for the model's limitations.
        </li>
      </ul>
    </aside>
  );
}
