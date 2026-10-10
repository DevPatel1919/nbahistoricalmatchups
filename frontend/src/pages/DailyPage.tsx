// Daily Three (F12 Session 3): three cross-era matchups a day, the same for
// every player. Pick a winner in each, lock in, then each game plays out as
// one seeded simulated game at the model's honest odds.
//
// Rules this page keeps (docs/product/features/F12-daily-three.md):
// - nothing the model says (p, m, or a simulated result) shows before lock-in;
// - m is never shown at all, and the odds after a final never read 0% or 100%;
// - every game is labelled as one simulated game;
// - picks, and the simulated winners, are stored at lock-in, so a refresh
//   during the reveal lands on the results and the streak counts either way;
// - crowd stats (Session 4) are optional: with the duel API configured, the
//   day is sent once at lock-in and the crowd lines are fetched for the
//   results only. Any failure just leaves them out.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { localDate, puzzleDate, puzzleStatus, type PuzzleStatus } from "../daily/day";
import { computeStats, dayScore, getDay, recordDay } from "../daily/stats";
import type { DailyCrowdStats, Side } from "../daily/types";
import DailyPickCard from "../components/daily/DailyPickCard";
import DailyResults from "../components/daily/DailyResults";
import DailyReveal from "../components/daily/DailyReveal";
import { loadIndex } from "../lib/dataLoader";
import { parseCrowdStats, withClientId } from "../lib/dailyCrowd";
import { loadDailyDay, loadDailyMeta, loadDailyPool, readDailyStore, writeDailyStore } from "../lib/dailyData";
import { buildPuzzle, puzzleWinners, type Puzzle } from "../lib/dailyPuzzle";
import { DUEL_API, fetchDailyStats, postDailyResult } from "../lib/duelApi";

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "closed"; status: PuzzleStatus; launchDate: string }
  | { kind: "ready"; puzzle: Puzzle };

