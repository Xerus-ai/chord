"""
Generates the OS app icons from the Chord mark master.

    python scripts/generate-app-icons.py      (requires Pillow >= 10)

Two silhouettes, because the platforms disagree about what an icon canvas is:

- macOS draws the canvas as-is, and every Big Sur+ icon sits on Apple's grid:
  an 824px tile, 100px in from each edge of 1024. Filling the canvas there
  makes the icon the biggest thing in the Dock.
- Windows and Linux expect the artwork to fill the canvas. The same Apple-grid
  PNG loses ~20% of its size to transparent margin in the taskbar, which is
  why the icon read as smaller than every icon beside it.

The mark itself fills MARK_HEIGHT of the tile on both. It used to sit at ~56%,
which is what made it look small on every OS, not just the non-mac ones.

Outputs (src/assets/images/chord/):
  app-icon.png              Windows / Linux builds, dev window icon
  app-icon-mac.png          dev Dock icon; source of app-icon.icns
  app-icon.icns             macOS app and DMG
  app-icon-canary.png       canary Windows / Linux
  app-icon-canary.icns      canary macOS app and DMG
"""

from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parent.parent / "src" / "assets" / "images" / "chord"
MARK_SOURCE = ASSETS / "chord-mark-source.png"

CANVAS = 1024
TILE_COLOR = (24, 27, 26, 255)
# Apple's corner radius for an 824px tile, scaled with the tile everywhere.
RADIUS_RATIO = 185 / 824
MARK_HEIGHT = 0.70

MAC_TILE = 824
FULL_BLEED_TILE = CANVAS - 2 * 24

CANARY_RING_COLOR = (251, 229, 119, 255)
CANARY_RING_RATIO = 28 / 824

# The master's anti-aliased edge carries faint speckle well outside the ribbon;
# below this alpha it is noise, not edge.
MARK_ALPHA_FLOOR = 48

# Supersampling for the tile and ring edges, which PIL draws without AA.
SUPERSAMPLE = 4


def load_mark() -> Image.Image:
    mark = Image.open(MARK_SOURCE).convert("RGBA")
    alpha = mark.getchannel("A").point(lambda a: 0 if a < MARK_ALPHA_FLOOR else a)
    mark.putalpha(alpha)
    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError(f"{MARK_SOURCE} has no opaque pixels")
    return mark.crop(bbox)


def draw_tile(tile: int, ring: bool) -> Image.Image:
    """The rounded tile, centred on the canvas, drawn supersampled then reduced."""
    size = CANVAS * SUPERSAMPLE
    offset = (CANVAS - tile) // 2 * SUPERSAMPLE
    extent = offset + tile * SUPERSAMPLE - 1
    radius = round(tile * RADIUS_RATIO * SUPERSAMPLE)

    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    if ring:
        width = round(tile * CANARY_RING_RATIO * SUPERSAMPLE)
        draw.rounded_rectangle((offset, offset, extent, extent), radius, fill=CANARY_RING_COLOR)
        draw.rounded_rectangle(
            (offset + width, offset + width, extent - width, extent - width),
            max(radius - width, 0),
            fill=TILE_COLOR,
        )
    else:
        draw.rounded_rectangle((offset, offset, extent, extent), radius, fill=TILE_COLOR)
    return layer.resize((CANVAS, CANVAS), Image.LANCZOS)


def compose_icon(mark: Image.Image, tile: int, ring: bool) -> Image.Image:
    icon = draw_tile(tile, ring)
    height = round(tile * MARK_HEIGHT)
    width = round(mark.width * height / mark.height)
    scaled = mark.resize((width, height), Image.LANCZOS)
    icon.alpha_composite(scaled, ((CANVAS - width) // 2, (CANVAS - height) // 2))
    return icon


def main() -> None:
    mark = load_mark()

    compose_icon(mark, FULL_BLEED_TILE, ring=False).save(ASSETS / "app-icon.png")
    mac = compose_icon(mark, MAC_TILE, ring=False)
    mac.save(ASSETS / "app-icon-mac.png")
    mac.save(ASSETS / "app-icon.icns")

    compose_icon(mark, FULL_BLEED_TILE, ring=True).save(ASSETS / "app-icon-canary.png")
    compose_icon(mark, MAC_TILE, ring=True).save(ASSETS / "app-icon-canary.icns")

    print(f"Wrote app icons to {ASSETS}")


if __name__ == "__main__":
    main()
