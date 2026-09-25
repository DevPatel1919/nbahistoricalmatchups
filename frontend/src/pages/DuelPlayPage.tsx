import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import DuelReveal from "../components/duel/DuelReveal";
import DuelWaiting from "../components/duel/DuelWaiting";
import PuzzleCard from "../components/duel/PuzzleCard";
import type { DuelResult, DuelState, IssuedSet, MatchSummary, Pick, WaitingView } from "../duel";
import { track } from "../lib/analytics";
import { DUEL_API, DuelApiError, describeDuelError, fetchDuel, submitPicks } from "../lib/duelApi";
import { CONFIDENCE_LABELS, completionOutcome, formatRatingChange, teamLabel } from "../lib/duelFormat";
import { clearDraft, loadDraft, saveDraft, type Draft } from "../lib/duelStorage";
import DuelUnavailable from "../components/duel/DuelUnavailable";
import { beginDuel } from "../lib/duelStart";

type View =
  | { kind: "loading" }
  | { kind: "open"; set: IssuedSet }
  | { kind: "waiting"; waiting: WaitingView; set: IssuedSet | null }
  | { kind: "revealed"; result: DuelResult; set: IssuedSet | null }
  | { kind: "expired"; match: MatchSummary | null }
  | { kind: "error"; message: string };

function viewOf(state: DuelState, set: IssuedSet | null): View {
  switch (state.state) {
    case "open":
      return { kind: "open", set: state.set };
    case "waiting":
      return { kind: "waiting", waiting: state.waiting, set };
    case "revealed":
      return { kind: "revealed", result: state.result, set };
    case "expired":
      return { kind: "expired", match: state.match };
  }
}

function completedPicks(set: IssuedSet, draft: Draft): Pick[] | null {
  const picks: Pick[] = [];
  for (const p of set.puzzles) {
    const d = draft.picks[p.puzzleId];
    if (!d?.side || !d.confidence) return null;
    picks.push({ puzzleId: p.puzzleId, side: d.side, confidence: d.confidence });
  }
  return picks;
}

