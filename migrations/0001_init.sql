CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  description TEXT DEFAULT '',
  options_json TEXT NOT NULL,
  allow_multiple INTEGER DEFAULT 0,
  require_name INTEGER DEFAULT 0,
  closed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  closes_at TEXT
);

CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id TEXT NOT NULL,
  voter_id TEXT NOT NULL,
  name TEXT DEFAULT '',
  option_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(poll_id, voter_id)
);
