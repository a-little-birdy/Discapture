#!/bin/bash
# Full build script for Discapture on Windows
# Creates the complete build directory from scratch, bypassing broken electrobun build

set -e

# Ensure bun is on PATH (bun's bash may not inherit the Windows PATH)
export PATH="$HOME/.bun/bin:$PATH"

BUILD_ENV="${BUILD_ENV:-dev}"
VERSION="${VERSION:-$(node -p "require('./package.json').version")}"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$PROJECT_ROOT/node_modules/electrobun/dist-win-x64"

if [ "$BUILD_ENV" = "release" ]; then
  BUILD="$PROJECT_ROOT/build/release-win-x64/Discapture"
else
  BUILD="$PROJECT_ROOT/build/dev-win-x64/Discapture-dev"
fi

echo "[build] Environment: $BUILD_ENV | Version: $VERSION"

echo "[build] Creating build directory structure..."
mkdir -p "$BUILD/bin"
mkdir -p "$BUILD/Resources/app/bun"
mkdir -p "$BUILD/Resources/app/views/control-ui"

# --- Copy platform binaries ---
echo "[build] Copying platform binaries..."
cp "$DIST/launcher.exe" "$BUILD/bin/launcher.exe"
cp "$DIST/bun.exe" "$BUILD/bin/bun.exe"
cp "$DIST/libNativeWrapper.dll" "$BUILD/bin/libNativeWrapper.dll"
cp "$DIST/WebView2Loader.dll" "$BUILD/bin/WebView2Loader.dll"

# --- Copy main.js (electrobun launcher entrypoint) ---
cp "$DIST/main.js" "$BUILD/Resources/main.js"

# --- Generate build.json ---
cat > "$BUILD/Resources/build.json" << 'ENDJSON'
{
  "buildEnvironment": "dev",
  "app": {
    "name": "Discapture",
    "identifier": "dev.discapture.app",
    "version": "0.1.0"
  }
}
ENDJSON

# --- Generate version.json ---
cat > "$BUILD/Resources/version.json" << 'ENDJSON'
{
  "version": "0.1.0",
  "buildEnvironment": "dev"
}
ENDJSON

# --- Build app code ---
echo "[build] Building bun-side code..."
bun build "$PROJECT_ROOT/src/bun/index.ts" \
  --outdir "$BUILD/Resources/app/bun" \
  --target=bun \
  --external electrobun/bun \
  --external puppeteer-core

echo "[build] Building view-side code..."
bun build "$PROJECT_ROOT/src/control-ui/index.ts" \
  --outdir "$BUILD/Resources/app/views/control-ui" \
  --target=browser

# --- Copy static assets ---
echo "[build] Copying static assets..."
cp "$PROJECT_ROOT/src/control-ui/index.html" "$BUILD/Resources/app/views/control-ui/index.html"
cp "$PROJECT_ROOT/src/control-ui/style.css" "$BUILD/Resources/app/views/control-ui/style.css"

echo "[build] Done! Build at: $BUILD"
