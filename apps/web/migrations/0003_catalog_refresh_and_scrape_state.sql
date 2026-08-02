ALTER TABLE courses ADD COLUMN live_refreshed_at TEXT;
ALTER TABLE courses ADD COLUMN live_refresh_claimed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_courses_session_updated
  ON courses (session, updated_at, id);

ALTER TABLE scrape_runs ADD COLUMN sessions TEXT;
ALTER TABLE scrape_runs ADD COLUMN total_courses INTEGER;
ALTER TABLE scrape_runs ADD COLUMN last_attempt_at TEXT;
ALTER TABLE scrape_runs ADD COLUMN last_progress_at TEXT;
ALTER TABLE scrape_runs ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scrape_runs ADD COLUMN last_error TEXT;
ALTER TABLE scrape_runs ADD COLUMN lease_expires_at TEXT;
ALTER TABLE scrape_runs ADD COLUMN trigger_source TEXT;
ALTER TABLE scrape_runs ADD COLUMN indicators_json TEXT;

UPDATE scrape_runs
SET status = 'abandoned',
    finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP)
WHERE status = 'running';

CREATE UNIQUE INDEX IF NOT EXISTS idx_scrape_runs_one_running_session
  ON scrape_runs (sessions)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_scrape_runs_sessions_started
  ON scrape_runs (sessions, started_at DESC);
