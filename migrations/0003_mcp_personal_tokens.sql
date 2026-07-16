CREATE TABLE mcp_personal_tokens (
  token_id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  token_prefix TEXT NOT NULL CHECK (length(token_prefix) BETWEEN 8 AND 16),
  scopes TEXT NOT NULL DEFAULT 'notes:read notes:write'
    CHECK (scopes = 'notes:read notes:write'),
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (profile_id)
    REFERENCES mcp_provider_profiles(profile_id)
    ON DELETE CASCADE
);

CREATE INDEX mcp_personal_tokens_profile_created
  ON mcp_personal_tokens (profile_id, created_at DESC);

CREATE TRIGGER mcp_revoke_personal_tokens_after_profile_revoke
AFTER UPDATE OF revoked_at ON mcp_provider_profiles
WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
BEGIN
  UPDATE mcp_personal_tokens
  SET revoked_at = NEW.revoked_at
  WHERE profile_id = NEW.profile_id AND revoked_at IS NULL;
END;
