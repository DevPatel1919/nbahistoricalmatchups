-- F13 Ask the Court. These tables live in their own D1 database, not the duel
-- database: D1 can't export a database that has virtual tables, and every
-- duel-database migration starts with an export (DEPLOYMENT.md). The chunks can
-- be rebuilt from the repo at any time (scripts/upload_rag_index.py).
--
-- ask_chunks and ask_chunks_fts are the schema src/rag/index_local.py uses, so
-- the same BM25 query runs in both.

CREATE TABLE ask_chunks (
  id      TEXT PRIMARY KEY,
  type    TEXT NOT NULL,
  title   TEXT NOT NULL,
  text    TEXT NOT NULL,
  keys    TEXT NOT NULL,
  seasons TEXT NOT NULL,
  release TEXT NOT NULL
);

CREATE VIRTUAL TABLE ask_chunks_fts USING fts5(
  title, text, content='ask_chunks', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
);

-- Estimated neurons spent per UTC day, against ASK_DAILY_NEURON_BUDGET.
CREATE TABLE ask_budget (
  day     TEXT PRIMARY KEY,
  neurons REAL NOT NULL
);

-- Asked questions, for evaluation. No IP and no client id. Deleted after 30 days
-- by the scheduled handler.
CREATE TABLE ask_log (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  question   TEXT NOT NULL,
  linked     TEXT NOT NULL,
  sources    TEXT NOT NULL,
  grounded   INTEGER NOT NULL,
  fallback   INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL
);
CREATE INDEX ask_log_created ON ask_log (created_at);
