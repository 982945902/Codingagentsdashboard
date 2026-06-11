import { createApp } from "./app";
import { loadServerSettings } from "./config";

const settings = loadServerSettings();
const app = createApp({ settings });

const server = Bun.serve({
  hostname: settings.host,
  port: settings.port,
  fetch(request, server) {
    return app.fetch(request, server);
  },
  websocket: {
    open: app.websocket.open,
    message: app.websocket.message,
    close: app.websocket.close,
  },
});

console.log(
  `Coding agents backend listening on http://${server.hostname}:${server.port}`,
);
console.log(`WebSocket channel: ws://${server.hostname}:${server.port}/ws/agents`);

setInterval(() => {}, 60_000);
