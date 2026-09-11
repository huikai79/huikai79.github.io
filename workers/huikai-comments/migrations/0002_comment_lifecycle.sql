PRAGMA foreign_keys = ON;

ALTER TABLE comments ADD COLUMN reply_to_id TEXT;
ALTER TABLE comments ADD COLUMN page_path TEXT;
ALTER TABLE comments ADD COLUMN removed_by_admin INTEGER NOT NULL DEFAULT 0 CHECK (removed_by_admin IN (0, 1));

-- Existing V1 replies could only point directly at the thread root, so that
-- parent is also the best available direct-reply target during migration.
UPDATE comments
   SET reply_to_id = parent_id
 WHERE parent_id IS NOT NULL
   AND reply_to_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_comments_reply_to
  ON comments(reply_to_id);
