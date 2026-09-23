// Share cards (F05): original 1200x630 artwork drawn on a canvas. Court lines,
// hardwood stripes, and type only; no logos, team marks, or player imagery.
// The same drawing backs the download/share button and the /card/* render
// routes that a server can later screenshot for social previews.

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const COLORS = {
  bg: "#0a0a0c",
  panel: "#16161a",
  text: "#f3f1ea",
  dim: "#a8a5a0",
  faint: "#706d68",
  line: "#d8a24a",
  sideA: "#d8a24a",
  sideB: "#5fa8d3",
};

const SCORE_FONT = '"Oswald", "Inter", system-ui, sans-serif';
const BODY_FONT = '"Inter", system-ui, sans-serif';

/** Fonts the cards use; load them before drawing so text measures correctly. */
export const CARD_FONTS = [`600 64px ${SCORE_FONT}`, `700 64px ${SCORE_FONT}`, `400 24px ${BODY_FONT}`, `600 24px ${BODY_FONT}`];

export interface CardTeam {
  season: number;
  city: string;
  name: string;
  record: string;
  missedPlayoffs: boolean;
}

export interface MatchupCardData {
  teamA: CardTeam;
  teamB: CardTeam;
  winner: "a" | "b";
  /** The winner's single-game neutral win probability. */
  winProbability: number;
  /** The winner's best-of-7 series probability. */
  seriesProbability: number;
  /** e.g. "wins by about 4 pts". */
  marginText: string;
}

export interface TournamentCardData {
  title: string;
  /** e.g. "16 teams · best-of-7 · neutral court". */
  subtitle: string;
  champion: string;
  championSeed: number;
  /** e.g. "Beat 2025 Thunder 4-2 in the final". */
  finalLine: string;
  /** Highest title odds, strongest first. */
  topOdds: { label: string; probability: number }[];
  runs: number;
  /** Optional line the fan chose to include, e.g. their score. */
  fanLine?: string;
}

type Ctx = CanvasRenderingContext2D;

export function percent(p: number): string {
  // Never round a model estimate to a certainty.
  const pct = p * 100;
  if (pct > 0 && pct < 0.1) return "<0.1%";
  if (pct > 99.9 && pct < 100) return ">99.9%";
  return `${pct.toFixed(1)}%`;
}

