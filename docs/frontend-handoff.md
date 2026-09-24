# Frontend handoff: Court of All Time

Build spec for the public website in front of the historical matchup simulator.
Written for a coding agent with repo access and no prior context. Read
`CONTRIBUTING.md`, `docs/product/HANDOFF.md`, and
`docs/product/features/F02-public-matchup-mvp.md` first.

## The product

**Court of All Time** answers one question: *take any two NBA teams from any two seasons since 1998 and play them on a neutral court, who wins?* It is a fan toy for settling arguments, not a betting tool.

- **835 team-seasons**, 1998–2026, 30 franchises.
- Each matchup shows a **winner, a win probability, a projected margin, best-of-7 series odds**, and a side-by-side stat comparison.
- Every result comes from the existing model, precomputed ahead of time. The site is static files: no server, no database, no API.

## Decisions already made

Settled with the owner. Do not silently revisit; raise it if one blocks you.

| # | Decision | Choice |
|---|---|---|
| 1 | Audience | Public fun site for fans |
| 2 | Model | The versioned historical-entertainment release approved by F01 |
| 3 | Home court | Always neutral, no toggle |
| 4 | Team names | The name used that season (2005 Seattle SuperSonics) |
| 5 | Serving | Precompute every matchup, host static files |
| 6 | Stack | React + TypeScript + Vite |
| 7 | Hosting | Cloudflare Pages |
| 8 | Name | Court of All Time (domain not bought yet; `*.pages.dev` is fine for launch) |
| 9 | URLs | `/1998-bulls-vs-2017-warriors`, canonical order, reverse redirects |
| 10 | Series odds | Each game independent at neutral win probability |
| 11 | Stat rows | Six: record, net rating, offensive rating, defensive rating, pace, true shooting % |
| 12 | Theme | Dark by default with a light toggle; independent basketball identity subject to F00 brand review |
| 13 | Analytics | Cloudflare Web Analytics |
| 14 | Data refresh | Manual, once a year after the Finals |
| 15 | Repo layout | `frontend/` folder in this repo |

**v1 scope:** matchup picker, result card, stat comparison, series odds, shareable URLs, random matchup button.
**v1.1:** a "greatest teams" ranking page, each team-season's average win probability against all others (the export already contains everything it needs).
**Out of scope:** an explanation of why the model picked a winner. The model leans mostly on playoff win percentage, so the breakdown would read strangely.

## Prerequisite: approve and verify one model release

Complete `docs/product/features/F01-model-release-integrity.md` before building
against the export. The historical-entertainment release must promote its model,
regressor, columns, metrics, schema, and version as one validated bundle. Do not
restore or replace artifacts individually and do not use file-by-file fallback.

After F01, the clean matchup smoke suite and `scripts/verify_static_export.py`
must pass. The release manifest, rather than whichever artifact happens to exist
in `models/production/` or `models/experiments/`, defines what the site serves.

## Architecture

```
data/processed/team_season_profiles_extended.csv
        |
        v
scripts/export_static_site_data.py        <- you write this
        |
        v
frontend/public/data/*.json               <- 835 team files + index + names/colors
        |
        v
frontend/ (React + TS + Vite)  ->  build  ->  Cloudflare Pages
```

Nothing runs at request time. A model or data change means rerunning the export and redeploying.

## Step 1: the export script

Write `scripts/export_static_site_data.py`, following the script conventions in `CONTRIBUTING.md`.

### Neutral-site results

`predict_matchup(a, b)` treats team A as the **home** team, so it is not symmetric. Neutralise by averaging both orderings:

```
p_ab = predict_matchup(A, B).team_a_win_probability   # A at home
p_ba = predict_matchup(B, A).team_a_win_probability   # B at home
neutral_p_a = (p_ab + (1 - p_ba)) / 2

m_ab = predict_matchup(A, B).projected_margin_team_a
m_ba = predict_matchup(B, A).projected_margin_team_a
neutral_margin_a = (m_ab - m_ba) / 2
```

With this, A vs B and B vs A agree exactly, so each pair is stored once and read from either side.

### Performance

There are 835 × 834 / 2 ≈ **348k pairs**, each needing two model calls. Calling `predict_matchup` in a loop builds a one-row DataFrame per call and takes hours. Instead, load the pipeline once and score in batches:

1. Build a feature matrix for a chunk of pairs (reuse the column logic in `build_model_input`, vectorised).
2. Call `predict_proba` and the regressor once per chunk.
3. Target chunks of about 50k rows.

