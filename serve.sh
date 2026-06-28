#!/bin/sh
# Optional local-server launcher (offline). Use only if double-clicking index.html
# doesn't run OCR in your browser. Requires Python 3 (pre-installed on macOS/Linux).
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || exit 1
PORT=8000
URL="http://localhost:$PORT/index.html"
echo "Serving $DIR at $URL  (press Ctrl+C to stop)"
( sleep 1
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  elif command -v open >/dev/null 2>&1; then open "$URL"
  fi ) &
python3 -m http.server "$PORT"
