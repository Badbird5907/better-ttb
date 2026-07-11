ALTER TABLE courses ADD COLUMN scrape_run_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_courses_session_run
  ON courses (session, scrape_run_id);
