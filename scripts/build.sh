#!/bin/bash
# Cross-platform build script for Discapture
# Creates the complete build directory from scratch, bypassing broken electrobun build

set -e

# Ensure bun is on PATH (bun's bash may not inherit the Windows PATH)
export PATH="$HOME/.bun/bin:$PATH"

BUILD_ENV="${BUILD_ENV:-dev}"
VERSION="${VERSION:-$(node -p "require('./package.json').version")}"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# --- Detect platform and architecture ---
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) PLATFORM="win" ;;
  Darwin)               PLATFORM="darwin" ;;
  Linux)
    # Detect WSL (running on a Windows host)
    if grep -qi "microsoft\|wsl" /proc/version 2>/dev/null; then
      PLATFORM="win"
    else
      PLATFORM="linux"
    fi
    ;;
  *)  echo "[build] Unsupported OS: $(uname -s)"; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64)         ARCH="x64" ;;
  aarch64|arm64)  ARCH="arm64" ;;
  *)              echo "[build] Unsupported arch: $(uname -m)"; exit 1 ;;
esac

# Windows only has x64 builds (ARM is emulated)
if [ "$PLATFORM" = "win" ]; then
  ARCH="x64"
fi

ELECTROBUN_VERSION="$(node -p "require('./node_modules/electrobun/package.json').version")"
DIST="$PROJECT_ROOT/node_modules/electrobun/dist-${PLATFORM}-${ARCH}"

echo "[build] Environment: $BUILD_ENV | Version: $VERSION"
echo "[build] Platform: $PLATFORM-$ARCH | Electrobun: v$ELECTROBUN_VERSION"

# --- Ensure platform binaries exist (download if missing) ---
if [ ! -d "$DIST" ]; then
  echo "[build] dist-${PLATFORM}-${ARCH} not found, downloading electrobun core binaries..."
  TARBALL_URL="https://github.com/blackboardsh/electrobun/releases/download/v${ELECTROBUN_VERSION}/electrobun-core-${PLATFORM}-${ARCH}.tar.gz"
  TARBALL_PATH="$PROJECT_ROOT/node_modules/electrobun/.cache/electrobun-core-${PLATFORM}-${ARCH}.tar.gz"

  mkdir -p "$(dirname "$TARBALL_PATH")"
  curl -L --fail --progress-bar -o "$TARBALL_PATH" "$TARBALL_URL"

  echo "[build] Extracting core binaries..."
  # Try extracting into electrobun dir (tarball may create dist-* subdir)
  tar -xzf "$TARBALL_PATH" -C "$PROJECT_ROOT/node_modules/electrobun/"

  # If dist dir still doesn't exist, the tarball extracted flat — move into dist dir
  if [ ! -d "$DIST" ]; then
    echo "[build] Tarball extracted flat, creating dist directory..."
    mkdir -p "$DIST"
    tar -xzf "$TARBALL_PATH" -C "$DIST"
  fi

  rm -f "$TARBALL_PATH"

  if [ ! -d "$DIST" ]; then
    echo "[build] ERROR: Failed to set up dist-${PLATFORM}-${ARCH}"
    exit 1
  fi
  echo "[build] Core binaries ready."
fi

# --- Set up build output directory ---
if [ "$BUILD_ENV" = "release" ]; then
  BUILD="$PROJECT_ROOT/build/release-${PLATFORM}-${ARCH}/Discapture"
else
  BUILD="$PROJECT_ROOT/build/dev-${PLATFORM}-${ARCH}/Discapture-dev"
fi

echo "[build] Creating build directory structure..."
mkdir -p "$BUILD/bin"
mkdir -p "$BUILD/Resources/app/bun"
mkdir -p "$BUILD/Resources/app/views/control-ui"

# --- Determine platform-specific binary extension ---
if [ "$PLATFORM" = "win" ]; then
  BIN_EXT=".exe"
else
  BIN_EXT=""
fi

