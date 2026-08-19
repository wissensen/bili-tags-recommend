PRAGMA foreign_keys = ON;

CREATE TABLE upload_assets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  object_key TEXT UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  etag TEXT,
  status TEXT NOT NULL CHECK (status IN ('local_only', 'pending', 'uploaded', 'verified', 'rejected')),
  created_at TEXT NOT NULL,
  verified_at TEXT
);

CREATE INDEX upload_assets_owner_created_idx
  ON upload_assets (owner_id, created_at DESC);

CREATE TABLE analysis_jobs (
  id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL REFERENCES upload_assets(id),
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE INDEX analysis_jobs_owner_created_idx
  ON analysis_jobs (owner_id, created_at DESC);

CREATE INDEX analysis_jobs_upload_idx
  ON analysis_jobs (upload_id);

CREATE TABLE recommendation_sessions (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL UNIQUE REFERENCES analysis_jobs(id),
  owner_id TEXT NOT NULL,
  ranking_version TEXT NOT NULL,
  candidates_json TEXT NOT NULL CHECK (json_valid(candidates_json)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX recommendation_sessions_owner_idx
  ON recommendation_sessions (owner_id, expires_at);

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  upload_id TEXT NOT NULL REFERENCES upload_assets(id),
  analysis_id TEXT NOT NULL REFERENCES analysis_jobs(id),
  title TEXT NOT NULL,
  category_id TEXT NOT NULL,
  cover_object_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('saved', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX submissions_owner_created_idx
  ON submissions (owner_id, created_at DESC);

CREATE TABLE submission_tags (
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 9),
  candidate_id TEXT,
  text TEXT NOT NULL,
  PRIMARY KEY (submission_id, position),
  UNIQUE (submission_id, text)
);

CREATE TABLE idempotency_keys (
  owner_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  response_status INTEGER,
  response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, scope, idempotency_key)
);

CREATE INDEX idempotency_keys_expiry_idx
  ON idempotency_keys (expires_at);
