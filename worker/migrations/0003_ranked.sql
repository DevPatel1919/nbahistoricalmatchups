-- F09 Session 6: ranked duels, friend duels, and Elo. Integrity rules live in
-- constraints: a match has at most one opponent seat (primary key), resolves
-- once (primary key), and applies each rating change once per account
-- (primary key). A rating change also records the rating it started from, so the
-- ledger alone reproduces every rating.

PRAGMA defer_foreign_keys = on;

-- SQLite cannot alter a CHECK, so duels is rebuilt to admit the two new modes
-- and to link a seat's duel to its match. Rows and ids are copied unchanged.
-- Its two child tables are rebuilt with it and dropped first: dropping a parent
-- that still has children counts deferred foreign-key violations that a later
-- rename does not clear, and D1 rejects the migration.
CREATE TABLE duels_new (
  id           TEXT PRIMARY KEY,
  mode         TEXT NOT NULL CHECK (mode IN ('solo', 'bot', 'ranked', 'friend')),
  partition    TEXT NOT NULL CHECK (partition IN ('sim', 'ranked')),
  draw_kind    TEXT NOT NULL CHECK (draw_kind IN ('random', 'era')),
  draw_era     TEXT,
  puzzle_ids   TEXT NOT NULL,
  pool_version TEXT NOT NULL,
  issued_to    TEXT NOT NULL,              -- participant: 'g:<guestId>' or 'a:<accountId>'
  issued_at    INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  match_id     TEXT,                       -- set for ranked and friend seats
  CHECK ((mode IN ('ranked', 'friend')) = (match_id IS NOT NULL)),
  CHECK (mode != 'ranked' OR partition = 'ranked')
);
INSERT INTO duels_new (id, mode, partition, draw_kind, draw_era, puzzle_ids, pool_version, issued_to, issued_at, expires_at)
  SELECT id, mode, partition, draw_kind, draw_era, puzzle_ids, pool_version, issued_to, issued_at, expires_at FROM duels;

-- Unchanged from 0001, apart from pointing at the rebuilt parent.
CREATE TABLE submissions_new (
  duel_id         TEXT NOT NULL REFERENCES duels_new (id),
  participant     TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  submitted_at    INTEGER NOT NULL,
  ms_to_submit    INTEGER NOT NULL,
  total_points    INTEGER NOT NULL,
  result          TEXT NOT NULL,          -- JSON reveal; for a match seat, rewritten when the match resolves
  PRIMARY KEY (duel_id, participant),
  UNIQUE (participant, idempotency_key)
);
INSERT INTO submissions_new SELECT duel_id, participant, idempotency_key, submitted_at, ms_to_submit, total_points, result FROM submissions;

CREATE TABLE scored_picks_new (
  duel_id     TEXT NOT NULL,
  participant TEXT NOT NULL,
  puzzle_id   TEXT NOT NULL,
  position    INTEGER NOT NULL,
  side        TEXT NOT NULL CHECK (side IN ('home', 'away')),
  confidence  TEXT NOT NULL CHECK (confidence IN ('lean', 'confident', 'lock')),
  correct     INTEGER NOT NULL CHECK (correct IN (0, 1)),
  points      INTEGER NOT NULL,
  PRIMARY KEY (duel_id, participant, puzzle_id),
  FOREIGN KEY (duel_id, participant) REFERENCES submissions_new (duel_id, participant)
);
INSERT INTO scored_picks_new SELECT duel_id, participant, puzzle_id, position, side, confidence, correct, points FROM scored_picks;

DROP TABLE scored_picks;
DROP TABLE submissions;
DROP TABLE duels;
-- Each rename also rewrites the foreign keys that name it.
ALTER TABLE duels_new RENAME TO duels;
ALTER TABLE submissions_new RENAME TO submissions;
ALTER TABLE scored_picks_new RENAME TO scored_picks;
CREATE INDEX duels_issued_to ON duels (issued_to, issued_at);
CREATE INDEX duels_match ON duels (match_id);
CREATE INDEX submissions_participant ON submissions (participant);
CREATE INDEX scored_picks_participant ON scored_picks (participant);

