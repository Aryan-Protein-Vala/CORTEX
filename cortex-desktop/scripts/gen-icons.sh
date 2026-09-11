#!/usr/bin/env bash
# Regenerate every icon Tauri's bundle config references.
#
# The checked-in set was the create-tauri-app template (Tauri branding shipped
# inside a CORTEX installer). This draws the CORTEX glyph instead and derives all
# sizes from it, so `npm run tauri build` never picks up a foreign logo.
#
#   ./scripts/gen-icons.sh          # requires ImageMagick 6/7 (`convert`)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(cd "$HERE/.." && pwd)/src-tauri/icons"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

convert -version >/dev/null 2>&1 || {
  echo "ImageMagick's \`convert\` is required: https://imagemagick.org/script/download.php" >&2
  exit 1
}

# $1 = output size, $2 = "round" | "square"
draw() {
  local size="$1" shape="$2"
  local s=1024 pad=8 corner=112
  local args=(-size ${s}x${s} xc:none)
  if [[ "$shape" == round ]]; then
    args+=(-fill "#120c22" -draw "roundrectangle ${pad},${pad} $((s - pad)),$((s - pad)) ${corner},${corner}")
    args+=(-stroke "#a78bfa" -strokewidth 10 -fill none -draw "roundrectangle ${pad},${pad} $((s - pad)),$((s - pad)) ${corner},${corner}")
  else
    args+=(-fill "#120c22" -draw "rectangle 0,0 $((s - 1)),$((s - 1))")
    args+=(-stroke "#a78bfa" -strokewidth 0 -fill none -draw "rectangle 0,0 $((s - 1)),$((s - 1))")
  fi
  # A 5-node graph: the product, not a letter.
  args+=(
    -stroke "#c4b5fd" -strokewidth 26
    -draw "line 340,360 660,280"
    -draw "line 340,360 300,700"
    -draw "line 660,280 740,660"
    -draw "line 300,700 740,660"
    -draw "line 340,360 740,660"
    -draw "line 512,512 340,360"
    -draw "line 512,512 740,660"
    -strokewidth 0
    -fill "#ede9fe"
    -draw "circle 340,360 340,250"
    -draw "circle 660,280 660,182"
    -draw "circle 300,700 300,600"
    -fill "#a78bfa"
    -draw "circle 740,660 740,552"
    -fill "#f59e0b"
    -draw "circle 512,512 512,455"
  )
  convert "${args[@]}" -resize ${size}x${size} "$TMP/$3"
}

draw 1024 round icon-1024.png
convert "$TMP/icon-1024.png" -resize 512x512 "$OUT/icon.png"
convert "$TMP/icon-1024.png" -resize 32x32 "$OUT/32x32.png"
convert "$TMP/icon-1024.png" -resize 128x128 "$OUT/128x128.png"
convert "$TMP/icon-1024.png" -resize 256x256 "$OUT/128x128@2x.png"

draw 1024 square tile.png
for spec in 30:Square30x30Logo 44:Square44x44Logo 71:Square71x71Logo 89:Square89x89Logo \
            107:Square107x107Logo 142:Square142x142Logo 150:Square150x150Logo \
            284:Square284x284Logo 310:Square310x310Logo 50:StoreLogo; do
  size="${spec%%:*}"
  name="${spec##*:}"
  convert "$TMP/tile.png" -resize ${size}x${size} "$OUT/${name}.png"
done

convert "$TMP/icon-1024.png" -define icon:auto-resize=16,24,32,48,64,128,256 "$OUT/icon.ico"
convert "$TMP/icon-1024.png" -define icon:auto-resize=16,32,64,128,256,512 -background none "$OUT/icon.icns"

echo "wrote $(ls "$OUT" | wc -l | tr -d ' ') icons into $OUT"
identify -format "%f %wx%h\n" "$OUT/icon.ico" 2>/dev/null | sort -u | head -4
