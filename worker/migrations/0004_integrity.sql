-- F09 Session 7: leaderboard and anti-abuse. Detection raises flags for human
-- review and never bans: a flag only keeps the account off the leaderboard until
-- a reviewer clears it. Play and rating are never touched.

-- Anomaly metrics for every rated (ranked) seat, written in the same batch as
-- the submission. The raw per-pick rows stay in scored_picks; this is the
-- per-set summary the detectors and a reviewer read.
CREATE TABLE play_metrics (
  duel_id            TEXT NOT NULL,
  participant        TEXT NOT NULL,
  account_id         TEXT NOT NULL REFERENCES accounts (id),
  submitted_at       INTEGER NOT NULL,
  ms_to_submit       INTEGER NOT NULL,
  picks              INTEGER NOT NULL,
  correct            INTEGER NOT NULL,
  lock_picks         INTEGER NOT NULL,
  lock_correct       INTEGER NOT NULL,
  confident_picks    INTEGER NOT NULL,
  lean_picks         INTEGER NOT NULL,
  model_agree        INTEGER NOT NULL,   -- picks on the side the pre-game model favoured
  confidence_entropy REAL NOT NULL,      -- bits over the three tiers, 0 to log2(3)
  points             INTEGER NOT NULL,
  model_points       INTEGER NOT NULL,
  PRIMARY KEY (duel_id, participant),
  FOREIGN KEY (duel_id, participant) REFERENCES submissions (duel_id, participant),
  CHECK (correct <= picks AND lock_correct <= lock_picks AND lock_picks + confident_picks + lean_picks = picks)
);
CREATE INDEX play_metrics_account ON play_metrics (account_id, submitted_at);

-- A flag is a detector's finding about one account, waiting for a human.
-- related is the other account for pair findings, else ''. At most one open
-- flag per (account, kind, related): the partial unique index, not code.
CREATE TABLE integrity_flags (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts (id),
  kind        TEXT NOT NULL CHECK (kind IN (
                'accuracy_ceiling', 'scripted_timing', 'win_trading', 'repeat_pair',
                'forfeit_feeding', 'feeder_ring', 'linked_accounts', 'multi_account')),
  related     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL CHECK (status IN ('open', 'cleared', 'upheld')),
  evidence    TEXT NOT NULL,            -- JSON: the metrics that tripped the rule
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  reviewed_at INTEGER,
  review_note TEXT,
  CHECK ((status = 'open') = (reviewed_at IS NULL))
);
CREATE UNIQUE INDEX integrity_flags_one_open ON integrity_flags (account_id, kind, related) WHERE status = 'open';
CREATE INDEX integrity_flags_status ON integrity_flags (status, created_at);
CREATE INDEX integrity_flags_account ON integrity_flags (account_id, status);

-- Accounts created from the same network on the same day. The network itself
-- (a keyed IP hash) lives only in a KV entry that expires after two days; this
-- table keeps just the pair. The pair is ordered so it is stored once.
CREATE TABLE account_links (
  account_id TEXT NOT NULL REFERENCES accounts (id),
  linked_id  TEXT NOT NULL REFERENCES accounts (id),
  reason     TEXT NOT NULL CHECK (reason IN ('creation-network')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, linked_id, reason),
  CHECK (account_id < linked_id)
);
CREATE INDEX account_links_linked ON account_links (linked_id);

-- The boards read rated results by time.
CREATE INDEX rating_changes_created ON rating_changes (created_at);
