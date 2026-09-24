import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import DuelReveal from "../components/duel/DuelReveal";
import PuzzleCard from "../components/duel/PuzzleCard";
import type { DuelResult, IssuedSet, Pick } from "../duel";
import { track } from "../lib/analytics";
import { DUEL_API, DuelApiError, describeDuelError, fetchDuel, submitPicks } from "../lib/duelApi";
import { CONFIDENCE_LABELS, teamLabel } from "../lib/duelFormat";
import { clearDraft, loadDraft, saveDraft, type Draft } from "../lib/duelStorage";
import DuelUnavailable from "../components/duel/DuelUnavailable";
import { beginDuel } from "../lib/duelStart";

type View =
  | { kind: "loading" }
  | { kind: "open"; set: IssuedSet }
  | { kind: "revealed"; result: DuelResult; set: IssuedSet | null }
  | { kind: "expired" }
  | { kind: "error"; message: string };

function completedPicks(set: IssuedSet, draft: Draft): Pick[] | null {
  const picks: Pick[] = [];
  for (const p of set.puzzles) {
    const d = draft.picks[p.puzzleId];
    if (!d?.side || !d.confidence) return null;
    picks.push({ puzzleId: p.puzzleId, side: d.side, confidence: d.confidence });
  }
  return picks;
}

function OpenSet({ set, onRevealed }: { set: IssuedSet; onRevealed: (r: DuelResult) => void }) {
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
      const result = await submitPicks(set.duelId, set.setToken, picks, draft.idempotencyKey);
      clearDraft(set.duelId);
      track({
        name: "duel_completed",
        mode: result.mode,
        drawKind: set.draw.kind,
        outcome: !result.opponent
          ? "solo"
          : result.opponent.outcome === "you"
            ? "win"
            : result.opponent.outcome === "opponent"
              ? "loss"
              : "draw",
        beatModel: result.you.total > result.model.total,
      });
      onRevealed(result);
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
            <span className="duel-play__disclosure">{set.opponent.disclosure}</span>
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
          <p className="duel__fine">Once you lock in, picks can't change and the results are revealed.</p>
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
        if (!live) return;
        const next: View =
          state.state === "open"
            ? { kind: "open", set: state.set }
            : state.state === "revealed"
              ? { kind: "revealed", result: state.result, set: null }
              : { kind: "expired" };
        setFetched({ duelId, view: next });
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
            {view.kind === "expired" ? describeDuelError(new DuelApiError("set_expired", 403)) : view.message}
          </p>
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
          onRevealed={(result) => {
            setRevealed({ duelId, view: { kind: "revealed", result, set: view.set } });
            // History state survives a reload; drop the pre-lock set so a reload fetches the result.
            navigate(location.pathname, { replace: true, state: null });
          }}
        />
      );
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
