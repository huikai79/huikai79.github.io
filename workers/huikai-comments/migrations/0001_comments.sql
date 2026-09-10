PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  article_key TEXT NOT NULL,
  parent_id TEXT,
  display_name TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'hidden', 'withdrawn', 'spam')),
  is_author INTEGER NOT NULL DEFAULT 0 CHECK (is_author IN (0, 1)),
  manage_token_hash TEXT,
  created_at TEXT NOT NULL,
  moderated_at TEXT,
  FOREIGN KEY (parent_id) REFERENCES comments(id)
);

CREATE INDEX IF NOT EXISTS idx_comments_article_status_created
  ON comments(article_key, status, created_at);

CREATE INDEX IF NOT EXISTS idx_comments_status_created
  ON comments(status, created_at);

CREATE INDEX IF NOT EXISTS idx_comments_parent
  ON comments(parent_id);
