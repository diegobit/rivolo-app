CREATE TABLE mcp_provider_profiles (
  profile_id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('dropbox', 'google-drive')),
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
  UNIQUE (provider, provider_account_id),
  CHECK (
    (
      provider = 'dropbox'
      AND dropbox_path IS NOT NULL
      AND google_file_id IS NULL
      AND google_folder_id IS NULL
      AND google_file_name IS NULL
    )
    OR
    (
      provider = 'google-drive'
      AND dropbox_path IS NULL
      AND google_file_id IS NOT NULL
      AND google_file_name IS NOT NULL
    )
  )
);
