// Whether the build switched Ask the Court on (F13). VITE_ASK_COURT is normalised
// to exactly "1" or "" at build time (buildEnv.ts). It also needs the Worker, so a
// PR preview, which builds without VITE_DUEL_API, shows no panel. App.tsx and
// ResultPage.tsx test the variable inline, so a build without the flag emits no
// Ask the Court code.

import { DUEL_API } from "./duelApi";

export const ASK_COURT = import.meta.env.VITE_ASK_COURT === "1" && DUEL_API !== null;
