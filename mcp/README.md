# Rivolo Notes MCP

The local MCP server reads a Markdown export or a local daily notebook folder. Set `RIVOLO_NOTES_FILE` to the file or folder path. Daily folders may store files directly or under year and month directories.

For OneDrive, set `RIVOLO_NOTES_FILE` to the daily notebook folder synced to your computer or to a manual Markdown export.

## Build

```sh
npm run mcp:build
```

## Run

Set `RIVOLO_NOTES_FILE` to your local Rivolo Markdown notebook:

```sh
RIVOLO_NOTES_FILE="/absolute/path/to/inbox.md" npm run mcp:start
```

## MCP Client Config

```json
{
  "mcpServers": {
    "rivolo-notes": {
      "command": "node",
      "args": ["/path/to/rivolo-app/dist-mcp/mcp/index.js"],
      "env": {
        "RIVOLO_NOTES_FILE": "/path/to/inbox.md"
      }
    }
  }
}
```

opencode in ~/.config/opencode/opencode.jsonc

```
{
  "rivolo-notes": {
    "type": "local",
    "command": [
      "env",
      "RIVOLO_NOTES_FILE=/path/to/inbox.md",
      "node",
      "/absolute/path/to/rivolo-app/dist-mcp/mcp/index.js"
    ],
    "enabled": true
  }
}
```

## Tools

- `get_system_prompt`
- `list_days`
- `get_day`
- `search_notes`
- `get_recent_days`
- `list_open_todos`
- `list_tags`
- `list_mentions`

The server has no network listener and no write tools. Access is controlled by the local user account and the configured file path.

## Hosted Worker

Hosted Agent access supports both single-file and daily notebooks on Dropbox
and Google Drive. Upgrading a notebook in Settings moves its Agent profile
after the daily files sync and preserves existing OAuth grants and tokens.
Single-day tools read only that day. On a large daily notebook, use a date range
for searches if an unbounded scan exceeds the deployment's Worker request budget.
OneDrive uses daily folders. After the folder is ready, enable Agent access in Settings. Agent writes notify apps that have the notebook open. If your Microsoft grant expires or is revoked, disable Agent access, reconnect OneDrive, and enable Agent access again.

The hosted endpoint is a separate Cloudflare Worker at `/mcp`. It uses
Streamable HTTP and reads or additively writes the provider target saved by
Rivolo Settings. Clients can authenticate through Rivolo OAuth (`rva_...`
access tokens) or a personal token (`rvl_...`) created in Settings.

Before deploying:

1. Create one D1 database and replace the placeholder database id in both
   `wrangler.toml` (Rivolo Pages Settings APIs) and `wrangler.mcp.toml` (hosted
   MCP Worker). Both services must bind the same database as `MCP_DB`.
2. Apply `migrations/0001` through `0006` to that database.
3. Set Worker secrets:
   - `MCP_PROVIDER_TOKEN_ENCRYPTION_KEY` — exactly the same value used by Pages.
   - `GOOGLE_CLIENT_SECRET`.
   - `ONEDRIVE_CLIENT_SECRET` — the same Microsoft client secret used by Pages.
     The Worker uses it for note requests and for the daily refresh of active
     Agent access profiles.
4. Set the Pages secrets already required by Agent access:
   - `MCP_PROVIDER_TOKEN_ENCRYPTION_KEY`.
   - `MCP_PROFILE_SESSION_ENCRYPTION_KEY`.
   - Provider OAuth/cookie secrets used by the existing sync endpoints.
5. Deploy the OneDrive events Worker in the matching environment so the
   hosted Worker can notify open OneDrive apps through `ONEDRIVE_EVENTS`.
6. Route `mcp.aitlab.it` to the Worker and keep
   `MCP_ALLOWED_ORIGINS` restricted to trusted browser origins. Native MCP
   clients normally omit `Origin`.
7. Configure Cloudflare rate-limit or WAF rules for the OAuth registration,
   token, and authorization endpoints before enabling public OAuth. See
   [`docs/mcp-oauth.md`](../docs/mcp-oauth.md).

`MCP_PROFILE_SESSION_ENCRYPTION_KEY` is a Pages-only browser-session secret.
The Worker must share `MCP_PROVIDER_TOKEN_ENCRYPTION_KEY` with Pages, but does
not need the profile-session secret.

Build the Worker without deploying:

```sh
npm run mcp:worker:build
```