This brings a full export to minutes. Verify a sample against `predict_matchup` (see acceptance checks) so the fast path provably matches the real one.

### Era-correct team names

The profile CSV labels every season with the franchise's **current** name, so the 2005 Sonics appear as the Thunder. Derive the right names from the raw per-game data, where `teamCity` and `teamName` are as of that season:

```python
s = pd.read_csv(STATS_PATH, usecols=["gameDateTimeEst", "teamId", "teamCity", "teamName"], low_memory=False)
s = s.dropna(subset=["teamCity", "teamName"])
t = pd.to_datetime(s["gameDateTimeEst"], format="mixed")
s["season"] = t.dt.year.where(t.dt.month < 10, t.dt.year + 1)
names = s.groupby(["teamId", "season"]).agg(
    city=("teamCity", lambda x: x.mode().iat[0]),
    name=("teamName", lambda x: x.mode().iat[0]),
).reset_index()
```

This is verified to yield 2005 Seattle SuperSonics, New Jersey Nets, Charlotte Bobcats and New Orleans Hornets.

### Team colors

No league/team logos, jerseys, player imagery, or official-looking visual system
appears on the site. Use an independent palette by default. If F00's written
brand review approves team-associated colors, keep a small mapping in
`frontend/src/data/team-colors.ts` and adjust any color that fails contrast
rather than reproducing an official specification.

### Output files

Write into `frontend/public/data/`:

**`index.json`** — every team-season, the source for search, browse and the picker:

```json
{
  "generated": "2026-09-22",
  "teams": [
    {
      "key": "2017-warriors",
      "season": 2017,
      "city": "Golden State",
      "name": "Warriors",
      "franchiseId": 1610612744,
      "madePlayoffs": true,
      "wins": 67, "losses": 15,
      "netRating": 11.63,
      "offRating": 113.2, "defRating": 101.6,
      "pace": 99.8, "trueShooting": 0.6105
    }
  ]
}
```

**`teams/{key}.json`** — one file per team-season holding its results against all 834 others:

```json
{
  "key": "2017-warriors",
  "opponents": {
    "1998-bulls": { "p": 0.6314, "m": 4.8 },
    "2016-cavaliers": { "p": 0.5821, "m": 2.2 }
  }
}
```

`p` is this team's neutral win probability, `m` its projected margin, positive meaning it wins. Round `p` to 4 decimals and `m` to 1: full precision doubles the file size and shows nothing. Expect roughly 30–40 KB per file and about 30 MB in total, which Cloudflare Pages serves comfortably.

**Keys and slugs:** `{season}-{nickname-slug}`, lowercased, spaces to hyphens (`2017-warriors`, `2019-trail-blazers`, `2001-76ers`). Nicknames are unique within a season, so keys never collide.

## Step 2: the site

Scaffold with Vite (`react-ts`) in `frontend/`.

### Routes

| Route | Purpose |
|---|---|
| `/` | Picker, a few suggested matchups, random button |
| `/:matchupSlug` | Result page, e.g. `/1998-bulls-vs-2017-warriors` |
| `/about` | How the model works and its limits |

**Canonical order:** lower season first; if seasons tie, alphabetical by slug. Requesting the reverse order redirects to the canonical URL, so one matchup is never two pages.

### Picker

A single search box is the primary path: typing `bulls 98`, `98 bulls` or `2017 warriors` all match. Match against season, city and nickname, and rank exact nickname matches first. Below it, a browse grid by franchise, then season, for people who don't know what they're looking for. Both must work on a phone.

### Result page

- **Winner card:** both teams with their side accents, the winner's win probability large, the projected margin rounded, as "wins by about 5 pts" (the regressor is typically off by ~10 points, so never show a decimal).
- **Series odds:** "In a best-of-7: Warriors win the series 71% of the time." From single-game probability `p`, the chance of winning a 7-game series is the chance of taking 4 games before the opponent does:

  ```
  P(series) = sum over k=4..7 of  C(k-1, 3) * p^4 * (1-p)^(k-4)
  ```

  Label it "neutral court, each game independent."
- **Stat comparison:** six rows (record, net rating, offensive rating, defensive rating, pace, true shooting %), with the better side highlighted per row. Defensive rating is better when lower.
- **Badges:** a team that missed the playoffs gets a small "missed the playoffs" note, because the model fills playoff stats with zeros and will nearly always pick against it.
- **Share:** copy-link button, plus a "play them again" control to swap either team.

