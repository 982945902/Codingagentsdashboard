# pi-dashboard-bridge

Pi extension that attaches a live Pi TUI session to Coding Agents Dashboard. The browser and TUI control the same in-memory Pi session.

## Install

```bash
pi install /path/to/Codingagentsdashboard/packages/pi-dashboard-bridge
```

Restart Pi or run `/reload`.

Defaults:

```text
PI_DASHBOARD_URL=ws://127.0.0.1:8787/ws/bridges/pi
PI_DASHBOARD_TOKEN=dev-api-key
PI_DASHBOARD_HOST_ID=<hostname>
```

For persistent configuration create `~/.pi/agent/dashboard/config.json`:

```json
{
  "enabled": true,
  "url": "ws://127.0.0.1:8787/ws/bridges/pi",
  "token": "replace-me",
  "hostId": "devbox"
}
```

Use `/dashboard` inside Pi to inspect connection state or reconnect.

The bridge sends normal text, tool calls, usage, model metadata and context percentage. Thinking content is intentionally not sent.
