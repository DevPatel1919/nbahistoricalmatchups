-- F09: leaderboard snapshots. Each board is computed once per scheduled run
-- (and after a review decision) and stored here; GET /v1/leaderboard reads
-- this one row instead of aggregating the rating ledger per request and per
-- edge location. body is the LeaderboardView JSON the endpoint returns.

CREATE TABLE board_snapshots (
  board        TEXT PRIMARY KEY CHECK (board IN ('daily', '30d')),
  generated_at INTEGER NOT NULL,
  body         TEXT NOT NULL
);
