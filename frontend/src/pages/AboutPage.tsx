import { useEffect, useState } from "react";
import type { IndexData } from "../types";
import { loadIndex } from "../lib/dataLoader";
import AnalyticsOptOut from "../components/AnalyticsOptOut";
import { DAILY_THREE } from "../lib/dailyFlag";
import { DUEL_API } from "../lib/duelApi";

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
        Court of All Time answers one question: take any two NBA teams from any two seasons since 1985&ndash;86, put them on a
        neutral court, and see who the model thinks wins. It's a fan toy for settling arguments. Results are model
        estimates for entertainment, not a forecast and not betting advice, and this is not an official NBA product.
      </p>

      <h2>How it works</h2>
      <p>
        Each team-season is represented by its full regular season, measured against its own season&rsquo;s league.
        Scoring, shooting and pace changed a lot between eras: the league&rsquo;s offensive rating was about 107 in 1990
        and about 115 today. Raw numbers would tilt every matchup toward one era. So each team is judged by how far it
        stood above or below the average team of its own season.
      </p>
      <p>
        A logistic regression model compares the two teams and estimates a win probability. In practice it reads two
        numbers per team: net rating and win percentage, each against its own league. The other stats it was offered
        (shooting, pace, turnovers, assists) carry no weight, and a deep playoff run doesn&rsquo;t raise a team&rsquo;s
        rating. A separate model gives a rough projected point margin.
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
          Measuring each team against its own league removes the drift in scoring and pace, not every difference
          between eras. A 1990 team and a 2023 team are compared on how dominant each was in its own season, not on how
          basketball itself has changed: rules, styles, and equipment and training are left out. Few threes were taken
          before the mid-1990s, and the three-point line was moved in for 1994&ndash;95 to 1996&ndash;97.
        </li>
        <li>
          The NBA&rsquo;s own advanced numbers start in 1996&ndash;97. For older seasons, possessions, ratings, pace and
          shooting are computed from the box score. Rebound percentages can&rsquo;t be rebuilt that way, so the model
          doesn&rsquo;t use them for any season.
        </li>
        <li>
          A team that missed the playoffs is judged the same way as one that made them: on its regular season. The
          &ldquo;missed the playoffs&rdquo; note is there for context.
        </li>
        <li>
          The point margin is approximate: on real games it was typically off by about 11 points, which is why it's
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
        the matchups or tournaments.{DUEL_API ? " Duel mode is the one part that runs on a server (see below)." : ""} The
        data is refreshed manually, once a year, after the NBA Finals.
      </p>
      {index && (
        <p className="about-release">
          Model release <code>{index.release.version}</code>, data generated {index.generated}.
        </p>
      )}

      <h2>Privacy &amp; analytics</h2>
      <p>
        We count page views with Cloudflare Web Analytics and, when enabled, a handful of anonymous events (a matchup
        finished, a bracket revealed) with a cookie-free analytics service. No names, emails,
        or bracket picks are ever sent with them. To tell a new visit from a return one, this browser remembers the
        date of its first visit locally; only the week of that date is reported, never an identifier.
      </p>
      <AnalyticsOptOut />
      {DUEL_API && (
        <>
          <h3>Duel mode</h3>
          <p>
            Duel mode keeps what it needs on its server. As a guest, that is a random id held in this browser and the
            sets you play: your picks, their scores, and how long you took. If you sign in, it also keeps a one-way hash
            of your email address (never the address), your display name, and your rating and its history. For ranked
            sets it keeps timing and accuracy summaries, which are how cheating is detected. Rate limits and the check
            for many accounts from one network use a scrambled form of your network address that is deleted within two
            days. Sign-in links and sessions are deleted a day after they stop working, and a guest id that never played
            is deleted after 30 days.
          </p>
          <p>
            You can delete your account from the account page at any time. That removes the account and everything
            above that belongs to it. Players you&apos;ve faced keep their own results, with your name replaced.
          </p>
        </>
      )}
      {DAILY_THREE && DUEL_API && (
        <>
          <h3>Daily Three</h3>
          <p>
            When you lock in your Daily Three picks, this browser sends them, with your score for the day, to the same
            server so everyone can see how the crowd picked. They go with a random id this browser made for Daily Three
            and nothing else: no name, account, or guest id. The id only stops a browser from counting twice in a day.
            Scores are self-reported and not checked, so the crowd lines are a rough guide. The rate limit uses a
            scrambled form of your network address that is deleted within two hours.
          </p>
        </>
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
