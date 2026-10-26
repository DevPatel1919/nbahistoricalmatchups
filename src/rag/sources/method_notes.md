# Ask the Court: method notes

Curated source for the corpus's `method` chunks (F13). Each `## ` section becomes one chunk, and the heading
becomes its title. Keep each section to about 250 words, and keep every fact traceable to the reports or
the release named at the end of the section.

Never add: a model accuracy figure (the owner chose not to publish one), the old 71.04% claim, anything about
wagering or upcoming real games, or anything derived from Basketball-Reference.

## What the simulator does

Court of All Time compares two NBA team-seasons from any era, 1985–86 onward, and estimates how a single game
between them would go on a neutral court. It gives a win chance for each team and a rough point margin. These
matchups never happened, so the result is a model estimate for entertainment, not a forecast. The estimate comes
from each team's full regular season: how well it scored and defended, and how often it won, each judged against
the league it played in. (Source: the hist-v2 release manifest.)

## Why teams are compared with their own league

Raw numbers drift a long way between eras. League offensive rating was about 105 to 108 points per 100
possessions in the late 1980s and 1990s, and about 115 in the 2020s. True shooting rose from about .530 to
.580, and three-point attempts went from a small share of shots to about two in five. A model that read raw
numbers would judge an older team on a scale that moved, and it would tilt evenly matched cross-era games
toward modern teams. So the simulator reads each stat as a z-score: how many standard deviations a team was
above or below the average of its own season's league. A team that was dominant for its time scores as
dominant, whatever the era. (Source: reports/older_seasons_backtest.md.)

## What a z-score means here

A z-score is the number of standard deviations a team's figure sits from the average of all teams in the same
season. A net rating z of +2.0 means the team was two standard deviations better than an average team that
season. Zero is exactly average. For defensive rating, opponent
shooting and turnovers, a lower raw number is better, so the cards say "better" or "worse" rather than relying on
the sign.

## Neutral court

The underlying model was trained on real games, which have a home team. To make a fair cross-era matchup, the
site scores each pairing twice, once with each team at home, and averages the two win chances. Neither team gets
home-court advantage, and the two teams' chances always add up to 100%. The margin is neutralised the same way.
(Source: scripts/export_static_site_data.py.)

## What the simulator does not account for

The simulator sees full-season team averages only. It does not know about rosters, individual players,
injuries, rest, trades during the season, playoff experience, coaching, rule changes beyond what shows up in
the league averages, or how styles would match up. A team that changed a lot during the season is represented
by its season-long average. It cannot say what would happen with different players, and it does not model
individual stars.

## Seasons before 1996–97

The NBA's own advanced stats, such as offensive and defensive rating and pace, start in 1996–97. For the
seasons from 1985–86 to 1995–96, the site computes them from the basic box score with the standard formulas.
Where both exist, the formulas match the NBA's numbers closely: net rating is off by about 0.1 points per 100
possessions on average. Possessions are estimated with the usual formula, scaled to match the NBA's own counts.
Rebound percentages cannot be rebuilt reliably, so they are not used for any season. (Source:
reports/older_seasons_backtest.md.)

## Season labels

A season is named by both of its years, such as 1995–96, and keyed by the year it ended: the 1995–96 Chicago
Bulls are `1996-bulls`, and "the '96 Bulls" means the same team. Team names are the ones the franchise used that
season: the Seattle SuperSonics until 2007–08, the Washington Bullets until 1996–97, the New Jersey Nets until
2011–12, and so on. The 2019–20 Finals were played in October 2020 in the Orlando bubble, and they belong to the
2019–20 season.

## Short seasons

Four seasons were shorter than 82 games: 1998–99 (50 games, after a lockout), 2011–12 (66 games, after a
lockout), 2019–20 (stopped in March 2020 and finished in the bubble, so teams played between 64 and 75
games), and 2020–21 (72 games). Comparisons use win percentage, not raw wins, so those teams are not penalised.
A short season is also noisier: a team's averages rest on fewer games.

## The point margin

Next to the win chance, the site shows a rough point margin from a separate ridge regression. It is
approximate: on real games its typical error was about 11 points. It should be read as "about a two-possession
game" or "a comfortable win", never as an exact score. The win chance and the margin come from different
models, so they can disagree slightly. (Source: the hist-v2 release manifest.)

## Series chances

For a best-of-seven series, the site treats every game as an independent game at the same neutral-court win
chance and adds up the ways a team can win four games first. A small edge in one game becomes a bigger edge
over a series: a 60% single-game chance becomes about 71% over seven games. It ignores home court, adjustments
between games, and injuries. (Source: frontend/src/lib/series.ts.)

## Why the site publishes no accuracy figure

A cross-era matchup never happened, so there is no real result to check it against. The model was checked on
real games between teams of the same season, but that number would not tell a visitor how right a 1996 versus
2017 estimate is, and it invites the wrong comparison. The owner chose not to publish an accuracy figure for
this release. An older version of the site once quoted a number that turned out to be inflated by a data
error, and it must not be repeated. (Source: CONTRIBUTING.md, hist-v2 manifest.)

## Where the data comes from

Team box scores and standings come from a public dataset of historical NBA games and box scores, published on
Kaggle ("Historical NBA Data and Player Box Scores"). The site builds each team-season's regular-season and
playoff profile from it. Champions are taken from the last playoff game of each season. Nothing on the site uses
league or team logos or player images, and the site is not affiliated with the NBA or any team.
