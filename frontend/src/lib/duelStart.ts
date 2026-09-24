import type { NavigateFunction } from "react-router-dom";
import type { DrawMode, PlayMode } from "../duel";
import { track } from "./analytics";
import { startSet } from "./duelApi";

/** Starts a set and opens it. Shared by the duel home page and "Play another set". */
export async function beginDuel(mode: PlayMode, draw: DrawMode, navigate: NavigateFunction): Promise<void> {
  const set = await startSet(mode, draw);
  track({ name: "duel_started", mode, drawKind: draw.kind, era: draw.kind === "era" ? draw.era : "any" });
  navigate("/duel/" + set.duelId, { state: { set } });
}
