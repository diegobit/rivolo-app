# /// script
# requires-python = ">=3.10"
# dependencies = ["fonttools", "brotli"]
# ///
"""Build public/fonts/BuenaMono-Digits.woff2 from BuenaMono-Variable.woff2.

Buena Mono 1.240 draws 0-9 about 12 units thinner than its letters at every
weight (70 against 82 at Regular), so numbers look light inside text. This
cuts a digits-only copy whose weight axis is shifted until the digit stems
match the letter stems. index.css layers it over Buena with unicode-range.

Run: uv run scripts/build-buena-digits.py
"""

from pathlib import Path

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont, newTable
from fontTools.varLib.instancer import instantiateVariableFont

FONTS = Path(__file__).resolve().parent.parent / "public" / "fonts"
SOURCE = FONTS / "BuenaMono-Variable.woff2"
TARGET = FONTS / "BuenaMono-Digits.woff2"

# CSS weight -> the weight of the original design whose digit stems match the
# letter stems at that CSS weight. The offset shrinks near the heavy end,
# where the design gains weight faster, and the axis ends at 800.
WEIGHT_MAP = {100: 200, 400: 500, 500: 600, 600: 700, 700: 746, 800: 800}

font = TTFont(SOURCE)

options = Options()
options.layout_features = ["zero", "onum", "lnum", "tnum", "cv11", "cv12", "ss10", "ss11"]
options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
options.notdef_outline = True
options.drop_tables += ["meta"]
subsetter = Subsetter(options)
subsetter.populate(unicodes=range(0x30, 0x3A))
subsetter.subset(font)

# Move the default to design 500 and drop the unused range below design 200.
font = instantiateVariableFont(font, {"wght": (200, 500, 800)})

# Relabel the axis in CSS weights. Normalized coordinates stay tied to the
# design, so only the user-facing numbers change.
axis = next(a for a in font["fvar"].axes if a.axisTag == "wght")
axis.minValue, axis.defaultValue, axis.maxValue = 100, 400, 800
font["fvar"].instances = []


def normalize(value: float, low: float, default: float, high: float) -> float:
    if value < default:
        return (value - default) / (default - low)
    return (value - default) / (high - default)


segments = {-1.0: -1.0, 0.0: 0.0, 1.0: 1.0}
for css_weight, design_weight in WEIGHT_MAP.items():
    segments[round(normalize(css_weight, 100, 400, 800), 4)] = round(
        normalize(design_weight, 200, 500, 800), 4
    )

avar = font["avar"] if "avar" in font else newTable("avar")
avar.segments = {
    a.axisTag: (dict(sorted(segments.items())) if a.axisTag == "wght" else {-1.0: -1.0, 0.0: 0.0, 1.0: 1.0})
    for a in font["fvar"].axes
}
font["avar"] = avar

# STAT stays even though it still names the unshifted weights: without it
# Safari ignores the weight axis and draws every digit at Thin.

font.flavor = "woff2"
font.save(TARGET)
print(f"wrote {TARGET} ({TARGET.stat().st_size} bytes)")
