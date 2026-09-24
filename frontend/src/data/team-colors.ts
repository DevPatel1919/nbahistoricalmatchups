// Team color accents, OFF by default. The site uses an independent side-A /
// side-B palette (--side-a / --side-b in index.css) until F00's written brand
// review approves team-associated colors; flip TEAM_COLORS_APPROVED only then.
// No NBA or team logos anywhere on the site (they are trademarked). Keyed by era-correct
// nickname exactly as exported in index.json/teams/*.json, so a franchise
// whose identity changed (Sonics -> Thunder, Bobcats -> Hornets) gets its
// own historically-accurate entry instead of sharing one with its modern
// successor. Values are adjusted from official hex where needed for
// contrast against the dark theme (see docs/frontend-handoff.md).

export const TEAM_COLORS_APPROVED = false;

export interface TeamColors {
  primary: string;
  secondary: string;
}

const DEFAULT_COLORS: TeamColors = { primary: "#d8a24a", secondary: "#8a8d90" };

export const TEAM_COLORS: Record<string, TeamColors> = {
  "76ers": { primary: "#2b7fc4", secondary: "#ed174c" },
  Bobcats: { primary: "#ff8b3d", secondary: "#3a6ea5" },
  Bucks: { primary: "#35d07f", secondary: "#f0ebd2" },
  Bulls: { primary: "#e0464f", secondary: "#c6c6c6" },
  Cavaliers: { primary: "#a23757", secondary: "#ffb81c" },
  Celtics: { primary: "#2fae66", secondary: "#c2a765" },
  Clippers: { primary: "#e2495a", secondary: "#4b6cb7" },
  Grizzlies: { primary: "#7d93cf", secondary: "#f5b112" },
  Hawks: { primary: "#e64d51", secondary: "#c9dc4a" },
  Heat: { primary: "#c3355a", secondary: "#f9a01b" },
  Hornets: { primary: "#7a5fd1", secondary: "#28a9be" },
  Jazz: { primary: "#3f6fa8", secondary: "#f9a01b" },
  Kings: { primary: "#8a4bb0", secondary: "#8b98a0" },
  Knicks: { primary: "#2b7fc4", secondary: "#f58426" },
  Lakers: { primary: "#8358b3", secondary: "#fdb927" },
  Magic: { primary: "#2f93d1", secondary: "#c4ced4" },
  Mavericks: { primary: "#3d8bc4", secondary: "#c1cad0" },
  Nets: { primary: "#9aa0a6", secondary: "#f2f2f2" },
  Nuggets: { primary: "#3f66b0", secondary: "#fec524" },
  Pacers: { primary: "#3f5f93", secondary: "#fdbb30" },
  Pelicans: { primary: "#3a5c96", secondary: "#c9a869" },
  Pistons: { primary: "#e2495a", secondary: "#3a5cd0" },
  Raptors: { primary: "#e0464f", secondary: "#9a6bd6" },
  Rockets: { primary: "#e2495a", secondary: "#c4ced4" },
  Spurs: { primary: "#c7cbce", secondary: "#6d7278" },
  Suns: { primary: "#f2954a", secondary: "#8a5fd6" },
  SuperSonics: { primary: "#2fa060", secondary: "#ffc200" },
  Thunder: { primary: "#3d92d6", secondary: "#f26430" },
  Timberwolves: { primary: "#3d84b8", secondary: "#7dc242" },
  "Trail Blazers": { primary: "#e2495a", secondary: "#e4e5e8" },
  Warriors: { primary: "#4d7dc0", secondary: "#ffc72c" },
  Wizards: { primary: "#3d5fa0", secondary: "#e31837" },
};

export function getTeamColors(nickname: string): TeamColors {
  return TEAM_COLORS[nickname] ?? DEFAULT_COLORS;
}
