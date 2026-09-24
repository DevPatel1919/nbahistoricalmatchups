-- F09 Session 5: accounts. Stored identifiers stay minimal: an account holds a
-- keyed hash of its normalised email (never the address), an optional display
-- name, and timestamps. Magic links and sessions are stored as SHA-256 hashes,
-- so read access to this database never grants a sign-in.

CREATE TABLE accounts (
  id                TEXT PRIMARY KEY,     -- random, issued by the Worker
  email_hash        TEXT NOT NULL UNIQUE, -- HMAC(EMAIL_HASH_SECRET, normalised email)
  display_name      TEXT,                 -- null until the player chooses one
  display_name_key  TEXT UNIQUE,          -- folded form: blocks look-alike names
  name_changed_at   INTEGER,              -- epoch ms of the last rename
  created_at        INTEGER NOT NULL
);

-- A magic link is valid once, for a short time. Only its hash is stored.
CREATE TABLE magic_links (
  token_hash  TEXT PRIMARY KEY,
  email_hash  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX magic_links_expires ON magic_links (expires_at);

-- Single use is this primary key, not application logic: a second redemption
-- fails the whole sign-in batch.
CREATE TABLE magic_link_redemptions (
  token_hash  TEXT PRIMARY KEY REFERENCES magic_links (token_hash),
  redeemed_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts (id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);
CREATE INDEX sessions_account ON sessions (account_id);

-- A guest merged into an account stops being a usable identity; its rows are
-- re-keyed from 'g:<guestId>' to 'a:<accountId>' in the same batch.
ALTER TABLE guests ADD COLUMN account_id TEXT REFERENCES accounts (id);

CREATE INDEX submissions_participant ON submissions (participant);
