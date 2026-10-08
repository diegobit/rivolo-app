#!/usr/bin/env node

/**
 * scripts/drive-browser.mjs
 *
 * General-purpose browser automation script using Playwright.
 * Allows an AI agent or developer to drive the app in Chromium:
 * open a page, resize viewport (desktop/narrow), click elements, type text,
 * and save PNG screenshots to disk.
 *
 * Usage examples:
 *   # Desktop viewport screenshot:
 *   node scripts/drive-browser.mjs --url http://localhost:5174/ --viewport 1440x900 --output screenshots/desktop.png
 *
 *   # Narrow mobile viewport screenshot:
 *   node scripts/drive-browser.mjs --url http://localhost:5174/ --viewport 520x900 --output screenshots/mobile.png
 *
 *   # Interactive actions (click, type, wait, screenshot):
 *   node scripts/drive-browser.mjs \
 *     --url http://localhost:5174/ \
 *     --viewport 1440x900 \
 *     --click "text=Start Today" \
 *     --wait 500 \
 *     --type ".cm-content=Hello from automation" \
 *     --output screenshots/timeline-note.png
 *
 *   # JSON action list:
 *   node scripts/drive-browser.mjs --actions '[
 *     {"type": "goto", "url": "http://localhost:5174/"},
 *     {"type": "viewport", "width": 1440, "height": 900},
 *     {"type": "click", "selector": "text=Start Today"},
 *     {"type": "type", "selector": ".cm-content", "text": "Documented agent interaction"},
 *     {"type": "screenshot", "path": "screenshots/action-list.png"}
 *   ]'
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const HELP_TEXT = `
drive-browser.mjs - Drive web applications in Chromium with Playwright

USAGE:
  node scripts/drive-browser.mjs [options]
  npm run browser -- [options]

OPTIONS:
  --url <url>              Target URL to navigate to (default: http://localhost:5174/)
  --viewport <WxH>         Viewport dimensions, e.g. 1440x900 or 520x900 (default: 1440x900)
  --width <px>             Explicit viewport width (overrides --viewport)
  --height <px>            Explicit viewport height (overrides --viewport)
  --output, -o <path>      Output path for saving screenshot PNG
  --full-page              Capture full scrollable page screenshot
  --wait-until <state>     Navigation wait condition: load, domcontentloaded, networkidle, commit (default: networkidle)
  --wait <ms>              Wait time in milliseconds (e.g. after actions or before screenshot)
  --wait-for <selector>    Wait for an element selector to become visible
  --timeout <ms>           Action/navigation timeout in milliseconds (default: 30000)
  --click <selector>       Click selector (repeatable)
  --fill <sel=text>        Fill input/textarea with text (repeatable; format: selector=text)
  --type <sel=text>        Click and type character-by-character (repeatable; format: selector=text)
  --press <key>            Press a key on the keyboard, e.g. Enter, Tab, Escape (repeatable)
  --action <spec>          Shorthand action step (repeatable):
                           goto:<url> | viewport:<WxH> | wait:<ms> | wait-for:<sel> |
                           click:<sel> | fill:<sel>=<text> | type:<sel>=<text> |
                           press:<key> | screenshot:<path>
  --actions <json>         JSON string containing array of action objects
  --actions-file <file>    Path to JSON file containing array of action objects
  --headed                 Run browser in visible (headed) mode (default: headless)
  --no-headless            Alias for --headed
  --help, -h               Show this help message

EXAMPLES:
  # 1. Desktop screenshot
  node scripts/drive-browser.mjs --url http://localhost:5174/ --viewport 1440x900 -o screenshots/desktop.png

  # 2. Narrow mobile screenshot
  node scripts/drive-browser.mjs --url http://localhost:5174/ --viewport 520x900 -o screenshots/narrow.png

  # 3. Interactive flow: click button, wait, type text into editor, take screenshot
  node scripts/drive-browser.mjs \\
    --url http://localhost:5174/ \\
    --viewport 1440x900 \\
    --click "text=Start Today" \\
    --wait 500 \\
    --type ".cm-content=First note from agent" \\
    --output screenshots/after-typing.png

  # 4. Multi-step scripted workflow via JSON:
  node scripts/drive-browser.mjs --actions '[
    {"type": "goto", "url": "http://localhost:5174/"},
    {"type": "viewport", "width": 1440, "height": 900},
    {"type": "click", "selector": "text=Start Today"},
    {"type": "screenshot", "path": "screenshots/step1.png"},
    {"type": "type", "selector": ".cm-content", "text": "Second note"},
    {"type": "screenshot", "path": "screenshots/step2.png"}
  ]'
`;

function parseViewport(str) {
  if (!str) return null;
  const match = String(str).trim().match(/^(\d+)x(\d+)$/i);
  if (!match) {
    throw new Error(`Invalid viewport format "${str}". Expected format: <width>x<height>, e.g. 1440x900 or 520x900`);
  }
  return {
    width: parseInt(match[1], 10),
    height: parseInt(match[2], 10),
  };
}

function parseKeyValue(str) {
  const eqIdx = str.indexOf('=');
  if (eqIdx !== -1) {
    return { selector: str.slice(0, eqIdx).trim(), text: str.slice(eqIdx + 1) };
  }
  const colIdx = str.indexOf(':');
  if (colIdx !== -1) {
    return { selector: str.slice(0, colIdx).trim(), text: str.slice(colIdx + 1) };
  }
  throw new Error(`Invalid selector=text format: "${str}". Expected "selector=text" or "selector:text"`);
}

function parseShorthandAction(actionStr) {
  const colonIdx = actionStr.indexOf(':');
  if (colonIdx === -1) {
    throw new Error(`Invalid --action format "${actionStr}". Expected action:value (e.g. click:button, wait:500)`);
  }
  const type = actionStr.slice(0, colonIdx).trim().toLowerCase();
  const value = actionStr.slice(colonIdx + 1).trim();

  switch (type) {
    case 'goto':
      return { type: 'goto', url: value };
    case 'viewport': {
      const vp = parseViewport(value);
      return { type: 'viewport', ...vp };
    }
    case 'wait':
      return { type: 'wait', ms: parseInt(value, 10) };
    case 'wait-for':
      return { type: 'wait-for', selector: value };
    case 'click':
      return { type: 'click', selector: value };
    case 'fill': {
      const { selector, text } = parseKeyValue(value);
      return { type: 'fill', selector, text };
    }
    case 'type': {
      const { selector, text } = parseKeyValue(value);
      return { type: 'type', selector, text };
    }
    case 'press':
      return { type: 'press', key: value };
    case 'screenshot':
      return { type: 'screenshot', path: value };
    default:
      throw new Error(`Unknown shorthand action type "${type}". Supported: goto, viewport, wait, wait-for, click, fill, type, press, screenshot`);
  }
}

async function executeAction(page, action, defaultTimeout) {
  const timeout = action.timeout || defaultTimeout;

  switch (action.type) {
    case 'goto': {
      const url = action.url;
      const waitUntil = action.waitUntil || 'networkidle';
      console.log(`[drive-browser] Navigating to: ${url} (waitUntil: ${waitUntil})`);
      await page.goto(url, { waitUntil, timeout });
      break;
    }

    case 'viewport': {
      const { width, height } = action;
      console.log(`[drive-browser] Resizing viewport to: ${width}x${height}`);
      await page.setViewportSize({ width, height });
      break;
    }

    case 'wait': {
      const ms = action.ms || 0;
      console.log(`[drive-browser] Waiting ${ms}ms...`);
      await page.waitForTimeout(ms);
      break;
    }

    case 'wait-for': {
      const selector = action.selector;
      const state = action.state || 'visible';
      console.log(`[drive-browser] Waiting for selector "${selector}" (state: ${state})...`);
      await page.locator(selector).first().waitFor({ state, timeout });
      break;
    }

    case 'click': {
      const selector = action.selector;
      console.log(`[drive-browser] Clicking: "${selector}"`);
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout });
      await locator.click({ timeout });
      break;
    }

    case 'fill': {
      const { selector, text } = action;
      console.log(`[drive-browser] Filling "${selector}" with "${text}"`);
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout });
      try {
        await locator.fill(text, { timeout });
      } catch {
        // Fallback for non-standard inputs / contenteditable divs
        await locator.click({ timeout });
        await locator.pressSequentially(text, { delay: action.delay || 10 });
      }
      break;
    }

    case 'type': {
      const { selector, text, delay = 15 } = action;
      console.log(`[drive-browser] Typing into "${selector}": "${text}"`);
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout });
      await locator.click({ timeout });
      await locator.pressSequentially(text, { delay });
      break;
    }

    case 'press': {
      const key = action.key;
      console.log(`[drive-browser] Pressing key: "${key}"`);
      await page.keyboard.press(key);
      break;
    }

    case 'screenshot': {
      const targetPath = action.path;
      const fullPage = Boolean(action.fullPage);
      const resolved = path.resolve(process.cwd(), targetPath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      console.log(`[drive-browser] Taking screenshot (fullPage: ${fullPage}) -> ${resolved}`);
      await page.screenshot({ path: resolved, fullPage });
      const stats = fs.statSync(resolved);
      console.log(`[drive-browser] Screenshot written: ${resolved} (${stats.size} bytes)`);
      break;
    }

    case 'evaluate': {
      console.log(`[drive-browser] Evaluating script on page`);
      const result = await page.evaluate(action.expression || action.fn);
      if (result !== undefined) {
        console.log(`[drive-browser] Evaluation result:`, result);
      }
      break;
    }

    default:
      throw new Error(`Unrecognized action type "${action.type}"`);
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      url: { type: 'string' },
      viewport: { type: 'string' },
      width: { type: 'string' },
      height: { type: 'string' },
      output: { type: 'string', short: 'o' },
      'full-page': { type: 'boolean' },
      'wait-until': { type: 'string' },
      wait: { type: 'string' },
      'wait-for': { type: 'string' },
      timeout: { type: 'string' },
      click: { type: 'string', multiple: true },
      fill: { type: 'string', multiple: true },
      type: { type: 'string', multiple: true },
      press: { type: 'string', multiple: true },
      action: { type: 'string', multiple: true },
      actions: { type: 'string' },
      'actions-file': { type: 'string' },
      headless: { type: 'boolean', default: true },
      headed: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: false,
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP_TEXT.trim());
    process.exit(0);
  }

  // Viewport resolution
  let width = 1440;
  let height = 900;
  if (values.viewport) {
    const vp = parseViewport(values.viewport);
    width = vp.width;
    height = vp.height;
  }
  if (values.width) width = parseInt(values.width, 10);
  if (values.height) height = parseInt(values.height, 10);

  // URL resolution (support positional if starts with http)
  let url = values.url;
  if (!url && positionals.length > 0 && /^https?:\/\//i.test(positionals[0])) {
    url = positionals[0];
  }
  if (!url) {
    url = 'http://localhost:5174/';
  }

  // Output resolution
  let output = values.output;
  if (!output && positionals.length > 1 && !values.url) {
    output = positionals[1];
  } else if (!output && positionals.length > 0 && values.url) {
    output = positionals[0];
  }

  const waitUntil = values['wait-until'] || 'networkidle';
  const timeout = values.timeout ? parseInt(values.timeout, 10) : 30000;
  const isHeadless = !(values.headed || values['no-headless'] || values.headless === false);

  // Build the list of actions
  const actionsList = [];

  // Check if full actions file or JSON string was provided
  if (values['actions-file']) {
    const filePath = path.resolve(process.cwd(), values['actions-file']);
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      throw new Error(`Content of actions file "${filePath}" must be a JSON array of actions`);
    }
    actionsList.push(...parsed);
  } else if (values.actions) {
    const parsed = JSON.parse(values.actions);
    if (!Array.isArray(parsed)) {
      throw new Error(`--actions value must be a JSON array of actions`);
    }
    actionsList.push(...parsed);
  } else if (values.action && values.action.length > 0) {
    for (const act of values.action) {
      actionsList.push(parseShorthandAction(act));
    }
  } else {
    // Construct sequential actions from individual flags
    actionsList.push({ type: 'goto', url, waitUntil });

    if (values['wait-for']) {
      actionsList.push({ type: 'wait-for', selector: values['wait-for'] });
    }

    if (values.click) {
      for (const selector of values.click) {
        actionsList.push({ type: 'click', selector });
      }
    }

    if (values.fill) {
      for (const item of values.fill) {
        const { selector, text } = parseKeyValue(item);
        actionsList.push({ type: 'fill', selector, text });
      }
    }

    if (values.type) {
      for (const item of values.type) {
        const { selector, text } = parseKeyValue(item);
        actionsList.push({ type: 'type', selector, text });
      }
    }

    if (values.press) {
      for (const key of values.press) {
        actionsList.push({ type: 'press', key });
      }
    }

    if (values.wait) {
      actionsList.push({ type: 'wait', ms: parseInt(values.wait, 10) });
    }
  }

  // If output screenshot is specified and not already in actions, append it
  if (output) {
    actionsList.push({
      type: 'screenshot',
      path: output,
      fullPage: Boolean(values['full-page']),
    });
  }

  console.log(`[drive-browser] Starting Chromium (${isHeadless ? 'headless' : 'headed'}, initial viewport: ${width}x${height})`);

  const browser = await chromium.launch({ headless: isHeadless });
  try {
    const context = await browser.newContext({
      viewport: { width, height },
    });
    const page = await context.newPage();

    for (let i = 0; i < actionsList.length; i++) {
      const action = actionsList[i];
      await executeAction(page, action, timeout);
    }

    console.log(`[drive-browser] Successfully completed all actions (${actionsList.length} step(s)).`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`[drive-browser] ERROR:`, err);
  process.exit(1);
});
