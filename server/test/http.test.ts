import { afterEach, describe, expect, it } from "bun:test";
import { createApp } from "../app";
import { createAgentStore } from "../store";

const apiKey = "test-key";
const servers: Array<ReturnType<typeof Bun.serve>> = [];

function startTestServer() {
  const app = createApp({
    settings: {
      apiKey,
      corsOrigins: ["*"],
      host: "127.0.0.1",
      port: 0,
    },
    store: createAgentStore(),
  });
  const server = Bun.serve({
    port: 0,
    fetch: app.fetch,
  });
  servers.push(server);
  return `http://${server.hostname}:${server.port}`;
}

function authed(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      "x-api-key": apiKey,
      ...(init.headers ?? {}),
    },
  };
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

describe("Bun HTTP app", () => {
  it("serves health without auth", async () => {
    const baseUrl = startTestServer();

    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  it("requires an API key for agent routes", async () => {
    const baseUrl = startTestServer();

    const response = await fetch(`${baseUrl}/api/agents`);

    expect(response.status).toBe(401);
  });

  it("lists and fetches agents with auth", async () => {
    const baseUrl = startTestServer();

    const listResponse = await fetch(`${baseUrl}/api/agents`, authed());
    const listBody = await listResponse.json();
    const detailResponse = await fetch(`${baseUrl}/api/agents/agent-001`, authed());
    const detailBody = await detailResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listBody.agents).toHaveLength(4);
    expect(detailResponse.status).toBe(200);
    expect(detailBody.agent.name).toBe("Frontend Builder");
  });

  it("creates agents with auth", async () => {
    const baseUrl = startTestServer();

    const response = await fetch(
      `${baseUrl}/api/agents`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Docs Agent",
          runtimeKind: "mock",
          workspacePath: "/tmp/docs",
          model: "claude-sonnet-4",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.agent.name).toBe("Docs Agent");
    expect(body.agent.status).toBe("idle");
  });

  it("handles missing agents, invalid requests, and CORS preflight", async () => {
    const baseUrl = startTestServer();

    const missing = await fetch(`${baseUrl}/api/agents/nope`, authed());
    const invalid = await fetch(
      `${baseUrl}/api/agents`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "" }),
      }),
    );
    const preflight = await fetch(`${baseUrl}/api/agents`, { method: "OPTIONS" });

    expect(missing.status).toBe(404);
    expect(invalid.status).toBe(400);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
  });
});
