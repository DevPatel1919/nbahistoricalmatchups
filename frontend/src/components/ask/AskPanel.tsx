import { useEffect, useRef, useState, type FormEvent } from "react";
import { AskError, askCourt, askErrorMessage, splitCitations, type AskDone, type AskRequest, type AskSource, type Suggested } from "../../lib/askApi";

type Pair = { a: string; b: string };

const CHIPS: { kind: Suggested; label: string }[] = [
  { kind: "why", label: "Why this pick?" },
  { kind: "defence", label: "Who had the better defence?" },
  { kind: "limits", label: "What does the simulator leave out?" },
];

const MAX_QUESTION = 300;

/** A source's text without the lines that only repeat its title (chunks open with it). */
function withoutTitle(source: AskSource): string {
  const lines = source.text.split("\n");
  const title = source.title.replace(/\.$/, "");
  while (lines.length > 1 && lines[0].replace(/\.$/, "").startsWith(title)) lines.shift();
  return lines.join("\n");
}

/** The question box: on a matchup page with suggested questions, on /ask without them. */
export default function AskPanel({ pair }: { pair?: Pair }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<AskSource[]>([]);
  const [done, setDone] = useState<AskDone | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  // A question still on its way is dropped. ResultPage keys the panel by matchup, so a new one starts clean.
  useEffect(() => () => inFlight.current?.abort(), []);

  const run = async (body: AskRequest) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setBusy(true);
    setAnswer("");
    setSources([]);
    setDone(null);
    setFailure(null);
    setOpened(null);
    try {
      await askCourt(
        body,
        {
          onMeta: (meta) => setSources(meta.sources),
          onText: (text) => setAnswer((current) => current + text),
          onDone: setDone,
        },
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      setAnswer("");
      setSources([]);
      setFailure(askErrorMessage(error instanceof AskError ? error.code : "internal"));
    }
    if (inFlight.current === controller) setBusy(false);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    void run(pair ? { question: text, context: pair } : { question: text });
  };

  const openedSource = sources.find((s) => s.label === opened);

  return (
    <section className="ask" aria-labelledby="ask-heading">
      <h2 id="ask-heading" className="ask__heading">
        Ask the Court
      </h2>

      {pair && (
        <div className="ask__chips">
          {CHIPS.map((chip) => (
            <button key={chip.kind} type="button" className="btn btn--small" disabled={busy} onClick={() => void run({ context: pair, suggested: chip.kind })}>
              {chip.label}
            </button>
          ))}
        </div>
      )}

      <form className="ask__form" onSubmit={submit}>
        <label htmlFor="ask-question" className="ask__label">
          {pair ? "Or ask your own question about this matchup" : "Ask about any team-season, era, or how the simulator works"}
        </label>
        <div className="ask__row">
          <input
            id="ask-question"
            className="ask__input"
            type="text"
            value={question}
            maxLength={MAX_QUESTION}
            placeholder={pair ? "How sure is the simulator here?" : "Who had the best defence of the 1990s?"}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button type="submit" className="btn btn--primary" disabled={busy || !question.trim()}>
            Ask
          </button>
        </div>
      </form>

      <div className="ask__result" aria-live="polite">
        {busy && !answer && (
          <p className="ask__status">
            <span className="loading-dot" aria-hidden="true" /> {sources.length ? "Checking the numbers" : "Looking it up"}&hellip;
          </p>
        )}
        {failure && <p className="ask__failure">{failure}</p>}
        {answer && (
          <p className="ask__answer">
            {splitCitations(answer).map((part, i) =>
              "text" in part ? (
                <span key={i}>{part.text}</span>
              ) : (
                <span key={i} className="ask__cites">
                  {part.labels.map((label) => {
                    const index = sources.findIndex((s) => s.label === label);
                    if (index < 0) return null;
                    return (
                      <button
                        key={label}
                        type="button"
                        className="ask__cite"
                        aria-expanded={opened === label}
                        aria-label={"Source " + (index + 1) + ": " + sources[index].title}
                        onClick={() => setOpened(opened === label ? null : label)}
                      >
                        {index + 1}
                      </button>
                    );
                  })}
                </span>
              ),
            )}
          </p>
        )}
        {openedSource && (
          <div className="ask__source">
            <p className="ask__source-title">{openedSource.title}</p>
            <p className="ask__source-text">{withoutTitle(openedSource)}</p>
          </div>
        )}
        {done && !done.grounded && <p className="ask__note">Some details were removed because they couldn't be checked against the site's data.</p>}
      </div>

      <p className="ask__disclaimer">
        {done?.fallback
          ? "Built directly from the site's data. An estimate for a matchup that never happened, not betting advice."
          : "Answers come from a language model and are checked against the site's data, but they can still be wrong. Not betting advice."}
      </p>
    </section>
  );
}
