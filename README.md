<p align="center">
  <img src="public/logo.png" alt="Rivolo" width="180" />
</p>

<p align="center"><em>The no-notes notes app 💧</em></p>

Rivolo (REE-voh-loh) is the Italian word for "small stream". Every day, you write your thoughts, ideas, notes and todos without organizing anything. Whenever you need to find something complex, just ask the LLM to surface what you need.

Try it here: [rivolo.app](https://rivolo.app)

Rivolo is a local-first PWA deployed on Cloudflare Pages. Notes, settings, AI requests, and cloud file transfers run in the browser. A small same-origin Pages Function is used only to exchange and refresh Google Drive and Dropbox OAuth credentials; it never receives note contents. AI prompts and relevant notes are sent only when you ask, directly to the provider you select: Gemini, Anthropic, OpenAI, or your own OpenAI-compatible endpoint. Dropbox or Google Drive receives notes only if you enable that sync provider. Custom endpoints must be reachable from the device and allow Rivolo's browser origin, headers, and HTTPS connection; on a phone, `localhost` refers to the phone itself.

> [!NOTE]
> The app was completely developed with coding agents. I use it daily. I wrote about this [here](https://diegobit.com/post/rivolo).

## MCP

Rivolo includes a local read-only MCP server for querying your exported notes from other AI tools. Build it with `npm run mcp:build`, then point your MCP client at `dist-mcp/mcp/index.js` with `RIVOLO_NOTES_FILE` set to your local Rivolo markdown file.

## Run

```bash
npm install
npm run dev
```

The Vite server is sufficient unless you are testing Google Drive or Dropbox authentication. To run the built app and its Pages Functions together:

```bash
npm run build
npx wrangler pages dev dist
```

## Build

```bash
npm run build
npm run preview
```

## Cloud sync setup

> Only needed if you run your own copy of Rivolo and want Google Drive or Dropbox sync. The hosted app at [rivolo.app](https://rivolo.app) already has this configured — nothing to do.

Both providers work the same way. Two kinds of values:

- **Public** (client ids, allowed origins) — kept in `wrangler.toml`, already committed for `localhost` and `rivolo.app`. Swap in your own ids there.
- **Secret** (client secrets, encryption keys) — never in the repo. Put them in a local `.dev.vars` file for development, and add them as encrypted secrets in the Cloudflare Pages dashboard for production. Start from `.dev.vars.example`. Any long random string works for the encryption keys.

### Google Drive

Create a Google Cloud OAuth web client, enable the Google Drive API, and list your app's origins (`localhost` and your domain) as authorized JavaScript origins. Rivolo asks only for the `drive.file` scope and manages a single `/rivolo/inbox.md` file.

Secrets you'll need:

```bash
GOOGLE_CLIENT_SECRET=...
GOOGLE_TOKEN_ENCRYPTION_KEY=...
```

One gotcha: if the Google consent screen stays in Testing mode, sign-ins expire after seven days. Publish it before relying on sync.

### Dropbox

Create a Dropbox app with `files.content.read` and `files.content.write` access, and add your callback URLs (`https://rivolo.app/auth/dropbox/callback` and the `localhost` equivalent). Dropbox needs no client secret — just one encryption key:

```bash
DROPBOX_TOKEN_ENCRYPTION_KEY=...
```

## Debugging

Set `VITE_DEBUG_LOGS=true` to enable verbose logging.

## Credits

UI icons are from Phosphor Icons: https://phosphoricons.com/
