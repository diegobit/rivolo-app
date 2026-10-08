CREATE TABLE mcp_write_operations (
  profile_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'completed')),
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, operation_id),
  FOREIGN KEY (profile_id)
    REFERENCES mcp_provider_profiles(profile_id)
    ON DELETE CASCADE,
  CHECK (
    (state = 'pending' AND result_json IS NULL)
    OR
    (state = 'completed' AND result_json IS NOT NULL)
  )
);

CREATE INDEX mcp_write_operations_updated_at_idx
  ON mcp_write_operations(updated_at);
