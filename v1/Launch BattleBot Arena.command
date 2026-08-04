#!/bin/bash

set -u

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
GAME_URL="http://127.0.0.1:4173"

cd "$SCRIPT_DIR" || {
  echo "Could not open the BattleBot Arena folder."
  read -r -p "Press Return to close..."
  exit 1
}

find_existing_game() {
  for candidate in "http://127.0.0.1:4173" "http://127.0.0.1:8080"; do
    if curl --silent --fail --connect-timeout 1 --max-time 2 "$candidate/" |
      grep --quiet "<title>Battle Bot Arena</title>"; then
      GAME_URL="$candidate"
      return 0
    fi
  done
  return 1
}

if find_existing_game; then
  echo "Battle Bot Arena is already running at $GAME_URL"
  open "$GAME_URL"
  exit 0
fi

echo "Starting Battle Bot Arena..."
node server.mjs &
SERVER_PID=$!

stop_server() {
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
}

trap stop_server EXIT INT TERM

for _ in {1..50}; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo
    echo "The local server could not be started."
    read -r -p "Press Return to close..."
    exit 1
  fi

  if curl --silent --fail "$GAME_URL/" >/dev/null; then
    echo "Opening $GAME_URL"
    open "$GAME_URL"
    echo
    echo "The game server is running. Press Ctrl+C to stop it."
    wait "$SERVER_PID"
    exit $?
  fi

  sleep 0.1
done

echo
echo "The local server started, but the game did not respond in time."
read -r -p "Press Return to close..."
exit 1
