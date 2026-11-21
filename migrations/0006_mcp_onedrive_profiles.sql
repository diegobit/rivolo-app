-- Allow OneDrive Agent access profiles and track credential refreshes apart
-- from profile edits.
--
-- SQLite cannot change a CHECK constraint in place, so the profiles table is
-- rebuilt. DROP TABLE runs an implicit DELETE that fires ON DELETE CASCADE on
-- every child table, even with deferred foreign keys, and renaming the old
-- table would repoint the children at it. The child rows are therefore copied
-- aside, the parent is replaced, and the rows are restored with the same keys.

CREATE TABLE mcp_provider_profiles_v6 (
  profile_id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('dropbox', 'google-drive', 'onedrive')),
  provider_account_id TEXT NOT NULL,
  provider_email TEXT,
  provider_name TEXT,
  dropbox_path TEXT,
  google_file_id TEXT,
  google_folder_id TEXT,
  google_file_name TEXT,
  time_zone TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  daily_folder_id TEXT,
  onedrive_folder_name TEXT,
  -- When the stored provider credential was last saved or refreshed. Kept
  -- separate from updated_at, which guards Settings changes.
  credential_refreshed_at TEXT,
  UNIQUE (provider, provider_account_id),
  CHECK (
    (
      provider = 'dropbox'
      AND dropbox_path IS NOT NULL
      AND google_file_id IS NULL
      AND google_folder_id IS NULL
      AND google_file_name IS NULL
      AND onedrive_folder_name IS NULL
    )
    OR
    (
      provider = 'google-drive'
      AND dropbox_path IS NULL
      AND google_file_id IS NOT NULL
      AND google_file_name IS NOT NULL
      AND onedrive_folder_name IS NULL
    )
    OR
    (
      provider = 'onedrive'
      AND dropbox_path IS NULL
      AND google_file_id IS NULL
      AND google_folder_id IS NULL
      AND google_file_name IS NULL
      AND daily_folder_id IS NOT NULL
      AND onedrive_folder_name IS NOT NULL
    )
  )
);

INSERT INTO mcp_provider_profiles_v6 (
  profile_id, provider, provider_account_id, provider_email, provider_name,
  dropbox_path, google_file_id, google_folder_id, google_file_name, time_zone,
  encrypted_refresh_token, created_at, updated_at, revoked_at, daily_folder_id,
  onedrive_folder_name, credential_refreshed_at
)
SELECT
  profile_id, provider, provider_account_id, provider_email, provider_name,
  dropbox_path, google_file_id, google_folder_id, google_file_name, time_zone,
  encrypted_refresh_token, created_at, updated_at, revoked_at, daily_folder_id,
  NULL, updated_at
FROM mcp_provider_profiles;

CREATE TABLE mcp_v6_write_operations AS SELECT * FROM mcp_write_operations;
CREATE TABLE mcp_v6_personal_tokens AS SELECT * FROM mcp_personal_tokens;
CREATE TABLE mcp_v6_oauth_codes AS SELECT * FROM mcp_oauth_authorization_codes;
CREATE TABLE mcp_v6_oauth_families AS SELECT * FROM mcp_oauth_token_families;
CREATE TABLE mcp_v6_oauth_grants AS SELECT * FROM mcp_oauth_token_grants;

-- Cascades through every child table, including grants via their families.
DROP TABLE mcp_provider_profiles;
ALTER TABLE mcp_provider_profiles_v6 RENAME TO mcp_provider_profiles;

INSERT INTO mcp_write_operations SELECT * FROM mcp_v6_write_operations;
INSERT INTO mcp_personal_tokens SELECT * FROM mcp_v6_personal_tokens;
INSERT INTO mcp_oauth_authorization_codes SELECT * FROM mcp_v6_oauth_codes;
INSERT INTO mcp_oauth_token_families SELECT * FROM mcp_v6_oauth_families;
INSERT INTO mcp_oauth_token_grants SELECT * FROM mcp_v6_oauth_grants;

DROP TABLE mcp_v6_write_operations;
DROP TABLE mcp_v6_personal_tokens;
DROP TABLE mcp_v6_oauth_codes;
DROP TABLE mcp_v6_oauth_families;
DROP TABLE mcp_v6_oauth_grants;

-- Triggers on the old table were dropped with it.
CREATE TRIGGER mcp_revoke_personal_tokens_after_profile_revoke
AFTER UPDATE OF revoked_at ON mcp_provider_profiles
WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
BEGIN
  UPDATE mcp_personal_tokens
  SET revoked_at = NEW.revoked_at
  WHERE profile_id = NEW.profile_id AND revoked_at IS NULL;
END;

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

CREATE INDEX mcp_provider_profiles_credential_refresh
  ON mcp_provider_profiles (provider, credential_refreshed_at)
  WHERE revoked_at IS NULL;
