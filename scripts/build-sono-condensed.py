# /// script
# requires-python = ">=3.10"
# dependencies = ["fonttools", "brotli"]
# ///
"""Build public/fonts/Sono-Condensed.woff2 from scripts/font-sources/Sono-Variable.woff2.

Upstream Sono is hard to read at body size next to the other faces:

- Its letters are as wide as iA Writer Mono's but 8% shorter (x-height 0.476em
  against 0.516em), so an "o" is wider than it is tall. Matching iA's line
  length forced a small font size and squat letters.
- Its heavy weights are much darker than the other faces' (stem 0.19em at 800,
  where Maple has 0.15em), which closes the counters in headings.

This narrows every glyph to X_SCALE of its width, so the face can run larger at
the same line length, and remaps the weight axis so bold and headings land on
lighter designs. The MONO axis is pinned to 1 (monospaced).

Run: uv run scripts/build-sono-condensed.py
"""

import sys
from pathlib import Path

from fontTools.misc.roundTools import otRound
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables.otBase import BaseTable
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "scripts" / "font-sources" / "Sono-Variable.woff2"
TARGET = ROOT / "public" / "fonts" / "Sono-Condensed.woff2"

X_SCALE = float(sys.argv[1]) if len(sys.argv) > 1 else 0.90
# CSS weight -> upstream weight. Narrowing thins the vertical stems by the same
# factor, so regular text moves up a little to keep its colour; bold and the
# 900 that headings ask for stop well short of upstream's ExtraBold.
WEIGHT_MAP = {200: 200, 400: 430, 700: 640, 800: 700}
if len(sys.argv) > 2:
    WEIGHT_MAP = {200: 200, 400: float(sys.argv[2]), 700: float(sys.argv[3]), 800: float(sys.argv[4])}
if len(sys.argv) > 5:
    TARGET = Path(sys.argv[5])
DESIGN_MAX = WEIGHT_MAP[800]


def sx(value: float) -> int:
    return otRound(value * X_SCALE)


font = TTFont(SOURCE)
font = instantiateVariableFont(font, {"MONO": 1, "wght": (200, 200, DESIGN_MAX)})

glyf = font["glyf"]
for name in font.getGlyphOrder():
    glyph = glyf[name]
    if glyph.isComposite():
        for component in glyph.components:
            component.x = sx(component.x)
    elif glyph.numberOfContours > 0:
        glyph.coordinates.scale((X_SCALE, 1))
        glyph.coordinates.toInt()
    glyph.recalcBounds(glyf)

# gvar deltas cover outline points, component offsets and the four phantom
# points that carry the advance, all as (x, y) pairs.
for variations in font["gvar"].variations.values():
    for variation in variations:
        variation.coordinates = [
            None if delta is None else (sx(delta[0]), delta[1]) for delta in variation.coordinates
        ]

hmtx = font["hmtx"]
for name, (advance, lsb) in hmtx.metrics.items():
    hmtx.metrics[name] = (sx(advance), sx(lsb))

# Advances do not vary once MONO is pinned; gvar's phantom points already say so.
if "HVAR" in font:
    del font["HVAR"]


def scale_positions(obj) -> None:
    """Scale the horizontal fields of GPOS anchors and value records."""
    if isinstance(obj, (list, tuple)):
        for item in obj:
            scale_positions(item)
        return
    if not hasattr(obj, "__dict__"):
        return
    for attr in ("XCoordinate", "XPlacement", "XAdvance"):
        value = getattr(obj, attr, None)
        if isinstance(value, (int, float)):
            setattr(obj, attr, sx(value))
    for value in vars(obj).values():
        if isinstance(value, (BaseTable, list, tuple)) or type(value).__name__ == "ValueRecord":
            scale_positions(value)


scale_positions(font["GPOS"].table.LookupList)

os2 = font["OS/2"]
os2.xAvgCharWidth = sx(os2.xAvgCharWidth)
font["hhea"].advanceWidthMax = sx(font["hhea"].advanceWidthMax)

# Relabel the weight axis in CSS weights and bend it through WEIGHT_MAP.
axis = next(a for a in font["fvar"].axes if a.axisTag == "wght")
design_min = axis.minValue
axis.minValue, axis.defaultValue, axis.maxValue = 200, 200, 800
font["fvar"].instances = []
segments = {-1.0: -1.0, 0.0: 0.0, 1.0: 1.0}
for css_weight, design_weight in WEIGHT_MAP.items():
    segments[round((css_weight - 200) / 600, 4)] = round(
        (design_weight - design_min) / (DESIGN_MAX - design_min), 4
    )
font["avar"] = avar = font["avar"] if "avar" in font else __import__(
    "fontTools.ttLib", fromlist=["newTable"]
).newTable("avar")
avar.segments = {"wght": dict(sorted(segments.items()))}

# STAT stays although it still names upstream's weights: without it Safari
# ignores the weight axis.

font.flavor = "woff2"
TARGET.parent.mkdir(parents=True, exist_ok=True)
font.save(TARGET)
print(f"wrote {TARGET} ({TARGET.stat().st_size} bytes)")