function OpenSet({ set, onLocked }: { set: IssuedSet; onLocked: (state: DuelState) => void }) {
  const ids = set.puzzles.map((p) => p.puzzleId);
  const [draft, setDraft] = useState<Draft>(() => loadDraft(set.duelId, ids));
  const [step, setStep] = useState(0); // 0..4 games, 5 = review
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    focusRef.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [step]);

  const total = set.puzzles.length;
  const picked = set.puzzles.filter((p) => draft.picks[p.puzzleId]?.side && draft.picks[p.puzzleId]?.confidence).length;
  const picks = completedPicks(set, draft);
  const current = set.puzzles[step];
  const currentDone = current && draft.picks[current.puzzleId]?.side && draft.picks[current.puzzleId]?.confidence;

  const update = (puzzleId: string, pick: Draft["picks"][string]) => {
    const next = { ...draft, picks: { ...draft.picks, [puzzleId]: pick } };
    setDraft(next);
    saveDraft(set.duelId, next);
  };

  const lockIn = async () => {
    if (!picks) return;
    setBusy(true);
    setError(null);
    try {
      const state = await submitPicks(set.duelId, set.setToken, picks, draft.idempotencyKey);
      clearDraft(set.duelId);
      if (state.state === "revealed") {
        track({ name: "duel_completed", mode: state.result.mode, drawKind: set.draw.kind, ...completionOutcome(state.result) });
      } else if (state.state === "waiting") {
        track({ name: "duel_waiting", mode: state.waiting.mode });
      }
      onLocked(state);
    } catch (e) {
      setError(describeDuelError(e));
      track({ name: "app_error", surface: "duel-submit", code: e instanceof DuelApiError ? e.code : "unknown" });
      setBusy(false);
    }
  };

  return (
    <div className="duel-play" ref={focusRef}>
      <div className="duel-play__bar">
        <p className="duel-play__progress" aria-live="polite">
          {picked} of {total} picked
        </p>
        {set.opponent && (
          <p className="duel-play__opponent">
            vs <strong>{set.opponent.name}</strong>
            {set.opponent.kind === "bot" && <span className="duel-play__disclosure">{set.opponent.disclosure}</span>}
          </p>
        )}
        {!set.opponent && (set.mode === "ranked" || set.mode === "friend") && (
          <p className="duel-play__opponent">
            {set.mode === "ranked" ? "Ranked: an opponent gets these same five games" : "Friend duel: your friend gets these same five games"}
          </p>
        )}
      </div>

      {current ? (
        <>
          <PuzzleCard
            puzzle={current}
            index={step}
            total={total}
            pick={draft.picks[current.puzzleId] ?? {}}
            onPick={(p) => update(current.puzzleId, p)}
          />
          <div className="duel-play__nav">
            <button type="button" className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>
              Previous
            </button>
            <button type="button" className="btn btn--primary" disabled={!currentDone} onClick={() => setStep(step + 1)}>
              {step === total - 1 ? "Review picks" : "Next game"}
            </button>
          </div>
        </>
      ) : (
        <section className="duel-review" aria-labelledby="review-heading">
          <h2 id="review-heading" tabIndex={-1}>
            Your picks
          </h2>
          <ol className="duel-review__list">
            {set.puzzles.map((p, i) => {
              const d = draft.picks[p.puzzleId];
              return (
                <li key={p.puzzleId}>
                  <span>
                    {teamLabel(p.away)} at {teamLabel(p.home)}:{" "}
                    <strong>
                      {d?.side ? p[d.side].name : "no pick"}
                      {d?.confidence ? ", " + CONFIDENCE_LABELS[d.confidence] : ""}
                    </strong>
                  </span>
                  <button type="button" className="btn duel-review__change" onClick={() => setStep(i)}>
                    Change<span className="visually-hidden"> game {i + 1}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="duel__fine">
            {set.mode === "ranked" || set.mode === "friend"
              ? "Once you lock in, picks can't change. Results appear when both players have locked in. Lock in within 20 minutes of starting, or the set expires" +
                (set.opponent ? " and counts as a forfeit." : ".")
              : "Once you lock in, picks can't change and the results are revealed."}
          </p>
          <button type="button" className="btn btn--primary" disabled={!picks || busy} onClick={() => void lockIn()}>
            {busy ? "Scoring…" : "Lock in picks"}
          </button>
          {error && (
            <p className="duel__error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

export default function DuelPlayPage() {
  const { duelId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  // A set handed over by "Start" opens without a round trip; a reload fetches it.
  const handedOver = (location.state as { set?: IssuedSet } | null)?.set;
  const handedOverSet = handedOver && handedOver.duelId === duelId ? handedOver : null;
  const [fetched, setFetched] = useState<{ duelId: string; view: View } | null>(null);
  const [revealed, setRevealed] = useState<{ duelId: string; view: View } | null>(null);
  const [again, setAgain] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  useEffect(() => {
    if (!DUEL_API || handedOverSet) return;
    let live = true;
    fetchDuel(duelId)
      .then((state) => {
        if (live) setFetched({ duelId, view: viewOf(state, null) });
      })
      .catch((e) => {
        if (!live) return;
        setFetched({ duelId, view: { kind: "error", message: describeDuelError(e) } });
        track({ name: "app_error", surface: "duel-load", code: e instanceof DuelApiError ? e.code : "unknown" });
      });
    return () => {
      live = false;
    };
  }, [duelId, handedOverSet]);

  const view: View =
    revealed?.duelId === duelId
      ? revealed.view
      : handedOverSet
        ? { kind: "open", set: handedOverSet }
        : fetched?.duelId === duelId
          ? fetched.view
          : { kind: "loading" };

  const settledSet = view.kind === "waiting" ? view.set : null;
  const onSettled = useCallback(
    (state: DuelState) => setRevealed({ duelId, view: viewOf(state, settledSet) }),
    [duelId, settledSet],
  );

  if (!DUEL_API) return <DuelUnavailable />;

  const playAgain = async (result: DuelResult, set: IssuedSet | null) => {
    setAgain({ busy: true, error: null });
    try {
      await beginDuel(result.mode, set?.draw ?? { kind: "random" }, navigate);
      setAgain({ busy: false, error: null });
    } catch (e) {
      setAgain({ busy: false, error: describeDuelError(e) });
    }
  };

  switch (view.kind) {
    case "loading":
      return (
        <p className="center-note">
          <span className="loading-dot" aria-hidden="true" /> Loading duel&hellip;
        </p>
      );
    case "error":
    case "expired":
      return (
        <section className="duel">
          <h1>Duel mode</h1>
          <p className="center-note" role="alert">
            {view.kind === "error"
              ? view.message
              : view.match?.settledBy === "forfeit"
                ? "You didn't lock in within 20 minutes, so this duel went to your opponent by forfeit."
                : describeDuelError(new DuelApiError("set_expired", 403))}
          </p>
          {view.kind === "expired" && view.match?.rating && (
            <p className="center-note">Your rating: {formatRatingChange(view.match.rating)}.</p>
          )}
          <p className="picker-actions">
            <Link className="btn btn--primary" to="/duel">
              Start a new set
            </Link>
          </p>
        </section>
      );
    case "open":
      return (
        <OpenSet
          key={view.set.duelId}
          set={view.set}
          onLocked={(state) => {
            setRevealed({ duelId, view: viewOf(state, view.set) });
            // History state survives a reload; drop the pre-lock set so a reload fetches the result.
            navigate(location.pathname, { replace: true, state: null });
          }}
        />
      );
    case "waiting":
      return <DuelWaiting waiting={view.waiting} onSettled={onSettled} />;
    case "revealed":
      return (
        <>
          <DuelReveal result={view.result} />
          <div className="picker-actions duel__again">
            <button
              type="button"
              className="btn btn--primary"
              disabled={again.busy}
              onClick={() => void playAgain(view.result, view.set)}
            >
              Play another set
            </button>
            <Link className="btn" to="/duel">
              Change opponent or era
            </Link>
          </div>
          {again.error && (
            <p className="duel__error" role="alert">
              {again.error}
            </p>
          )}
        </>
      );
  }
}