### Visual direction

Dark by default, with a light toggle that persists in `localStorage`. The feel should be *arena at tip-off*, not a generic dashboard, while staying clearly unofficial:

- **Surface:** near-black background with a subtle hardwood grain or parquet texture at very low opacity, never loud enough to fight the text.
- **Court lines:** thin amber-tan rules that echo court markings (center circle, three-point arc) as section dividers and card borders.
- **Numbers:** a condensed scoreboard-style typeface with tabular figures, so digits line up and read as a scoreboard. Body text in a plain, highly readable sans.
- **Team identity:** each side takes its team colors as an accent bar, a glow behind the winner card, and highlights in the stat table. Colors accent; they never become full backgrounds.
- **Motion:** a short count-up on the win probability, and a keep-still option under `prefers-reduced-motion`.

Requirements: mobile-first, works down to 360px wide; contrast at least 4.5:1 for text in both themes; keyboard-navigable picker; `index.json` loads on first paint, and a team's matchup file only when that team is chosen.

### Copy and honesty rules

- **Never show an accuracy figure.** The shipped model's advertised 71% came from a leak: its playoff features included the game it was predicting. See `CONTRIBUTING.md`.
- The `/about` page describes the F01-approved release in plain language and
  states its actual inputs and limitations. Matchups across eras ignore rule
  and pace differences; results are model estimates for entertainment.
- Never use NBA, team or league logos, or wording that implies an official connection.

## Step 3: acceptance checks

Both are required before a deploy is considered good.

1. **Export verification** (`scripts/verify_static_export.py`): sample 200 random pairs from the exported JSON, call `predict_matchup` both ways for each, neutralise, and compare. Probabilities must agree within 1e-6 and margins within 0.05. Exit non-zero on any mismatch. This is the check that matters: a silently wrong export serves wrong numbers everywhere.
2. **Playwright smoke test** in `frontend/`: load `/`, search a team, pick a second, assert a probability appears; load a share URL directly and assert the same numbers; load the reverse-order URL and assert it redirects; toggle the theme and assert it survives a reload.

Also confirm by hand: 2005 Seattle shows as SuperSonics, a non-playoff team shows the badge, and A vs B equals B vs A.

## Step 4: deploy

**Everything stays on Cloudflare**, so there is one account, one dashboard and one bill (all of it free at this size):

| Need | Cloudflare product | Notes |
|---|---|---|
| Hosting | **Pages** | Build `npm run build`, output `frontend/dist`, `frontend/public/data` copied through as static assets. Unlimited bandwidth on the free plan. |
| Analytics | **Web Analytics** | No cookies, so no consent banner. |
| Domain | **Registrar** | Buy the name here when you pick one; it is sold at cost and the DNS is already in the same account. Until then the site runs on `*.pages.dev`. |
| DNS + TLS | **DNS**, automatic | Certificates are issued and renewed by Cloudflare; nothing to configure. |
| Future API | **Workers** | Only if the site ever outgrows precomputed files, for example custom lineups. Not needed for v1; do not add a Worker to serve static JSON. |

Add a `_redirects` rule so unknown paths fall through to `index.html` for client-side routing, and one rule that redirects a reverse-order matchup URL to its canonical form.

Deploys run from this repo through the Pages Git integration: a push to `main` builds and publishes. Keep the data export out of the build step: Pages builds Node only, and the raw Kaggle data it would need is gitignored.

That means the exported JSON is committed, unlike everything else under `data/`. It is about 30 MB, and each annual refresh rewrites every file, adding roughly another 30 MB to git history. That is fine for the first several years. If the repo ever feels heavy, move the JSON to **Cloudflare R2** and fetch it from there: same account, free egress to Cloudflare, and git goes back to holding only code.

## Annual refresh checklist

Once a year, after the Finals:

```
python backend/scripts/import_dataset.py
python backend/scripts/clean_team_histories.py
python backend/scripts/build_team_season_profiles_extended.py
python scripts/export_static_site_data.py
python scripts/verify_static_export.py
cd frontend && npm run build && npm run test:e2e
```

Then redeploy. The new season adds 30 team-seasons, so every existing team file grows and must be re-exported: the export is all-or-nothing, never incremental.

## Open items for the owner

- Buy the domain through Cloudflare Registrar. Until then the site runs on `*.pages.dev`.
- Confirm the color set for defunct identities (Sonics, Bobcats, New Jersey Nets) once you see it on the dark theme.
