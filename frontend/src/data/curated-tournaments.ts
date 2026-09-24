// Curated tournaments (F04). A curated tournament is a fixed definition: the
// same entrants, seeding, series length, and seed for everyone, so every fan
// predicts against the same model story.
//
// Changing any field below changes the story for everyone. Add a new entry
// with a new id (e.g. "champions-v2") instead of editing a published one.

import type { TournamentDefinition } from "../tournament";

export interface CuratedTournament {
  /** Stable id, used in analytics and storage. Never reuse one. */
  id: string;
  title: string;
  summary: string;
  /** How the seeds were chosen, shown on the entrants screen. */
  seedingNote: string;
  definition: TournamentDefinition;
}

// NBA champions 1998-2025 that are in the export (2022 is missing; see
// CONTRIBUTING.md), the 16 with the best regular-season net rating, seeded by
// net rating (ties by win percentage). A real statistic rather than the
// model's own ranking, so the seeding does not pre-empt the result.
export const CHAMPIONS: CuratedTournament = {
  id: "champions-v1",
  title: "The Champions Bracket",
  summary: "Sixteen NBA champions since 1998, one neutral court, best-of-7 all the way.",
  seedingNote:
    "The 16 title winners since 1998 with the best regular-season net rating, seeded by that net rating. The 2022 champion is missing from the data.",
  definition: {
    version: 1,
    seed: "champions-v1",
    seriesBestOf: 7,
    entrants: [
      "2025-thunder",
      "2024-celtics",
      "2017-warriors",
      "2008-celtics",
      "2015-warriors",
      "1999-spurs",
      "2007-spurs",
      "2000-lakers",
      "2005-spurs",
      "2014-spurs",
      "2013-heat",
      "2009-lakers",
      "1998-bulls",
      "2002-lakers",
      "2004-pistons",
      "2012-heat",
    ],
  },
};

export const CURATED_TOURNAMENTS: readonly CuratedTournament[] = [CHAMPIONS];
