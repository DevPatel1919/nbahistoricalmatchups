-- F12 Daily Three: crowd stats. One row per browser per puzzle, sent once at
-- lock-in (POST /v1/daily/:n/result). client_id is a random id the browser
-- makes (crypto.randomUUID); it is not tied to a guest, an account, or an
-- address. picks is three characters, one per game: '0' picked team a, '1'
-- team b. score is self-reported and unverified (0 to 3). A second result for
-- the same (n, client_id) is ignored.
--
-- daily_tallies keeps the running totals per puzzle, so GET /v1/daily/:n/stats
-- reads one row instead of every result. The trigger fires only for a row that
-- was actually inserted: INSERT OR IGNORE on a duplicate fires nothing.

CREATE TABLE daily_results (
  n          INTEGER NOT NULL CHECK (n >= 1),
  client_id  TEXT NOT NULL,
  picks      TEXT NOT NULL CHECK (length(picks) = 3 AND picks GLOB '[01][01][01]'),
  score      INTEGER NOT NULL CHECK (score BETWEEN 0 AND 3),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (n, client_id)
);

-- Retention (how many browsers come back for n + 1 and n + 7) looks results up by browser.
CREATE INDEX daily_results_client ON daily_results (client_id, n);

CREATE TABLE daily_tallies (
  n       INTEGER PRIMARY KEY,
  players INTEGER NOT NULL DEFAULT 0,
  -- How many picked team b in games 1 to 3; team a is players minus these.
  b1      INTEGER NOT NULL DEFAULT 0,
  b2      INTEGER NOT NULL DEFAULT 0,
  b3      INTEGER NOT NULL DEFAULT 0,
  -- How many went 0/3, 1/3, 2/3 and 3/3.
  s0      INTEGER NOT NULL DEFAULT 0,
  s1      INTEGER NOT NULL DEFAULT 0,
  s2      INTEGER NOT NULL DEFAULT 0,
  s3      INTEGER NOT NULL DEFAULT 0
);

CREATE TRIGGER daily_results_tally AFTER INSERT ON daily_results
BEGIN
  INSERT INTO daily_tallies (n, players, b1, b2, b3, s0, s1, s2, s3)
  VALUES (
    NEW.n, 1,
    substr(NEW.picks, 1, 1) = '1', substr(NEW.picks, 2, 1) = '1', substr(NEW.picks, 3, 1) = '1',
    NEW.score = 0, NEW.score = 1, NEW.score = 2, NEW.score = 3
  )
  ON CONFLICT (n) DO UPDATE SET
    players = players + 1,
    b1 = b1 + excluded.b1, b2 = b2 + excluded.b2, b3 = b3 + excluded.b3,
    s0 = s0 + excluded.s0, s1 = s1 + excluded.s1, s2 = s2 + excluded.s2, s3 = s3 + excluded.s3;
END;
