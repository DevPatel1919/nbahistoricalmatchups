-- F09 Session 8: hardening. Indexes only; nothing is rebuilt. Each one keeps a
-- scheduled or public query proportional to its window instead of to all
-- history (measured in test/cost-profile.test.ts).

-- The integrity sweep finds accounts with recent rated play.
CREATE INDEX play_metrics_submitted ON play_metrics (submitted_at);

-- The pair and ring detectors read the last 30 days of rated results.
CREATE INDEX match_resolutions_resolved ON match_resolutions (resolved_at);

-- The purge drops solo and bot sets that expired without a lock-in.
CREATE INDEX duels_unmatched_expires ON duels (expires_at) WHERE match_id IS NULL;

-- The purge drops guests that never played and were never merged.
CREATE INDEX guests_unmerged_created ON guests (created_at) WHERE account_id IS NULL;
