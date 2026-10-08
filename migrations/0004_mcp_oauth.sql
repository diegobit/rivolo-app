CREATE TABLE mcp_oauth_clients (
  client_id TEXT PRIMARY KEY NOT NULL,
  registration_hash TEXT NOT NULL UNIQUE CHECK (length(registration_hash) = 64),
  redirect_uris TEXT NOT NULL,
  client_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE mcp_oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY NOT NULL CHECK (length(code_hash) = 64),
  profile_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY (profile_id)
    REFERENCES mcp_provider_profiles(profile_id)
    ON DELETE CASCADE,
  FOREIGN KEY (client_id)
    REFERENCES mcp_oauth_clients(client_id)
    ON DELETE CASCADE
);

CREATE INDEX mcp_oauth_codes_expiry
  ON mcp_oauth_authorization_codes (expires_at);

CREATE TABLE mcp_oauth_token_families (
  family_id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (profile_id)
    REFERENCES mcp_provider_profiles(profile_id)
    ON DELETE CASCADE,
  FOREIGN KEY (client_id)
    REFERENCES mcp_oauth_clients(client_id)
    ON DELETE CASCADE
);

CREATE INDEX mcp_oauth_families_profile
  ON mcp_oauth_token_families (profile_id, created_at DESC);

CREATE TABLE mcp_oauth_token_grants (
  grant_id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL,
  access_token_hash TEXT NOT NULL UNIQUE CHECK (length(access_token_hash) = 64),
  refresh_token_hash TEXT NOT NULL UNIQUE CHECK (length(refresh_token_hash) = 64),
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  access_expires_at TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  access_revoked_at TEXT,
  refresh_used_at TEXT,
  FOREIGN KEY (family_id)
    REFERENCES mcp_oauth_token_families(family_id)
    ON DELETE CASCADE
);

CREATE INDEX mcp_oauth_grants_family
  ON mcp_oauth_token_grants (family_id, created_at DESC);

CREATE TRIGGER mcp_revoke_oauth_after_profile_revoke
AFTER UPDATE OF revoked_at ON mcp_provider_profiles
WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
BEGIN
  UPDATE mcp_oauth_token_families
  SET revoked_at = NEW.revoked_at
  WHERE profile_id = NEW.profile_id AND revoked_at IS NULL;

  UPDATE mcp_oauth_authorization_codes
  SET used_at = NEW.revoked_at
  WHERE profile_id = NEW.profile_id AND used_at IS NULL;
END;
