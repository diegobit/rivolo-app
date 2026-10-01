# Rivolo wordmark: how `public/logo.svg` was traced

The app renders the wordmark from a vector, not a bitmap:

- **`public/logo.svg`** — what the app serves (header logo and empty-state hero).
- **`docs/logo.png`** — the source raster (1188×434, transparent background). Kept only so the
  wordmark can be re-traced and so the README can show it. It is **not** served by the app and
  therefore stays out of the PWA precache.

Why: the PNG drawn at 40 CSS px in the header lost its thin top brush flourishes to
downscaling on iOS (they looked "sfumato"/hazy). A vector scales cleanly at any size.

Size: ~345 KB PNG (incompressible) → 73 KB SVG raw → **~19.5 KB brotli** over the wire.

## Re-trace from scratch

Prerequisites: `potrace`, ImageMagick, and Python 3 with `Pillow` + `numpy`.

Run everything from the repo root; `mask-4x.pbm` and `trace-4x.svg` are temporary.

### 1. Build a 4× alpha mask (subpixel contour) and threshold it

```python
# make-mask.py
from PIL import Image
import numpy as np

im = Image.open('docs/logo.png').getchannel('A')
im = im.resize((4752, 1736), Image.Resampling.BILINEAR)  # 4× the 1188×434 source
mask = np.where(np.array(im) >= 128, 0, 255).astype('uint8')  # 0 = ink, 255 = background
Image.fromarray(mask).convert('1').save('mask-4x.pbm')
```

### 2. Trace the mask

```bash
potrace mask-4x.pbm -s -o trace-4x.svg \
  --turdsize 0 --alphamax 1 --opttolerance 0.05
```

`--turdsize 0` keeps the small flourishes; `--opttolerance 0.05` keeps the curve tight so the
thin strokes survive.

### 3. Normalize into the app's coordinate system

potrace emits paths in tenths of an input pixel with the Y axis pointing up. The mask is 4×
the source, so one source pixel equals 40 potrace units: bake that as a single group transform
(`scale(0.025 -0.025)` = 1/40 with a Y flip). Keeping one transform plus integer coordinates
is what makes the file small — see "Do not optimize with SVGO" below.

```python
# prepare.py
from pathlib import Path
import xml.etree.ElementTree as ET

root = ET.parse('trace-4x.svg').getroot()
ns = '{http://www.w3.org/2000/svg}'
paths = root.findall('.//' + ns + 'path')

svg = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="1188" height="434" viewBox="0 0 1188 434">\n'
    '  <g fill="#23B3FF" stroke="none" transform="translate(0 434) scale(0.025 -0.025)">\n'
)
for p in paths:
    svg += '    <path d="' + p.attrib['d'] + '"/>\n'
svg += '  </g>\n</svg>\n'

Path('public/logo.svg').write_text(svg)
```

`#23B3FF` is the source's flat ink color. `translate(0 434)` moves potrace's origin (bottom-left)
to the SVG origin (top-left).

## Verify the result

Render the SVG at 1188×434 and compare its alpha mask with the source PNG. A good trace stays
at IoU ≥ 99.8% against the PNG (the current file: **99.8965% IoU, MAE 0.626/255**) and looks
identical at the header size (40 CSS px at DPR 3). Playwright's WebKit browser is already
available under `node_modules/`, so:

```js
// render.cjs — svg at native size
const { webkit } = require('playwright')
const fs = require('fs')
const uri = 'data:image/svg+xml;base64,' + fs.readFileSync('public/logo.svg').toString('base64')
;(async () => {
  const b = await webkit.launch()
  const c = await b.newContext({ viewport: { width: 1188, height: 434 }, deviceScaleFactor: 1 })
  const p = await c.newPage()
  await p.setContent(`<style>html,body{margin:0;background:transparent}img{display:block;width:1188px;height:434px}</style><img src="${uri}">`)
  await p.locator('img').evaluate(i => i.decode())
  await p.screenshot({ path: 'svg-full.png', omitBackground: true })
  await b.close()
})()
```

```python
# compare.py
from PIL import Image
import numpy as np

a = np.array(Image.open('docs/logo.png').getchannel('A'), dtype=np.float64) / 255
b = np.array(Image.open('svg-full.png').getchannel('A'), dtype=np.float64) / 255
print('MAE:', np.abs(a - b).mean())
print('IoU:', np.logical_and(a >= .5, b >= .5).sum() / np.logical_or(a >= .5, b >= .5).sum())
```

For a visual check, render PNG and SVG side by side at ~400 px and at 40 CSS px / DPR 3
(magnify the small one with nearest-neighbor).

## Do not "optimize" with SVGO

Tested: SVGO 3.3.5 (`--multipass`) makes this file **bigger** and less portable, because
potrace's integer coordinates plus a single transform are already near-optimal:

- raw 73,497 → 80,050 B (**+8.9%**), brotli 19,499 → 21,522 B (**+10.4%**)
- it bakes the transform into decimal coordinates (`M980.5 17.225 …`) and **drops the `viewBox`**
- at `--precision 1`/`2` it removes the transform *and* the viewBox without baking the
  coordinates, producing a broken render

If a smaller file is ever really needed, the only real lever is reducing the node count
(geometry simplification), which risks changing the silhouette.

## Known limits

This is a machine trace, not a designer vector: 9 disconnected paths and roughly 4.4k curve
segments, with no semantic structure (letters are not named objects). It reproduces the
silhouette but not the PNG's slight alpha/color variation. If the wordmark is ever redesigned,
re-run this process — or, better, replace it with the original vector from the designer.
