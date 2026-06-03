import { createApp } from "./app";
import { loadServerSettings } from "./config";

const settings = loadServerSettings();
const app = createApp({ settings });

const server = Bun.serve({
  hostname: settings.host,
  port: settings.port,
  fetch: app.fetch,
});

console.log(`Coding agents backend listening on http://${server.hostname}:${server.port}`);
