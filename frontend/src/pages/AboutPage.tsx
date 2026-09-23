import { useEffect, useState } from "react";
import type { IndexData } from "../types";
import { loadIndex } from "../lib/dataLoader";

// The model description and limitations below restate the active release's
// manifest (models/releases/<version>/manifest.json). When a new release is
// promoted, re-read its `description` and `limitations` and update this copy.

export default function AboutPage() {
  const [index, setIndex] = useState<IndexData | null>(null);

  useEffect(() => {
    // The page reads fine without the release tag, so a failed load is ignored.
    loadIndex()
      .then(setIndex)
      .catch(() => {});
  }, []);

  return (
    <article className="prose">
      <h1>About Court of All Time</h1>
      <p>
        Court of All Time answers one question: take any two NBA teams from any two seasons since 1998, put them on a
        neutral court, and see who the model thinks wins. It's a fan toy for settling arguments. Results are model
        estimates for entertainment, not a forecast and not betting advice, and this is not an official NBA product.
      </p>

      <h2>How it works</h2>
      <p>
        Each team-season is represented by its full-season averages: its regular-season statistics plus, when it made
        a playoff run, its playoff performance in that same season. A logistic regression model compares the two
        profiles and estimates a win probability. A separate model gives a rough projected point margin.
      </p>
      <p>
        Because home court is meaningless when comparing teams from different eras and arenas, every matchup is
        played at a neutral site: we run the matchup both ways (each team as the nominal home side) and average the
        two results, so a matchup gives the same answer regardless of which team you look it up from.
      </p>
      <p>
        Best-of-7 series odds are derived directly from the single-game probability, treating each game as an
        independent trial at that same probability &mdash; it does not model momentum, adjustments, or injuries
        across a series.
      </p>

      <h2>What it doesn't do</h2>
      <ul>
        <li>
          Cross-era matchups never happened, so these results can't be checked against real games. We don't publish
          an accuracy figure for this model.
        </li>
        <li>
          It ignores rule changes, pace-of-play differences, and equipment/training differences across eras. A 1998
          team and a 2023 team are compared purely on their statistical profile, not on how basketball itself has
          changed.
        </li>
        <li>
          The model was trained on playoff games only, so a matchup involving a team that missed the playoffs is an
          extrapolation. You'll see a "missed the playoffs" note on those teams for that reason.
        </li>
        <li>
          The point margin is approximate: on real games it was typically off by about 10 points, which is why it's
          shown rounded.
        </li>
        <li>
          Team strength comes from full-season averages, not rosters, injuries, or rest.
        </li>
        <li>We don't explain why the model favors one team over another beyond the stats shown on the result page.</li>
      </ul>

      <h2>Data &amp; refresh</h2>
      <p>
        All {index ? `${index.teams.length} ` : ""}team-seasons and every matchup between them are precomputed ahead of
        time from public box-score data and served as static files &mdash; there's no live server or database behind
        this site. The data is refreshed manually, once a year, after the NBA Finals.
      </p>
      {index && (
        <p className="about-release">
          Model release <code>{index.release.version}</code>, data generated {index.generated}.
        </p>
      )}

      <h2>Unofficial</h2>
      <p>
        Court of All Time is not affiliated with, endorsed by, or connected to the NBA or any NBA team. Team names
        are used descriptively to identify historical team-seasons; no team or league logos appear anywhere on this
        site.
      </p>
    </article>
  );
}
