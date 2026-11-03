import { useEffect } from "react";
import AskPanel from "../components/ask/AskPanel";

/** /ask: the question box with no matchup behind it (F13). */
export default function AskPage() {
  useEffect(() => {
    document.title = "Ask the Court | Court of All Time";
  }, []);

  return (
    <>
      <div className="matchup-header">
        <a href="/">&larr; Pick a matchup</a>
      </div>
      <p className="ask__intro">
        Questions about NBA team-seasons from 1985&ndash;86 on, and about how the simulator works. Answers cite the site's data.
      </p>
      <AskPanel />
    </>
  );
}
