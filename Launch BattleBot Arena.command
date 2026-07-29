#!/bin/bash
# Double-click launcher: starts the local server (if it isn't already running)
# and opens the game in the default browser.

set -u

GAME_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PORT="${PORT:-4173}"
GAME_URL="http://127.0.0.1:${PORT}/"

cd "$GAME_DIR" || {
  echo "Could not open the BattleBot Arena folder."
  read -r -p "Press Return to close..."
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found."
  echo "Install it from https://nodejs.org and run this again."
  read -r -p "Press Return to close..."
  exit 1
fi

already_running() {
  curl --silent --fail --connect-timeout 1 --max-time 2 "$GAME_URL" |
    grep --quiet "ROBOT COMBAT LEAGUE"
}

if already_running; then
  echo "BattleBot Arena is already running."
else
  echo "Starting BattleBot Arena on port ${PORT}..."
  PORT="$PORT" node server.mjs &
  SERVER_PID=$!
  for _ in $(seq 1 20); do
    sleep 0.25
    already_running && break
  done
  if ! already_running; then
    echo "The server did not start. Try running: node server.mjs"
    read -r -p "Press Return to close..."
    exit 1
  fi
  echo "Server running (pid ${SERVER_PID}). Closing this window stops the game."
fi

open "$GAME_URL"

if [ -n "${SERVER_PID:-}" ]; then
  echo
  echo "Press Control-C (or close this window) to stop the server."
  wait "$SERVER_PID"
fi
