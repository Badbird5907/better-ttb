CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  code TEXT,
  section_code TEXT,
  session TEXT,
  name TEXT,
  department TEXT,
  data_json TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_courses_code ON courses (code);

CREATE TABLE IF NOT EXISTS scrape_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT,
  finished_at TEXT,
  pages_done INTEGER,
  total_pages INTEGER,
  status TEXT
);
