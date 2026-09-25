import type { DuelResult, RevealedPick } from "../../duel";
import { CONFIDENCE_LABELS, formatPercent, formatPoints, matchNote, resultHeadline, teamLabel } from "../../lib/duelFormat";

type Props = { result: DuelResult };

function PickLine({ who, pick, name, note }: { who: string; pick: RevealedPick; name: string; note: string }) {
  return (
    <li className={"reveal-pick" + (pick.correct ? " reveal-pick--right" : " reveal-pick--wrong")}>
      <span className="reveal-pick__who">{who}</span>
      <span className="reveal-pick__what">
        {name} · {note}
      </span>
      <span className="reveal-pick__points scoreboard">{formatPoints(pick.points)}</span>
      <span className="visually-hidden">{pick.correct ? "(right)" : "(wrong)"}</span>
    </li>
  );
}

export default function DuelReveal({ result }: Props) {
  const { you, model, opponent, puzzles } = result;
  const anyInSample = puzzles.some((p) => p.modelInSample);
  const note = matchNote(result.mode, result.match);

  return (
    <section className="reveal" aria-labelledby="reveal-heading">
      <h1 id="reveal-heading" className="reveal__headline">
        {resultHeadline(result)}
      </h1>

      <dl className="reveal__scores">
        <div className="reveal__score">
          <dt>You</dt>
          <dd className="scoreboard">{formatPoints(you.total)}</dd>
        </div>
        {opponent && (
          <div className="reveal__score">
            <dt>{opponent.name}</dt>
            <dd className="scoreboard">{formatPoints(opponent.total)}</dd>
          </div>
        )}
        <div className="reveal__score reveal__score--benchmark">
          <dt>{model.label} (benchmark)</dt>
          <dd className="scoreboard">{formatPoints(model.total)}</dd>
        </div>
      </dl>

      {note && (
        <p className="reveal__match" data-testid="match-note">
          {note}
        </p>
      )}

      {opponent?.kind === "bot" && (
        <p className="reveal__disclosure" data-testid="bot-disclosure">
          <strong>{opponent.name}:</strong> {opponent.disclosure} It is told the results and plays near your
          recent accuracy. Its score never counts toward any rating.
          {opponent.decidedBy === "best-correct-call" && " Totals were level, so the higher-scoring correct call decided it."}
        </p>
      )}
      {opponent?.kind === "player" && opponent.decidedBy === "best-correct-call" && (
        <p className="reveal__fine">Totals were level, so the higher-scoring correct call decided it.</p>
      )}

      <p className="reveal__benchmark" data-testid="model-benchmark">
        <strong>{model.label}:</strong> a fixed benchmark scored the same way, using its own win probability. It
        sees only what was known before tip-off. It was trained on games through {model.trainedThroughSeason}
        {anyInSample
          ? ", so for games up to then it has seen the results during training and its score there flatters it a little."
          : "."}
      </p>

      <ol className="reveal__games">
        {puzzles.map((p, i) => {
          const winner = p.view[p.actualWinner];
          const mine = you.picks[i];
          const theirs = model.picks[i];
          const theirPick = opponent?.picks?.[i];
          return (
            <li key={p.puzzleId} className="reveal-game">
              <h2 className="reveal-game__title">
                {teamLabel(p.view.away)} at {teamLabel(p.view.home)}
              </h2>
              <p className="reveal-game__result">{winner.name} won.</p>
              <ul className="reveal-game__picks">
                <PickLine
                  who="You"
                  pick={mine}
                  name={p.view[mine.side].name}
                  note={mine.confidence ? CONFIDENCE_LABELS[mine.confidence] : ""}
                />
                <PickLine who="Model" pick={theirs} name={p.view[theirs.side].name} note={formatPercent(theirs.probability)} />
                {theirPick && opponent && (
                  <PickLine
                    who={opponent.name}
                    pick={theirPick}
                    name={p.view[theirPick.side].name}
                    note={theirPick.confidence ? CONFIDENCE_LABELS[theirPick.confidence] : ""}
                  />
                )}
              </ul>
            </li>
          );
        })}
      </ol>

      <p className="reveal__fine">
        Scoring rewards honest confidence: a Lock only pays when you are right about nine times in ten. One
        five-game set is a small sample, so a single result says little about skill.
      </p>
    </section>
  );
}
