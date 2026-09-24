-- F09 Session 3: guest play. Stored identifiers are minimal: a random guest id,
-- no IP address, no user agent, no email.

CREATE TABLE guests (
  id          TEXT PRIMARY KEY,           -- random, issued by the Worker
  created_at  INTEGER NOT NULL            -- epoch ms
);

-- One issued puzzle set. puzzle_ids is the ordered JSON array the client saw.
CREATE TABLE duels (
  id          TEXT PRIMARY KEY,
  mode        TEXT NOT NULL CHECK (mode IN ('solo', 'bot')),
  partition   TEXT NOT NULL CHECK (partition IN ('sim', 'ranked')),
  draw_kind   TEXT NOT NULL CHECK (draw_kind IN ('random', 'era')),
  draw_era    TEXT,
  puzzle_ids  TEXT NOT NULL,
  pool_version TEXT NOT NULL,
  issued_to   TEXT NOT NULL,              -- participant: 'g:<guestId>'
  issued_at   INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX duels_issued_to ON duels (issued_to, issued_at);

-- One submission per duel per participant, enforced here rather than in code.
CREATE TABLE submissions (
  duel_id         TEXT NOT NULL REFERENCES duels (id),
  participant     TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  submitted_at    INTEGER NOT NULL,
  ms_to_submit    INTEGER NOT NULL,       -- anomaly instrumentation
  total_points    INTEGER NOT NULL,
  result          TEXT NOT NULL,          -- JSON reveal returned to the participant
  PRIMARY KEY (duel_id, participant),
  UNIQUE (participant, idempotency_key)
);

-- Per-pick record for calibration and anomaly baselines (time-to-submit,
-- per-tier accuracy, confidence entropy are derived from these rows).
CREATE TABLE scored_picks (
  duel_id     TEXT NOT NULL,
  participant TEXT NOT NULL,
  puzzle_id   TEXT NOT NULL,
  position    INTEGER NOT NULL,
  side        TEXT NOT NULL CHECK (side IN ('home', 'away')),
  confidence  TEXT NOT NULL CHECK (confidence IN ('lean', 'confident', 'lock')),
  correct     INTEGER NOT NULL CHECK (correct IN (0, 1)),
  points      INTEGER NOT NULL,
  PRIMARY KEY (duel_id, participant, puzzle_id),
  FOREIGN KEY (duel_id, participant) REFERENCES submissions (duel_id, participant)
);
CREATE INDEX scored_picks_participant ON scored_picks (participant);

-- Every puzzle whose answer has reached any client. A ranked draw must never
-- choose one of these (the generator keeps sim and ranked disjoint; this is
-- the runtime record for ranked single use).
CREATE TABLE served_answers (
  puzzle_id       TEXT PRIMARY KEY,
  first_served_at INTEGER NOT NULL
);
