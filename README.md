<p align="center">
  <img src="public/logo.png" alt="Rivolo" width="180" />
</p>

<p align="center"><em>The no-notes notes app 💧</em></p>

Rivolo (REE-voh-loh) is the Italian word for "small stream". Every day, you write your thoughts, ideas, notes and todos without organizing anything. Whenever you need to find something complex, just ask the LLM to surface what you need.

Try it here: [rivolo.app](https://rivolo.app)

Rivolo is a local-first PWA deployed on Cloudflare Pages. Notes, settings, AI requests, and cloud file transfers run in the browser. A small same-origin Pages Function is used only to exchange and refresh Google Drive OAuth credentials; it never receives note contents. AI prompts and relevant notes are sent only when you ask, directly to the provider you select: Gemini, Anthropic, OpenAI, or your own OpenAI-compatible endpoint. Dropbox or Google Drive receives notes only if you enable that sync provider. Custom endpoints must be reachable from the device and allow Rivolo's browser origin, headers, and HTTPS connection; on a phone, `localhost` refers to the phone itself.

> [!NOTE]
> The app was completely developed with coding agents. I use it daily. I wrote about this [here](https://diegobit.com/post/rivolo).

## MCP

Rivolo includes a local read-only MCP server for querying your exported notes from other AI tools. Build it with `npm run mcp:build`, then point your MCP client at `dist-mcp/mcp/index.js` with `RIVOLO_NOTES_FILE` set to your local Rivolo markdown file.

## Run

```bash
npm install
npm run dev
```

The Vite server is sufficient unless you are testing Google Drive authentication. To run the built app and its Pages Functions together:

```bash
npm run build
npx wrangler pages dev dist
```

## Build

```bash
npm run build
npm run preview
```

## Optional env vars

```bash
VITE_DROPBOX_CLIENT_ID=...
VITE_DEBUG_LOGS=true
```

## Google Drive sync configuration

Create a Google Cloud OAuth web client, enable the Google Drive API, and add the production and local Pages origins as authorized JavaScript origins. Rivolo requests only the `drive.file` scope and manages a visible `/rivolo/inbox.md` file created by the app.

The Pages Function requires these server-side credentials. For local development, copy `.dev.vars.example` to `.dev.vars`; upload the same names as encrypted Cloudflare Pages secrets in production.

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_TOKEN_ENCRYPTION_KEY=...
```

Allowed origins are environment-specific non-secret configuration in `wrangler.toml`: local development accepts `http://localhost:8788`, while production accepts `https://rivolo.app`.

`GOOGLE_TOKEN_ENCRYPTION_KEY` should be a high-entropy random secret. Neither the client secret nor the encryption key may use a `VITE_` prefix. If the OAuth consent screen remains in External/Testing mode, Google refresh grants can expire after seven days; publish the consent configuration before relying on long-lived production sync.

## Credits

UI icons are from Phosphor Icons: https://phosphoricons.com/
