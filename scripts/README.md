# Browser Automation (`scripts/drive-browser.mjs`)

Repeatable, lightweight browser automation tool powered by Playwright to drive the application in a real Chromium browser, test responsive layouts, perform interactive operations (clicking elements, typing text), and capture screenshots to disk.

## Overview

The automation entry point is:
- Direct: `node scripts/drive-browser.mjs [options]`
- Via npm: `npm run browser -- [options]`

It targets the running Vite dev server (default `http://localhost:5174/`) without restarting or resetting state, executes headless by default, and outputs screenshots to gitignored locations like `screenshots/`.

## Prerequisites

Playwright is installed as a devDependency. If running on a new machine or environment:
```bash
npm i -D playwright
npx playwright install chromium
```

## Quick Start Examples

### 1. Capture Desktop Viewport (1440x900)
```bash
node scripts/drive-browser.mjs --url http://localhost:5174/ --viewport 1440x900 --output screenshots/desktop.png
```

### 2. Capture Narrow Mobile Viewport (520x900)
```bash
node scripts/drive-browser.mjs --url http://localhost:5174/ --viewport 520x900 --output screenshots/mobile.png
```

### 3. Click Elements & Type Text
Drive the app interactively: click elements (by CSS selector, text, or accessibility locator), type into inputs or CodeMirror editors, wait for UI updates, and save a screenshot:
```bash
node scripts/drive-browser.mjs \
  --url http://localhost:5174/ \
  --viewport 1440x900 \
  --click "text=Start Today" \
  --wait 500 \
  --type ".cm-content=First automated journal entry" \
  --output screenshots/after-typing.png
```

### 4. Multi-Step Workflows via JSON (`--actions`)
For complex or branching sequences, pass a JSON array of steps:
```bash
node scripts/drive-browser.mjs --actions '[
  {"type": "goto", "url": "http://localhost:5174/"},
  {"type": "viewport", "width": 1440, "height": 900},
  {"type": "click", "selector": "text=Start Today"},
  {"type": "screenshot", "path": "screenshots/timeline-empty.png"},
  {"type": "type", "selector": ".cm-content", "text": "Note from AI agent"},
  {"type": "screenshot", "path": "screenshots/timeline-filled.png"}
]'
```
Or store them in a JSON file:
```bash
node scripts/drive-browser.mjs --actions-file path/to/actions.json
```

### 5. Multi-Step Workflows via Shorthand `--action`
```bash
node scripts/drive-browser.mjs \
  --action goto:http://localhost:5174/ \
  --action viewport:520x900 \
  --action click:text=Start Today \
  --action wait:500 \
  --action screenshot:screenshots/mobile-timeline.png
```

## CLI Reference

| Flag | Type | Description | Default |
|------|------|-------------|---------|
| `--url <url>` | string | Target URL to navigate to | `http://localhost:5174/` |
| `--viewport <WxH>` | string | Viewport dimensions (`<width>x<height>`) | `1440x900` |
| `--width <px>` | number | Explicit viewport width in pixels | `1440` |
| `--height <px>` | number | Explicit viewport height in pixels | `900` |
| `--output, -o <path>` | string | Output path for screenshot PNG | none |
| `--full-page` | boolean | Capture full scrollable page | `false` |
| `--wait-until <event>` | string | Navigation condition (`load`, `domcontentloaded`, `networkidle`) | `networkidle` |
| `--wait <ms>` | number | Wait duration in milliseconds | `0` |
| `--wait-for <selector>` | string | Wait for element selector to be visible | none |
| `--timeout <ms>` | number | Navigation/action timeout in milliseconds | `30000` |
| `--click <selector>` | string (repeatable) | Click an element selector | none |
| `--fill <sel=text>` | string (repeatable) | Fill input/textarea with text | none |
| `--type <sel=text>` | string (repeatable) | Click element and type character-by-character | none |
| `--press <key>` | string (repeatable) | Press keyboard key (e.g. `Enter`, `Tab`) | none |
| `--action <spec>` | string (repeatable) | Shorthand action step (`goto:`, `viewport:`, `click:`, etc.) | none |
| `--actions <json>` | string | JSON string containing array of action objects | none |
| `--actions-file <file>` | string | Path to JSON file containing array of action objects | none |
| `--headed` | boolean | Run browser visibly (not headless) | `false` |
| `--help, -h` | boolean | Display help message and exit | none |

## Supported Action Types in JSON

- **`goto`**: `{ "type": "goto", "url": "...", "waitUntil": "networkidle" }`
- **`viewport`**: `{ "type": "viewport", "width": 1440, "height": 900 }`
- **`wait`**: `{ "type": "wait", "ms": 500 }`
- **`wait-for`**: `{ "type": "wait-for", "selector": "...", "state": "visible" }`
- **`click`**: `{ "type": "click", "selector": "..." }`
- **`fill`**: `{ "type": "fill", "selector": "...", "text": "..." }`
- **`type`**: `{ "type": "type", "selector": "...", "text": "...", "delay": 15 }`
- **`press`**: `{ "type": "press", "key": "Enter" }`
- **`screenshot`**: `{ "type": "screenshot", "path": "screenshots/...", "fullPage": false }`
- **`evaluate`**: `{ "type": "evaluate", "expression": "..." }`
