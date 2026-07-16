# Rivolo Notes MCP

Local read-only MCP server for Rivolo notes. It reads the same single markdown file used by Dropbox sync, with entries separated by `<!-- day:YYYY-MM-DD -->` markers.

## Build

```sh
npm run mcp:build
```

## Run

Set `RIVOLO_NOTES_FILE` to your local Dropbox-synced Rivolo markdown file:

```sh
RIVOLO_NOTES_FILE="/Users/diego/Dropbox/path/to/inbox.md" npm run mcp:start
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
      "/Users/diego/code/dg/rivolo-app/dist-mcp/mcp/index.js"
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

The hosted endpoint is a separate Cloudflare Worker at `/mcp`. It uses
Streamable HTTP, authenticates `Authorization: Bearer rvl_...` personal tokens,
and reads or additively writes the provider target saved by Rivolo Settings.

Before deploying:

1. Create one D1 database and replace the placeholder database id in both
   `wrangler.toml` (Rivolo Pages Settings APIs) and `wrangler.mcp.toml` (hosted
   MCP Worker). Both services must bind the same database as `MCP_DB`.
2. Apply `migrations/0001` through `0003` to that database.
3. Set Worker secrets:
   - `MCP_PROVIDER_TOKEN_ENCRYPTION_KEY` — exactly the same value used by Pages.
   - `GOOGLE_CLIENT_SECRET`.
4. Set the Pages secrets already required by Agent access:
   - `MCP_PROVIDER_TOKEN_ENCRYPTION_KEY`.
   - `MCP_PROFILE_SESSION_ENCRYPTION_KEY`.
   - Provider OAuth/cookie secrets used by the existing sync endpoints.
5. Route `mcp.rivolo.app` to the Worker and keep
   `MCP_ALLOWED_ORIGINS` restricted to trusted browser origins. Native MCP
   clients normally omit `Origin`.

Build the Worker without deploying:

```sh
npm run mcp:worker:build
```