export default function DailyPage() {
  // The player's local date picks the puzzle; it moves on at local midnight.
  const [today, setToday] = useState(() => localDate(new Date()));
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const meta = await loadDailyMeta();
      const status = puzzleStatus(meta, new Date());
      if (status.kind !== "ready") return { kind: "closed", status, launchDate: meta.launchDate } as const;
      const [index, pool, day] = await Promise.all([loadIndex(), loadDailyPool(), loadDailyDay(status.n)]);
      return { kind: "ready", puzzle: buildPuzzle(day, pool, index.teams) } as const;
    })()
      .then((next) => {
        if (!cancelled) setLoad(next);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoad({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [today]);

  const nextPuzzle = () => setToday(localDate(new Date()));

  if (load.kind === "loading") {
    return (
      <p className="center-note">
        <span className="loading-dot" aria-hidden="true" /> Loading today's games&hellip;
      </p>
    );
  }
  if (load.kind === "error") {
    return <p className="center-note">Couldn't load Daily Three: {load.message}</p>;
  }
  if (load.kind === "closed") {
    return (
      <div className="daily">
        <DailyHeader />
        <p className="center-note">
          {load.status.kind === "before-launch"
            ? `Daily Three starts on ${longDate(puzzleDate(load.launchDate, 1))}.`
            : "Today's game isn't ready yet. Check back soon."}
        </p>
      </div>
    );
  }
  return <DailyGame key={load.puzzle.n} puzzle={load.puzzle} onNextPuzzle={nextPuzzle} />;
}

function DailyGame({ puzzle, onNextPuzzle }: { puzzle: Puzzle; onNextPuzzle: () => void }) {
  const [store, setStore] = useState(readDailyStore);
  const [stage, setStage] = useState<"pick" | "reveal" | "done">(() => (getDay(store, puzzle.n) ? "done" : "pick"));
  const [picks, setPicks] = useState<(Side | null)[]>(() => puzzle.games.map(() => null));
  const [saved, setSaved] = useState(true);
  // False only for a day already finished when the page loaded.
  const [played, setPlayed] = useState(false);
  const [crowd, setCrowd] = useState<DailyCrowdStats | null>(null);
  // This page's result post, so the crowd fetch can wait for it.
  const resultSent = useRef<Promise<void> | null>(null);

  const record = getDay(store, puzzle.n);
  const stats = computeStats(store, puzzle.n);
  const picked = picks.filter((p) => p !== null).length;
  const locked = record !== undefined;

  useEffect(() => {
    // Crowd lines only once the day is locked in, and only on the results.
    if (stage !== "done" || !locked || !DUEL_API) return;
    let cancelled = false;
    (resultSent.current ?? Promise.resolve())
      .then(() => fetchDailyStats(puzzle.n))
      .then((value) => {
        if (!cancelled) setCrowd(parseCrowdStats(value, puzzle.n));
      })
      .catch(() => {
        if (!cancelled) setCrowd(null);
      });
    return () => {
      cancelled = true;
    };
  }, [stage, locked, puzzle.n]);

  const lockIn = () => {
    if (picks.some((p) => p === null)) return;
    let next = recordDay(store, puzzle.n, picks as Side[], puzzleWinners(puzzle));
    if (DUEL_API) next = withClientId(next);
    setSaved(writeDailyStore(next));
    setStore(next);
    const day = getDay(next, puzzle.n);
    if (DUEL_API && next.clientId && day) {
      // Sent once, at lock-in. A failure is ignored: the game never depends on the API.
      resultSent.current = postDailyResult(puzzle.n, { clientId: next.clientId, picks: day.picks, score: dayScore(day) }).catch(
        () => {},
      );
    }
    setPlayed(true);
    setStage(prefersReducedMotion() ? "done" : "reveal");
  };

  return (
    <div className="daily">
      <DailyHeader n={puzzle.n} date={puzzle.date} />

      {stage === "pick" && (
        <>
          {stats.played > 0 && (
            <p className="daily__streaks">
              <span aria-hidden="true">🔥</span> Play streak <strong className="tabular">{stats.playStreak.current}</strong>
              {" · "}
              <span aria-hidden="true">🎯</span> Hot streak <strong className="tabular">{stats.hotStreak.current}</strong>
            </p>
          )}
          <div className="daily__games">
            {puzzle.games.map((g) => (
              <DailyPickCard
                key={g.index}
                puzzleGame={g}
                pick={picks[g.index]}
                onPick={(side) => setPicks((prev) => prev.map((p, i) => (i === g.index ? side : p)))}
              />
            ))}
          </div>
          <div className="daily-lock">
            <p className="daily-lock__status" aria-live="polite">
              {picked} of {puzzle.games.length} picked
            </p>
            <button type="button" className="btn btn--primary" disabled={picked < puzzle.games.length} onClick={lockIn}>
              Lock in picks
            </button>
            <p className="daily__fine">Picks are final once you lock in. Then each game plays out, about 20 seconds each.</p>
          </div>
        </>
      )}

      {stage === "reveal" && record && (
        <DailyReveal
          games={puzzle.games}
          picks={record.picks}
          onDone={() => {
            setPlayed(true);
            setStage("done");
          }}
        />
      )}

      {stage === "done" && record && (
        <DailyResults
          puzzle={puzzle}
          record={record}
          stats={stats}
          saved={saved}
          crowd={crowd}
          focusOnMount={played}
          onWatchAgain={() => setStage("reveal")}
          onNextPuzzle={onNextPuzzle}
        />
      )}
    </div>
  );
}

function DailyHeader({ n, date }: { n?: number; date?: string }) {
  return (
    <header className="daily__header">
      <h1>
        Daily Three{n !== undefined && <span className="daily__number"> #{n}</span>}
      </h1>
      {date && <p className="daily__date">{longDate(date)}</p>}
      <p className="daily__lede">
        Three cross-era matchups, the same for everyone today. Pick a winner in each and lock in, then watch each one
        play out as a simulated game. <Link to="/about">How the model works</Link>
      </p>
    </header>
  );
}

/** "Saturday, October 10" for a YYYY-MM-DD puzzle date. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