# --- Copy platform binaries into bin/ ---
# The launcher expects ../Resources/ relative to its location, so it must be in a subdirectory
echo "[build] Copying platform binaries..."
for file in "$DIST"/*; do
  [ ! -f "$file" ] && continue
  fname="$(basename "$file")"
  case "$fname" in
    main.js|npmbin.js) continue ;;
    launcher|launcher.exe)
      cp "$file" "$BUILD/bin/Discapture${BIN_EXT}"
      # electrobun dev expects the original launcher name
      if [ "$BUILD_ENV" != "release" ]; then
        cp "$file" "$BUILD/bin/$fname"
      fi
      ;;
    *) cp "$file" "$BUILD/bin/$fname" ;;
  esac
done

# Make the launcher executable on Unix
if [ "$PLATFORM" != "win" ]; then
  chmod +x "$BUILD/bin/Discapture"
fi

# --- Copy main.js (electrobun launcher entrypoint) ---
cp "$DIST/main.js" "$BUILD/Resources/main.js"

# --- Generate build.json ---
cat > "$BUILD/Resources/build.json" << ENDJSON
{
  "buildEnvironment": "$BUILD_ENV",
  "app": {
    "name": "Discapture",
    "identifier": "dev.discapture.app",
    "version": "$VERSION"
  }
}
ENDJSON

# --- Generate version.json ---
cat > "$BUILD/Resources/version.json" << ENDJSON
{
  "version": "$VERSION",
  "buildEnvironment": "$BUILD_ENV"
}
ENDJSON

# --- Build app code ---
echo "[build] Building bun-side code..."
if [ "$BUILD_ENV" = "release" ]; then
  # Release: bundle everything — no node_modules in installed app
  bun build "$PROJECT_ROOT/src/bun/index.ts" \
    --outdir "$BUILD/Resources/app/bun" \
    --target=bun
else
  # Dev: externalize deps resolved via node_modules
  bun build "$PROJECT_ROOT/src/bun/index.ts" \
    --outdir "$BUILD/Resources/app/bun" \
    --target=bun \
    --external electrobun/bun \
    --external puppeteer-core
fi

echo "[build] Building view-side code..."
bun build "$PROJECT_ROOT/src/control-ui/index.ts" \
  --outdir "$BUILD/Resources/app/views/control-ui" \
  --target=browser

# --- Copy static assets ---
echo "[build] Copying static assets..."
cp "$PROJECT_ROOT/src/control-ui/index.html" "$BUILD/Resources/app/views/control-ui/index.html"
cp "$PROJECT_ROOT/src/control-ui/style.css" "$BUILD/Resources/app/views/control-ui/style.css"

# --- Set application icon ---
ICON_SRC="$PROJECT_ROOT/src/assets/logo.png"

# Helper: convert Unix paths to Windows paths (works in WSL, Git Bash, and MSYS2)
to_win_path() {
  cygpath -w "$1" 2>/dev/null || wslpath -w "$1" 2>/dev/null || echo "$1"
}

if [ -f "$ICON_SRC" ]; then
  if [ "$PLATFORM" = "win" ]; then
    echo "[build] Setting Windows application icon..."
    ICO_SRC="$PROJECT_ROOT/src/assets/logo.ico"
    ICO_PATH="$BUILD/Resources/app.ico"
    if [ -f "$ICO_SRC" ]; then
      cp "$ICO_SRC" "$ICO_PATH"
      # Embed ICO into exes by calling rcedit-x64.exe directly (bypasses cross-spawn-windows-exe
      # normalizePath which mangles Windows paths in WSL)
      RCEDIT_BIN="$PROJECT_ROOT/node_modules/rcedit/bin/rcedit-x64.exe"
      if [ -f "$RCEDIT_BIN" ]; then
        WIN_ICO="$(to_win_path "$ICO_PATH")"
        for exe in "$BUILD/bin/Discapture.exe" "$BUILD/bin/launcher.exe" "$BUILD/bin/bun.exe"; do
          if [ -f "$exe" ]; then
            WIN_EXE="$(to_win_path "$exe")"
            "$RCEDIT_BIN" "$WIN_EXE" --set-icon "$WIN_ICO" \
              && echo "[build] Icon embedded in $(basename "$exe")" \
              || echo "[build] rcedit failed for $(basename "$exe")"
          fi
        done
      else
        echo "[build] rcedit binary not found, skipping icon embedding"
      fi
    else
      echo "[build] No ICO found at src/assets/logo.ico -- run: node -e \"require('png-to-ico')('src/assets/logo.png').then(b=>require('fs').writeFileSync('src/assets/logo.ico',b))\""
    fi
    # Also copy PNG for runtime setWindowIcon
    cp "$ICON_SRC" "$BUILD/Resources/app-icon.png"
  elif [ "$PLATFORM" = "linux" ]; then
    echo "[build] Copying Linux application icon..."
    cp "$ICON_SRC" "$BUILD/Resources/appIcon.png"
  fi
else
  echo "[build] No icon found at src/assets/logo.png, skipping"
fi

echo "[build] Done! Build at: $BUILD"
