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
