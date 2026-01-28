#!/bin/bash

# Generate all logo formats from the source SVG
# Usage: ./generate-logos.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PUBLIC_DIR="$(dirname "$SCRIPT_DIR")"
SOURCE_SVG="$PUBLIC_DIR/herdctl-logo.svg"

if [ ! -f "$SOURCE_SVG" ]; then
  echo "Error: Source SVG not found at $SOURCE_SVG"
  exit 1
fi

echo "Generating logos from $SOURCE_SVG..."

# Generate PNGs at various sizes (transparent background)
for size in 16 32 48 64 128 256 512; do
  echo "  Creating ${size}x${size} PNG..."
  rsvg-convert -w $size -h $size "$SOURCE_SVG" -o "$SCRIPT_DIR/herdctl-logo-${size}.png"
done

# Generate JPEGs (white background, for contexts that don't support transparency)
echo "  Creating JPEGs..."
magick "$SCRIPT_DIR/herdctl-logo-512.png" -background white -flatten "$SCRIPT_DIR/herdctl-logo-512.jpg"
magick "$SCRIPT_DIR/herdctl-logo-256.png" -background white -flatten "$SCRIPT_DIR/herdctl-logo-256.jpg"

# Generate multi-resolution favicon
echo "  Creating favicon.ico..."
magick "$SCRIPT_DIR/herdctl-logo-16.png" "$SCRIPT_DIR/herdctl-logo-32.png" "$SCRIPT_DIR/herdctl-logo-48.png" "$SCRIPT_DIR/favicon.ico"

# Copy favicon to public root
cp "$SCRIPT_DIR/favicon.ico" "$PUBLIC_DIR/favicon.ico"

echo "Done! Generated files:"
ls -la "$SCRIPT_DIR"/*.png "$SCRIPT_DIR"/*.jpg "$SCRIPT_DIR"/*.ico "$PUBLIC_DIR/favicon.ico"
