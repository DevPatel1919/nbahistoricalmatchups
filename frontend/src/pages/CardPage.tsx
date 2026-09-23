// Stable render routes for share cards (F05), outside the site layout:
//
//   /card/m/:matchupSlug   a matchup card
//   /card/t/:code          a tournament card (the model's story and odds; never a fan's picks)
//
// The page is exactly 1200x630 and sets data-card-state="ready" (or "error")
// on the canvas once drawn, so a server-side renderer can screenshot it for
// social previews later.

import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { runTitleOdds } from "../tournament";
import { loadIndex, loadTeamFile } from "../lib/dataLoader";
import { parseMatchupSlug } from "../lib/slug";
import { teamLabel } from "../lib/bracket";
import { loadTournament } from "../lib/tournamentLoader";
import { CARD_HEIGHT, CARD_WIDTH, drawMatchupCard, drawTournamentCard } from "../share/cards";
import { matchupCardData, tournamentCardData } from "../share/cardData";
import { paintCard } from "../share/shareImage";

type Draw = (ctx: CanvasRenderingContext2D) => void;

async function matchupDraw(slug: string): Promise<Draw> {
  const parsed = parseMatchupSlug(slug);
  if (!parsed) throw new Error("Not a matchup");
  const index = await loadIndex();
  const teamA = index.teams.find((t) => t.key === parsed[0]);
  const teamB = index.teams.find((t) => t.key === parsed[1]);
  if (!teamA || !teamB) throw new Error("Unknown team-season");
  const result = (await loadTeamFile(teamA.key)).opponents[teamB.key];
  if (!result) throw new Error("No result for this pair");
  const data = matchupCardData(teamA, teamB, result);
  return (ctx) => drawMatchupCard(ctx, data);
}

async function tournamentDraw(code: string): Promise<Draw> {
  const loaded = await loadTournament(code);
  if (loaded.kind === "invalid") throw new Error(loaded.message);
  const odds = runTitleOdds(loaded.definition, loaded.table);
  if (!odds.ok) throw new Error(odds.error.message);
  const title = loaded.curated?.title ?? `Custom ${loaded.definition.entrants.length}-team tournament`;
  const data = tournamentCardData(title, loaded.bracket, odds.value, (key) => teamLabel(loaded.entrants.get(key)!.team));
  return (ctx) => drawTournamentCard(ctx, data);
}

export default function CardPage({ kind }: { kind: "matchup" | "tournament" }) {
  const { matchupSlug = "", code = "" } = useParams();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    const draw = kind === "matchup" ? matchupDraw(matchupSlug) : tournamentDraw(code);
    draw
      .then(async (paint) => {
        if (cancelled || !canvas.current) return;
        await paintCard(canvas.current, paint);
        if (!cancelled) setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [kind, matchupSlug, code]);

  return (
    <div className="card-page">
      <canvas
        ref={canvas}
        width={CARD_WIDTH}
        height={CARD_HEIGHT}
        data-card-state={state}
        role="img"
        aria-label={state === "error" ? "This card could not be drawn" : "Court of All Time share card"}
      />
    </div>
  );
}