/** Sets the largest font size (down to `min`) at which `text` fits in `maxWidth`. */
function fitFont(ctx: Ctx, text: string, weight: string, family: string, size: number, min: number, maxWidth: number): number {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > min && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

function background(ctx: Ctx) {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // Hardwood stripes.
  ctx.fillStyle = "rgba(180, 120, 50, 0.07)";
  for (let x = 0; x < CARD_WIDTH; x += 42) ctx.fillRect(x, 0, 2, CARD_HEIGHT);

  // Court lines: boundary, half-court line, center circle.
  ctx.strokeStyle = "rgba(216, 162, 74, 0.35)";
  ctx.lineWidth = 3;
  ctx.strokeRect(24, 24, CARD_WIDTH - 48, CARD_HEIGHT - 48);
  ctx.beginPath();
  ctx.moveTo(CARD_WIDTH / 2, 24);
  ctx.lineTo(CARD_WIDTH / 2, CARD_HEIGHT - 24);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(CARD_WIDTH / 2, CARD_HEIGHT / 2, 90, 0, Math.PI * 2);
  ctx.stroke();
}

function brand(ctx: Ctx) {
  ctx.fillStyle = COLORS.line;
  ctx.beginPath();
  ctx.arc(66, 72, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.text;
  ctx.font = `700 30px ${SCORE_FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("COURT OF ALL TIME", 86, 72);
}

function footer(ctx: Ctx, text: string) {
  ctx.fillStyle = COLORS.faint;
  ctx.font = `400 19px ${BODY_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, CARD_WIDTH / 2, CARD_HEIGHT - 44);
}

function panel(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = COLORS.panel;
  ctx.strokeStyle = "rgba(216, 162, 74, 0.45)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);
  ctx.fill();
  ctx.stroke();
}

function teamBlock(ctx: Ctx, team: CardTeam, x: number, accent: string, isWinner: boolean) {
  const w = 460;
  panel(ctx, x, 128, w, 200);
  ctx.fillStyle = accent;
  ctx.fillRect(x, 128, w, 8);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLORS.dim;
  ctx.font = `600 64px ${SCORE_FONT}`;
  ctx.fillText(String(team.season), x + 28, 214);

  ctx.fillStyle = COLORS.text;
  fitFont(ctx, `${team.city} ${team.name}`, "600", BODY_FONT, 34, 20, w - 56);
  ctx.fillText(`${team.city} ${team.name}`, x + 28, 262);

  ctx.fillStyle = COLORS.dim;
  ctx.font = `400 24px ${BODY_FONT}`;
  const note = team.missedPlayoffs ? `${team.record} · missed the playoffs` : team.record;
  ctx.fillText(note, x + 28, 304);

  if (isWinner) {
    ctx.fillStyle = accent;
    ctx.font = `700 22px ${SCORE_FONT}`;
    ctx.textAlign = "right";
    ctx.fillText("MODEL PICK", x + w - 28, 180);
  }
}

export function drawMatchupCard(ctx: Ctx, data: MatchupCardData): void {
  background(ctx);
  brand(ctx);

  teamBlock(ctx, data.teamA, 64, COLORS.sideA, data.winner === "a");
  teamBlock(ctx, data.teamB, CARD_WIDTH - 64 - 460, COLORS.sideB, data.winner === "b");

  ctx.fillStyle = COLORS.line;
  ctx.font = `700 40px ${SCORE_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("VS", CARD_WIDTH / 2, 228);

  const winner = data.winner === "a" ? data.teamA : data.teamB;
  const accent = data.winner === "a" ? COLORS.sideA : COLORS.sideB;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = accent;
  ctx.font = `700 92px ${SCORE_FONT}`;
  ctx.fillText(percent(data.winProbability), CARD_WIDTH / 2, 448);

  ctx.fillStyle = COLORS.text;
  const line = `${winner.season} ${winner.name} win on a neutral court, ${data.marginText}`;
  fitFont(ctx, line, "600", BODY_FONT, 28, 18, CARD_WIDTH - 160);
  ctx.fillText(line, CARD_WIDTH / 2, 494);

  ctx.fillStyle = COLORS.dim;
  ctx.font = `400 24px ${BODY_FONT}`;
  ctx.fillText(`Best-of-7 series: ${percent(data.seriesProbability)}`, CARD_WIDTH / 2, 532);

  footer(ctx, "Model estimate for entertainment · each game independent · not affiliated with the NBA");
}

export function drawTournamentCard(ctx: Ctx, data: TournamentCardData): void {
  background(ctx);
  brand(ctx);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLORS.text;
  fitFont(ctx, data.title, "700", SCORE_FONT, 56, 30, 1060);
  ctx.fillText(data.title, 64, 160);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `400 24px ${BODY_FONT}`;
  ctx.fillText(data.subtitle, 64, 198);

  // Left: the story champion.
  panel(ctx, 64, 234, 520, 250);
  ctx.fillStyle = COLORS.line;
  ctx.font = `700 22px ${SCORE_FONT}`;
  ctx.fillText("THE MODEL'S CHAMPION", 92, 278);
  ctx.fillStyle = COLORS.text;
  fitFont(ctx, data.champion, "700", SCORE_FONT, 60, 30, 464);
  ctx.fillText(data.champion, 92, 350);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `400 24px ${BODY_FONT}`;
  ctx.fillText(`Seed ${data.championSeed}`, 92, 392);
  fitFont(ctx, data.finalLine, "400", BODY_FONT, 24, 16, 464);
  ctx.fillText(data.finalLine, 92, 430);
  if (data.fanLine) {
    ctx.fillStyle = COLORS.sideB;
    fitFont(ctx, data.fanLine, "600", BODY_FONT, 22, 16, 464);
    ctx.fillText(data.fanLine, 92, 466);
  }

  // Right: title odds.
  panel(ctx, 616, 234, 520, 250);
  ctx.fillStyle = COLORS.line;
  ctx.font = `700 22px ${SCORE_FONT}`;
  ctx.fillText(`TITLE ODDS · ${data.runs.toLocaleString("en-US")} RUNS`, 644, 278);
  const max = Math.max(...data.topOdds.map((o) => o.probability), 0.0001);
  data.topOdds.slice(0, 4).forEach((o, i) => {
    const y = 322 + i * 42;
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = "left";
    fitFont(ctx, o.label, "600", BODY_FONT, 22, 14, 200);
    ctx.fillText(o.label, 644, y);
    ctx.fillStyle = "rgba(216, 162, 74, 0.8)";
    ctx.fillRect(860, y - 18, Math.max(4, (o.probability / max) * 160), 20);
    ctx.fillStyle = COLORS.dim;
    ctx.font = `600 22px ${BODY_FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(percent(o.probability), 1108, y);
  });

  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.text;
  ctx.font = `600 26px ${BODY_FONT}`;
  ctx.fillText("Make your picks before you reveal the model.", CARD_WIDTH / 2, 540);

  footer(ctx, "One seeded story · model estimate for entertainment · not affiliated with the NBA");
}
