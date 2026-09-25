import { useEffect, useState } from "react";
import { BOT_DISPLAY_NAME, type DuelState, type WaitingView } from "../../duel";
import { track } from "../../lib/analytics";
import { DuelApiError, describeDuelError, fetchDuel, stopWaiting } from "../../lib/duelApi";
import { formatTimeLeft } from "../../lib/duelFormat";

/** How often a waiting seat checks whether its match has resolved. */
const POLL_MS = 20_000;

type Props = { waiting: WaitingView; onSettled: (state: DuelState) => void };

function InviteLink({ path }: { path: string }) {
  const url = window.location.origin + path;
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator.share === "function";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      track({ name: "duel_invite_shared", shareMethod: "copy" });
    } catch {
      setCopied(false);
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: "Court of All Time duel", text: "Call the same five real games I just did.", url });
      track({ name: "duel_invite_shared", shareMethod: "native" });
    } catch {
      // Dismissed or unsupported: the link is still on screen to copy.
    }
  };

  return (
    <div className="duel-invite">
      <label className="duel-invite__label" htmlFor="duel-invite-url">
        Invite link
      </label>
      <input id="duel-invite-url" className="duel-invite__url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
      <div className="duel-invite__actions">
        <button type="button" className="btn btn--primary" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy link"}
        </button>
        {canShare && (
          <button type="button" className="btn" onClick={() => void share()}>
            Share
          </button>
        )}
      </div>
      <p className="duel__fine" aria-live="polite">
        {copied ? "Link copied. It works once, for one friend." : "The link works once, for one friend."}
      </p>
    </div>
  );
}

export default function DuelWaiting({ waiting, onSettled }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      fetchDuel(waiting.duelId)
        .then((state) => {
          if (live && state.state !== "waiting") onSettled(state);
        })
        .catch(() => {
          // A missed poll is retried on the next tick.
        });
    };
    const timer = window.setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [waiting.duelId, onSettled]);

  const stop = async () => {
    setBusy(true);
    setError(null);
    try {
      onSettled(await stopWaiting(waiting.duelId));
    } catch (e) {
      setError(describeDuelError(e));
      track({ name: "app_error", surface: "duel-stop-waiting", code: e instanceof DuelApiError ? e.code : "unknown" });
      setBusy(false);
    }
  };

  const ranked = waiting.mode === "ranked";
  const left = formatTimeLeft(waiting.openUntil, now);
  const heading = waiting.opponent
    ? waiting.opponent.name + " is playing your set"
    : ranked
      ? "Finding a ranked opponent"
      : "Send this set to a friend";

  return (
    <section className="duel duel-waiting" aria-labelledby="waiting-heading">
      <p className="challenge__kicker">{ranked ? "Ranked duel" : "Friend duel"}</p>
      <h1 id="waiting-heading">{heading}</h1>
      <p className="duel__lede" role="status">
        Your picks are locked in.{" "}
        {waiting.opponent
          ? "They get the same five games and can't see your picks. Results appear here once they lock in, within 20 minutes."
          : ranked
            ? "The next ranked player near your rating gets the same five games. Neither of you sees the other's picks or any result until you have both locked in."
            : "Your friend gets the same five games. Neither of you sees the other's picks or any result until you have both locked in."}
      </p>

      {waiting.invitePath && !waiting.opponent && <InviteLink path={waiting.invitePath} />}

      {!waiting.opponent && (
        <p className="duel__fine">
          {ranked
            ? "Matchmaking stays open for " + left + ". If nobody joins, your set is scored against the " + BOT_DISPLAY_NAME + " and doesn't count toward your rating."
            : "The invite works for " + left + ". If nobody takes it, your set is scored on its own."}{" "}
          This page checks for results on its own. You can also leave and come back to this duel later.
        </p>
      )}

      {waiting.canStopWaiting && (
        <p className="picker-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void stop()}>
            {ranked ? "Play the " + BOT_DISPLAY_NAME + " now (unrated)" : "Stop waiting and see my results"}
          </button>
        </p>
      )}
      {error && (
        <p className="duel__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