-- One shared puzzle set played by two seats. The creator plays first; the set
-- waits for an opponent until open_until.
CREATE TABLE matches (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('ranked', 'friend')),
  puzzle_ids     TEXT NOT NULL,          -- the one ordered set both seats receive
  pool_version   TEXT NOT NULL,
  draw_kind      TEXT NOT NULL CHECK (draw_kind IN ('random', 'era')),
  draw_era       TEXT,
  creator_rating INTEGER,                -- ranked only: the creator's rating when queued
  created_at     INTEGER NOT NULL,
  open_until     INTEGER NOT NULL,       -- no opponent can join after this
  CHECK ((kind = 'ranked') = (creator_rating IS NOT NULL))
);
CREATE INDEX matches_open ON matches (kind, open_until);

-- The primary key allows one creator and one opponent per match, so two joiners
-- racing for the same set cannot both get in.
CREATE TABLE match_seats (
  match_id    TEXT NOT NULL REFERENCES matches (id),
  seat        TEXT NOT NULL CHECK (seat IN ('creator', 'opponent')),
  participant TEXT NOT NULL,
  duel_id     TEXT NOT NULL UNIQUE REFERENCES duels (id),
  joined_at   INTEGER NOT NULL,
  PRIMARY KEY (match_id, seat)
);
CREATE INDEX match_seats_participant ON match_seats (participant, joined_at);

-- A match resolves once. settled_by records which timeout rule, if any, applied.
CREATE TABLE match_resolutions (
  match_id    TEXT PRIMARY KEY REFERENCES matches (id),
  settled_by  TEXT NOT NULL CHECK (settled_by IN ('both-locked', 'forfeit', 'no-opponent')),
  outcome     TEXT NOT NULL CHECK (outcome IN ('creator', 'opponent', 'draw', 'none')),
  rated       INTEGER NOT NULL CHECK (rated IN (0, 1)),
  resolved_at INTEGER NOT NULL
);

-- Ratings exist only for accounts that have played a rated duel.
CREATE TABLE ratings (
  account_id  TEXT PRIMARY KEY REFERENCES accounts (id),
  rating      INTEGER NOT NULL,
  rated_duels INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- The Elo ledger. rating_before is NOT NULL and is written from a subquery that
-- matches only the rating the change was computed from; a concurrent change makes
-- it NULL, which fails the whole resolution batch rather than losing an update.
CREATE TABLE rating_changes (
  match_id           TEXT NOT NULL REFERENCES matches (id),
  account_id         TEXT NOT NULL REFERENCES accounts (id),
  rating_before      INTEGER NOT NULL,
  rating_after       INTEGER NOT NULL,
  delta              INTEGER NOT NULL,
  k                  INTEGER NOT NULL,
  rated_duels_before INTEGER NOT NULL,
  created_at         INTEGER NOT NULL,
  PRIMARY KEY (match_id, account_id),
  CHECK (rating_after = rating_before + delta)
);
CREATE INDEX rating_changes_account ON rating_changes (account_id, created_at);

-- Every ranked puzzle ever shown to an account. Such a puzzle is never issued to
-- that account again (owner decision: limited reuse).
CREATE TABLE ranked_exposures (
  account_id TEXT NOT NULL REFERENCES accounts (id),
  puzzle_id  TEXT NOT NULL,
  shown_at   INTEGER NOT NULL,
  PRIMARY KEY (account_id, puzzle_id)
);

-- When a ranked puzzle's answer was last revealed. No one is issued it again
-- until the reuse cooldown has passed. Kept apart from served_answers, which
-- also holds every sim puzzle, so the draw reads only ranked rows.
CREATE TABLE ranked_reveals (
  puzzle_id        TEXT PRIMARY KEY,
  last_revealed_at INTEGER NOT NULL
);
CREATE INDEX ranked_reveals_last ON ranked_reveals (last_revealed_at);
