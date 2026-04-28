#!/bin/bash
# Is It Kicking Off — local HTTP server for iPhone testing
#
# Double-click this file in Finder. A Terminal window will open, print the
# URL to use on your iPhone (same wifi), and start a tiny web server.
# Press Ctrl+C in the window to stop the server.

cd "$(dirname "$0")" || exit 1

PORT=8000

# Find the Mac's wifi IP (try en0 first, then en1)
IP=$(ipconfig getifaddr en0 2>/dev/null)
if [ -z "$IP" ]; then IP=$(ipconfig getifaddr en1 2>/dev/null); fi

# And the bonjour hostname
HOSTNAME=$(scutil --get LocalHostName 2>/dev/null)

clear
echo ""
echo "════════════════════════════════════════════════════════════"
echo "   🍺  IS IT KICKING OFF — local server for iPhone testing"
echo "════════════════════════════════════════════════════════════"
echo ""

if [ -n "$IP" ]; then
  echo "   On your iPhone (connected to the SAME WIFI), open Safari"
  echo "   and go to:"
  echo ""
  echo "      ┌─────────────────────────────────────┐"
  echo "      │  http://${IP}:${PORT}/"
  echo "      └─────────────────────────────────────┘"
  echo ""
  if [ -n "$HOSTNAME" ]; then
    echo "   Or by hostname:  http://${HOSTNAME}.local:${PORT}/"
    echo ""
  fi
  echo "   Then tap the Share icon → Add to Home Screen."
  echo "   Live data feeds (weather, news, football, fuel) will all"
  echo "   work properly when accessed via this URL."
else
  echo "   ⚠️  No wifi connection detected."
  echo "   Connect your Mac to wifi and re-launch this file."
  echo ""
fi

echo ""
echo "   Press Ctrl+C in this window to stop the server."
echo "════════════════════════════════════════════════════════════"
echo ""

# Start the server. Python 3 is built into macOS.
python3 -m http.server "$PORT"
