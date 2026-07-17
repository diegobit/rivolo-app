<p align="center">
  <img src="public/logo.png" alt="Rivolo" width="180" />
</p>

<p align="center"><em>The no-notes notes app 💧</em></p>

Rivolo (REE-voh-loh) is the Italian word for "small stream". Every day, you write your thoughts, ideas, notes and todos without organizing anything. Whenever you need to find something complex, just ask the LLM to surface what you need.

Try it here: [rivolo.app](https://rivolo.app)

Rivolo is a local-first PWA deployed on Cloudflare Pages. Notes, settings, AI requests, and cloud file transfers normally run in the browser. Same-origin Pages Functions exchange and refresh Google Drive and Dropbox OAuth credentials; normal browser sync does not send note contents through Rivolo's backend. AI prompts and relevant notes are sent only when you ask, directly to the provider you select: Gemini, Anthropic, OpenAI, or your own OpenAI-compatible endpoint. Dropbox or Google Drive receives notes only if you enable that sync provider. Custom endpoints must be reachable from the device and allow Rivolo's browser origin, headers, and HTTPS connection; on a phone, `localhost` refers to the phone itself.

Hosted MCP Agent access is optional and changes that boundary: when a user enables it in Settings, Rivolo stores an encrypted provider credential and target metadata in Cloudflare D1. The authenticated MCP Worker then downloads and, for additive tools, uploads that user's configured cloud Markdown file. D1 stores credentials, profiles, tokens, and operation metadata—not the notes themselves.

> [!NOTE]
> The app was completely developed with coding agents. I use it daily. I wrote about this [here](https://diegobit.com/post/rivolo).

## MCP

Rivolo supports two MCP modes:

- **Local:** a read-only stdio server that queries a local Rivolo Markdown file. Build it with `npm run mcp:build`, then point your MCP client at `dist-mcp/mcp/index.js` with `RIVOLO_NOTES_FILE` set to the file.
- **Hosted:** a multi-user Streamable HTTP server at `https://mcp.rivolo.app/mcp`. Each user enables Agent access for their active Dropbox or Google Drive profile in Rivolo Settings. Clients authenticate with Rivolo OAuth or a personal access token created in Settings. Hosted writes are additive: append by default, with optional prepend; they never replace or delete a day.

The hosted server reads only the last cloud-synced state. It exposes the local read tools plus `add_to_day` and `add_to_today`, and uses durable `operation_id` replay protection for writes. See [the MCP guide](mcp/README.md) for tools and local client configuration, and [the OAuth notes](docs/mcp-oauth.md) for the hosted authorization design.

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

## Hosted MCP deployment

> Only needed when self-hosting the online, multi-user MCP server. The Pages app and MCP Worker must use the same D1 database and the same `MCP_PROVIDER_TOKEN_ENCRYPTION_KEY`.

### 1. Verify and build

```bash
npx wrangler whoami
npm test
npm run lint
npm run build
npm run mcp:build
npm run mcp:worker:build
```

### 2. Create and configure D1

Create the database:

```bash
npx wrangler d1 create rivolo-mcp
```

Copy the returned `database_id` into all three D1 binding blocks:

- the top-level `MCP_DB` binding in `wrangler.toml`;
- the production `MCP_DB` binding in `wrangler.toml`;
- the `MCP_DB` binding in `wrangler.mcp.toml`.

All three entries must contain the same production database ID. Do not deploy while the placeholder `00000000-0000-0000-0000-000000000000` remains.

### 3. Apply and verify migrations

List the pending migrations, apply them remotely, then confirm that none remain:

```bash
npx wrangler d1 migrations list MCP_DB --remote --config wrangler.mcp.toml
npx wrangler d1 migrations apply MCP_DB --remote --config wrangler.mcp.toml
npx wrangler d1 migrations list MCP_DB --remote --config wrangler.mcp.toml
```

The initial deployment applies `migrations/0001` through `0004`. Wrangler asks for confirmation and captures a backup before applying migrations. Verify the resulting schema and foreign keys:

```bash
npx wrangler d1 execute MCP_DB --remote --config wrangler.mcp.toml --command "SELECT name, type FROM sqlite_master WHERE name LIKE 'mcp_%' ORDER BY type, name;"
npx wrangler d1 execute MCP_DB --remote --config wrangler.mcp.toml --command "PRAGMA foreign_key_check;"
```

`PRAGMA foreign_key_check` should return no rows. For future releases, commit a new numbered migration and run the same `list` → `apply` → `list` sequence before deploying code that depends on it. Never edit a migration that has already been applied in production.

### 4. Configure secrets

Generate two different high-entropy values and save them in a password manager. `MCP_PROVIDER_TOKEN_ENCRYPTION_KEY` must be identical on Pages and the Worker; `MCP_PROFILE_SESSION_ENCRYPTION_KEY` belongs only to Pages.

```bash
openssl rand -base64 48
openssl rand -base64 48
npx wrangler pages secret put MCP_PROVIDER_TOKEN_ENCRYPTION_KEY --project-name rivolo
npx wrangler pages secret put MCP_PROFILE_SESSION_ENCRYPTION_KEY --project-name rivolo
```

The two `secret put` commands prompt for the values. Paste the first generated value for `MCP_PROVIDER_TOKEN_ENCRYPTION_KEY` and the second for `MCP_PROFILE_SESSION_ENCRYPTION_KEY`.

Deploy the Worker once, without attaching its public custom domain yet, and then set its secrets:

```bash
npx wrangler deploy --config wrangler.mcp.toml
npx wrangler secret put MCP_PROVIDER_TOKEN_ENCRYPTION_KEY --config wrangler.mcp.toml
npx wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.mcp.toml
```

Paste the same first generated value when the Worker prompts for `MCP_PROVIDER_TOKEN_ENCRYPTION_KEY`. The last command prompts for the existing Google OAuth client secret. Cloudflare does not reveal existing secret values, so keep the source value in a password manager or local untracked `.dev.vars` file. Dropbox does not require a client secret.

### 5. Protect the OAuth endpoints

Before public rollout, configure Cloudflare WAF or rate-limiting rules for:

- `/api/mcp/oauth/register`—the strictest rule, because successful requests create D1 rows;
- `/api/mcp/oauth/token`—protect against credential guessing and refresh-token abuse;
- `/api/mcp/oauth/authorize`—limit automated consent/request abuse.

Also arrange periodic deletion of expired authorization codes and old revoked token families. Application validation remains required; edge rules are an additional abuse boundary.

### 6. Route and deploy

Attach `mcp.rivolo.app` as a custom domain for the `rivolo-mcp` Worker. Keep `MCP_ALLOWED_ORIGINS` restricted to trusted browser origins; native MCP clients normally omit the `Origin` header.

This repository uses Git-integrated Pages deployments: `dev` creates a preview and `main` deploys production. Push and verify `dev` first, then promote the same commit to `main`.

```bash
git push origin dev
# Verify the Cloudflare Pages preview build and Worker discovery/auth behavior.
git switch main
git merge --ff-only dev
git push origin main
git switch dev
```

### 7. Smoke-test production

Verify these URLs first:

- `https://mcp.rivolo.app/.well-known/oauth-protected-resource/mcp` returns protected-resource metadata;
- an unauthenticated request to `https://mcp.rivolo.app/mcp` returns `401` with a `WWW-Authenticate` discovery challenge;
- `https://rivolo.app/.well-known/oauth-authorization-server/api/mcp/oauth` returns authorization-server metadata.

Then enable Agent access in Rivolo Settings and test both authentication paths:

1. create a personal token and connect a client with `Authorization: Bearer rvl_...`;
2. connect an OAuth-capable client and complete the Rivolo consent screen;
3. run a representative read, append, prepend, and repeated `operation_id` call;
4. verify the app sees the cloud edit when it returns to the foreground;
5. repeat with disposable Dropbox and Google Drive accounts before broad rollout.

Do not log bearer tokens, OAuth codes, provider refresh tokens, or note contents. Revoking Agent access destroys the stored provider credential and revokes its personal tokens and OAuth grants.

## Debugging

Set `VITE_DEBUG_LOGS=true` to enable verbose logging.

## Credits

UI icons are from Phosphor Icons: https://phosphoricons.com/
