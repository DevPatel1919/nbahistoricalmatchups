import { useEffect, useRef, useState } from "react";
import { msUntilNextPuzzle } from "../../daily/day";
import { buildShareText } from "../../daily/share";
import { dayScore, type DailyStats, type DayRecord } from "../../daily/stats";
import type { DailyCrowdStats } from "../../daily/types";
import { crowdPerfectLine, crowdPickLine, crowdPlayers } from "../../lib/dailyCrowd";
import { countdownWords, formatAccuracy, formatCountdown, seasonTeamName } from "../../lib/dailyFormat";
import { shareTeams, type Puzzle } from "../../lib/dailyPuzzle";
import DailyFinal from "./DailyFinal";

interface Props {
  puzzle: Puzzle;
  record: DayRecord;
  stats: DailyStats;
  /** False when the browser would not save the day. */
  saved: boolean;
  /** Everyone's picks so far (Session 4), or null to show no crowd lines: no API, an error, or no answer yet. */
  crowd: DailyCrowdStats | null;
  /** Move focus to the score (after lock-in or the reveal), not on a plain page load. */
  focusOnMount: boolean;
  onWatchAgain: () => void;
  /** Local midnight passed: the next puzzle is open. */
  onNextPuzzle: () => void;
}

export default function DailyResults({ puzzle, record, stats, saved, crowd, focusOnMount, onWatchAgain, onNextPuzzle }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const score = dayScore(record);
  const total = puzzle.games.length;

  useEffect(() => {
    // Keyboard and screen-reader users land on the score after the reveal.
    if (focusOnMount) headingRef.current?.focus();
  }, [focusOnMount]);

  const shareText = buildShareText({
    n: puzzle.n,
    games: puzzle.games.map((g) => g.game),
    teams: shareTeams(puzzle),
    record,
    finals: puzzle.games.map((g) => g.sim.final),
    playStreak: stats.playStreak.current,
    hotStreak: stats.hotStreak.current,
  });

  return (
    <section className="daily-results" aria-labelledby="daily-results-heading">
      <div className="daily-results__summary">
        <h2 id="daily-results-heading" ref={headingRef} tabIndex={-1}>
          You went <span className="scoreboard daily-results__score">{score}/{total}</span>
        </h2>
        <p className="daily-results__streaks">
          <span>
            <span aria-hidden="true">🔥</span> Play streak <strong className="tabular">{stats.playStreak.current}</strong>
          </span>
          <span>
            <span aria-hidden="true">🎯</span> Hot streak <strong className="tabular">{stats.hotStreak.current}</strong>
          </span>
        </p>
        <div className="picker-actions">
          <ShareButton text={shareText} />
          <button type="button" className="btn" onClick={onWatchAgain}>
            Watch again
          </button>
        </div>
        {!saved && (
          <p className="daily__note">
            This browser isn't saving Daily Three, so today's picks and your streaks last only while this page is open.
          </p>
        )}
      </div>

      <div className="daily-results__finals">
        {puzzle.games.map((g) => (
          <DailyFinal key={g.index} puzzleGame={g} pick={record.picks[g.index]} />
        ))}
      </div>

      {crowd && <CrowdPanel puzzle={puzzle} crowd={crowd} />}
      <StatsPanel stats={stats} today={score} />
      <Countdown onNextPuzzle={onNextPuzzle} />
    </section>
  );
}

function ShareButton({ text }: { text: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  const handleShare = async () => {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch (e) {
      // A dismissed share sheet is not a failure.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setStatus("failed");
    }
  };

  return (
    <>
      <button type="button" className="btn btn--primary" onClick={handleShare}>
        Share
      </button>
      <span className="copy-feedback" role="status">
        {status === "copied" ? "Copied to the clipboard" : status === "failed" ? "Couldn't share or copy" : ""}
      </span>
    </>
  );
}

/** How everyone picked today. Only ever rendered after lock-in, so it is never a hint. */
function CrowdPanel({ puzzle, crowd }: { puzzle: Puzzle; crowd: DailyCrowdStats }) {
  return (
    <section className="daily-crowd" aria-labelledby="daily-crowd-heading">
      <h2 id="daily-crowd-heading">Today's crowd</h2>
      <p className="daily-crowd__players">{crowdPlayers(crowd.players)} so far.</p>
      <ul className="daily-crowd__lines">
        {puzzle.games.map((g) => (
          <li key={g.index}>
            <span className="daily-crowd__game">
              Game {g.index + 1}
              {g.game.featured && <span aria-hidden="true"> ⭐</span>}:
            </span>{" "}
            {crowdPickLine(crowd.picks[g.index], crowd.players, [seasonTeamName(g.teams[0]), seasonTeamName(g.teams[1])])}
          </li>
        ))}
        <li>{crowdPerfectLine(crowd)}</li>
      </ul>
      <p className="daily__fine">Each browser counts once a day. Scores are self-reported.</p>
    </section>
  );
}

function StatsPanel({ stats, today }: { stats: DailyStats; today: number }) {
  const most = Math.max(1, ...stats.distribution);
  return (
    <section className="daily-stats" aria-labelledby="daily-stats-heading">
      <h2 id="daily-stats-heading">Your stats</h2>
      <dl className="daily-stats__facts">
        <div>
          <dt>Played</dt>
          <dd className="scoreboard">{stats.played}</dd>
        </div>
        <div>
          <dt>Pick accuracy</dt>
          <dd className="scoreboard">{formatAccuracy(stats.accuracy)}</dd>
        </div>
        <div>
          <dt>Perfect days</dt>
          <dd className="scoreboard">{stats.perfectDays}</dd>
        </div>
        <div>
          <dt>
            <span aria-hidden="true">🔥</span> Best play streak
          </dt>
          <dd className="scoreboard">{stats.playStreak.best}</dd>
        </div>
        <div>
          <dt>
            <span aria-hidden="true">🎯</span> Best hot streak
          </dt>
          <dd className="scoreboard">{stats.hotStreak.best}</dd>
        </div>
      </dl>
      <h3 className="daily-stats__dist-heading">Days by score</h3>
      <ol className="daily-stats__dist">
        {stats.distribution.map((count, score) => (
          <li key={score} className={`daily-stats__bar-row${score === today ? " is-today" : ""}`}>
            <span className="daily-stats__bar-label tabular">{score}/3</span>
            <span className="daily-stats__bar-track">
              <span className="daily-stats__bar" style={{ width: `${Math.max(8, (count / most) * 100)}%` }}>
                <span className="tabular" aria-hidden="true">
                  {count}
                </span>
              </span>
            </span>
            <span className="visually-hidden">
              {count} {count === 1 ? "day" : "days"}
              {score === today ? ", including today" : ""}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Countdown({ onNextPuzzle }: { onNextPuzzle: () => void }) {
  const [ms, setMs] = useState(() => msUntilNextPuzzle(new Date()));
  const nextRef = useRef(onNextPuzzle);
  useEffect(() => {
    nextRef.current = onNextPuzzle;
  });

  useEffect(() => {
    let prev = msUntilNextPuzzle(new Date());
    const timer = window.setInterval(() => {
      const left = msUntilNextPuzzle(new Date());
      setMs(left);
      // msUntilNextPuzzle never reaches 0: just after midnight it counts a whole new day.
      if (left > prev) nextRef.current();
      prev = left;
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <p className="daily-countdown">
      Next puzzle in{" "}
      <span className="scoreboard daily-countdown__time" role="timer" aria-label={countdownWords(ms)}>
        {formatCountdown(ms)}
      </span>
    </p>
  );
}
