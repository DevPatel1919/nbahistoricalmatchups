// Shapes of the precomputed static data under public/data/,
// produced by scripts/export_static_site_data.py.

export interface IndexTeam {
  key: string;
  season: number;
  city: string;
  name: string;
  franchiseId: number;
  madePlayoffs: boolean;
  wins: number;
  losses: number;
  netRating: number;
  offRating: number;
  defRating: number;
  pace: number;
  trueShooting: number;
}

/** The model release that produced this export (see models/releases/). */
export interface ReleaseInfo {
  version: string;
  purpose: string;
}

export interface IndexData {
  generated: string;
  release: ReleaseInfo;
  teams: IndexTeam[];
}

export interface OpponentResult {
  /** This team's neutral-court win probability against the opponent. */
  p: number;
  /** This team's projected margin against the opponent (positive = wins by that much). */
  m: number;
}

export interface TeamFile {
  key: string;
  opponents: Record<string, OpponentResult>;
}
