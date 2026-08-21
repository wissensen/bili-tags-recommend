ALTER TABLE recommendation_sessions
  ADD COLUMN composite_json TEXT
  CHECK (composite_json IS NULL OR json_valid(composite_json));
