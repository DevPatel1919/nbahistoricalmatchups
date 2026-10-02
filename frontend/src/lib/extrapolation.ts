// Whether a matchup lies outside what the served model was trained on.
//
// Only a release trained on playoff games only (hist-v1) extrapolates when a
// team missed the playoffs. hist-v2 was trained on regular-season, play-in and
// playoff games and reads regular-season stats only, so a non-playoff team is
// ordinary for it. index.json's release.nonPlayoffExtrapolation carries this
// (scripts/export_static_site_data.py, src/models/release.py); an export made
// before the field existed came from hist-v1, so a missing flag means true.

import type { IndexTeam, ReleaseInfo } from "../types";

export function isExtrapolation(
  release: ReleaseInfo | null | undefined,
  teamA: Pick<IndexTeam, "madePlayoffs">,
  teamB: Pick<IndexTeam, "madePlayoffs">,
): boolean {
  const releaseExtrapolates = release?.nonPlayoffExtrapolation ?? true;
  return releaseExtrapolates && (!teamA.madePlayoffs || !teamB.madePlayoffs);
}
