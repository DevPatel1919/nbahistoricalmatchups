// Public interface of the Daily Three engine (F12 Session 2). Pure: no
// network, storage, or React. The /daily page (Session 3) loads the static
// data and calls these.

export * from "./types";
export {
  addCalendarDays,
  calendarDaysBetween,
  localDate,
  msUntilNextPuzzle,
  puzzleDate,
  puzzleNumber,
  puzzleNumberAt,
  puzzleStatus,
  type PuzzleStatus,
} from "./day";
export {
  BENCH,
  GAME_SECONDS,
  QUARTER_SECONDS,
  clockAt,
  simSeed,
  simulateGame,
  type PlayKind,
  type SimBox,
  type SimGame,
  type SimInput,
  type SimPlay,
} from "./sim";
export {
  MISSED_DAY_RESETS_HOT_STREAK,
  STORAGE_KEY,
  computeStats,
  correctness,
  dayScore,
  emptyStore,
  getDay,
  parseStore,
  recordDay,
  serializeStore,
  type DailyStats,
  type DailyStore,
  type DayRecord,
  type Streak,
} from "./stats";
export { SHARE_URL, buildShareText, shortTeamLabel, type ShareInput, type ShareTeam } from "./share";
