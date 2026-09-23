// Proposed paid offers shown as NON-TRANSACTIONAL intent tests (F05). Nothing
// here takes payment: F00 (commercial rights) must clear before anything is
// sold, and only F07 owns checkout. Prices are the F05/F06 test prices; an
// offer id is part of the experiment record, so change the id with the price.

export type Audience = "fan" | "creator";

export interface Offer {
  id: string;
  audience: Audience;
  name: string;
  /** Exactly as displayed; also sent as `displayedPrice`. */
  price: string;
  cadence: string;
  pitch: string;
  includes: string[];
}

export const FAN_OFFERS: readonly Offer[] = [
  {
    id: "fan-annual-49",
    audience: "fan",
    name: "Fan membership",
    price: "$49",
    cadence: "per year",
    pitch: "For the friend who always starts the argument.",
    includes: [
      "Private group tournaments with your own entrants",
      "Saved bracket history across devices",
      "Replays and deeper title-odds breakdowns",
      "Extra visual themes",
    ],
  },
  {
    id: "tournament-pass-999",
    audience: "fan",
    name: "Tournament pass",
    price: "$9.99",
    cadence: "one time",
    pitch: "Run one private tournament for your group chat or league.",
    includes: ["One private 16-team tournament", "Everyone's picks on one leaderboard", "Kept for a full season"],
  },
];

export const CREATOR_OFFER: Offer = {
  id: "creator-pilot-99",
  audience: "creator",
  name: "Creator pilot",
  price: "$99",
  cadence: "for four weekly packages",
  pitch: "Skip the research. Get a ready-to-use debate episode every week.",
  includes: [
    "Four weekly matchup or bracket packages",
    "Original graphics sized for video and social",
    "A script outline grounded in the model's actual output",
    "Methodology and limitation notes you can cite",
  ],
};
