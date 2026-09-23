export default function AboutPage() {
  return (
    <article className="prose">
      <h1>About Court of All Time</h1>
      <p>
        Court of All Time answers one question: take any two NBA teams from any two seasons since 1998, put them on a
        neutral court, and see who the model thinks wins. It's a fan toy for settling arguments, not a betting tool
        and not an official NBA product.
      </p>

      <h2>How it works</h2>
      <p>
        Every matchup comes from a logistic regression model trained over full-season team statistics. Each team is
        represented by its complete regular-season record plus, when it made a playoff run, its playoff performance
        in that same season. The model compares the two team-seasons' stats and estimates a win probability and a
        projected point margin.
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
          It ignores rule changes, pace-of-play differences, and equipment/training differences across eras. A 1998
          team and a 2023 team are compared purely on their statistical profile, not on how basketball itself has
          changed.
        </li>
        <li>
          A team that didn't make the playoffs has its playoff stats filled with zeros, which the model reads as a
          weak playoff performance. You'll see a "missed the playoffs" note on those teams for that reason.
        </li>
        <li>We don't explain why the model favors one team over another beyond the stats shown on the result page.</li>
      </ul>

      <h2>Data &amp; refresh</h2>
      <p>
        All 835 team-seasons and every matchup between them are precomputed ahead of time from public box-score data
        and served as static files &mdash; there's no live server or database behind this site. The data is
        refreshed manually, once a year, after the NBA Finals.
      </p>

      <h2>Unofficial</h2>
      <p>
        Court of All Time is not affiliated with, endorsed by, or connected to the NBA or any NBA team. Team names
        are used descriptively to identify historical team-seasons; no team or league logos appear anywhere on this
        site.
      </p>
    </article>
  );
}
