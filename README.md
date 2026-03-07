<p align="center">
  <img src="public/logo.png" alt="Rivolo" width="180" />
</p>

<p align="center"><em>The no-notes notes app.</em></p>

Rivolo (REE-voh-loh) is the Italian word for "small stream". Every day, you write your thoughts, ideas, notes and todos without organizing anything. Whenever you need to find something complex, just ask the LLM to surface what you need.

Try it here: [rivolo.app](https://rivolo.app)

Rivolo is a static web app that runs entirely in your browser (no backend). The production app is deployed on Cloudflare Pages. The only data you "share" is with Gemini, through its APIs, and Dropbox, if you choose to enable syncing.

> [!NOTE]
> The app was completely developed with coding agents. I use it daily. I wrote about this [here](https://diegobit.com/post/rivolo).

## Run

```bash
npm install
npm run dev
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
