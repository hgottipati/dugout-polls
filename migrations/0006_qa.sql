ALTER TABLE polls ADD COLUMN qa INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL,
  text TEXT NOT NULL,
  name TEXT DEFAULT '',
  author_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  answered INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ideas_poll ON ideas (poll_id, created_at);

CREATE TABLE IF NOT EXISTS idea_votes (
  idea_id TEXT NOT NULL,
  voter_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (idea_id, voter_id)
);
