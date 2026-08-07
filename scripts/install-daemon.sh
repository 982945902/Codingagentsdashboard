#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BUN_BIN=$(command -v bun || true)
if [[ -z "$BUN_BIN" ]]; then
  echo "bun is required" >&2
  exit 1
fi

CONFIG_DIR="$HOME/.config/coding-agents-dashboard"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$CONFIG_DIR" "$UNIT_DIR"

if [[ ! -f "$CONFIG_DIR/env" ]]; then
  API_KEY=$(openssl rand -hex 24)
  BRIDGE_TOKEN=$(openssl rand -hex 24)
  cat >"$CONFIG_DIR/env" <<EOF
API_KEY=$API_KEY
PI_BRIDGE_TOKEN=$BRIDGE_TOKEN
PERSISTENCE_PATH=$ROOT/.data/agents.json
EOF
chmod 600 "$CONFIG_DIR/env"
fi

set -a
# shellcheck disable=SC1090
source "$CONFIG_DIR/env"
set +a
PI_CONFIG_DIR="$HOME/.pi/agent/dashboard"
mkdir -p "$PI_CONFIG_DIR"
chmod 700 "$PI_CONFIG_DIR"
python3 - "$PI_CONFIG_DIR/config.json" "${PORT:-8787}" "$PI_BRIDGE_TOKEN" <<'PY'
import json, sys
path, port, token = sys.argv[1:]
with open(path, "w", encoding="utf-8") as f:
    json.dump({
        "enabled": True,
        "url": f"ws://127.0.0.1:{port}/ws/bridges/pi",
        "token": token,
    }, f, indent=2)
    f.write("\n")
PY
chmod 600 "$PI_CONFIG_DIR/config.json"

sed \
  -e "s|__REPO_DIR__|$ROOT|g" \
  -e "s|__BUN_BIN__|$BUN_BIN|g" \
  "$ROOT/deploy/coding-agents-dashboard.service.in" \
  >"$UNIT_DIR/coding-agents-dashboard.service"

systemctl --user daemon-reload
systemctl --user enable --now coding-agents-dashboard.service
systemctl --user --no-pager status coding-agents-dashboard.service || true

cat <<EOF
Installed Coding Agents Dashboard daemon.
Environment: $CONFIG_DIR/env
Unit: $UNIT_DIR/coding-agents-dashboard.service

Pi bridge config: $PI_CONFIG_DIR/config.json
Restart Pi or run /reload after installing packages/pi-dashboard-bridge.
EOF
