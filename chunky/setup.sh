#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHUNKY_DIR="$ROOT_DIR/chunky"
LAUNCHER_JAR="$CHUNKY_DIR/ChunkyLauncher.jar"
CHUNKY_HOME="${CHUNKY_HOME:-$HOME/.chunky}"
DEFAULT_JAVA="/Users/sshkeda/Library/Application Support/minecraft/runtime/java-runtime-delta/mac-os-arm64/java-runtime-delta/jre.bundle/Contents/Home/bin/java"
JAVA_BIN="${JAVA_BIN:-${MC_JAVA_BIN:-$DEFAULT_JAVA}}"
MC_VERSION="${MC_VERSION:-1.21.1}"

if [[ ! -x "$JAVA_BIN" ]]; then
  if command -v java >/dev/null 2>&1; then
    JAVA_BIN="$(command -v java)"
  else
    echo "Java not found. Set JAVA_BIN or MC_JAVA_BIN." >&2
    exit 1
  fi
fi

mkdir -p "$CHUNKY_DIR"

echo "[chunky/setup] Downloading Chunky launcher..."
curl -fL "https://chunkyupdate.lemaik.de/ChunkyLauncher.jar" -o "$LAUNCHER_JAR"

echo "[chunky/setup] Updating Chunky into $CHUNKY_HOME ..."
"$JAVA_BIN" -Dchunky.home="$CHUNKY_HOME" -jar "$LAUNCHER_JAR" --update

echo "[chunky/setup] Downloading Minecraft assets for $MC_VERSION ..."
"$JAVA_BIN" -Dchunky.home="$CHUNKY_HOME" -jar "$LAUNCHER_JAR" -download-mc "$MC_VERSION"

echo "[chunky/setup] Done."
echo "Launcher: $LAUNCHER_JAR"
echo "Chunky home: $CHUNKY_HOME"
