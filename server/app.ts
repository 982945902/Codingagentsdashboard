import { createAgentSchema, type ServerSettings } from "../src/shared/contracts";
import { loadServerSettings } from "./config";
import { createAgentStore, type AgentStore } from "./store";

export interface AppOptions {
  settings?: ServerSettings;
  store?: AgentStore;
}

export interface BunApp {
  fetch(request: Request): Response | Promise<Response>;
}

export function createApp(options: AppOptions = {}): BunApp {
  const settings = options.settings ?? loadServerSettings();
  const store = options.store ?? createAgentStore();

  function corsHeaders(request: Request): HeadersInit {
    const origin = request.headers.get("origin") ?? "*";
    const allowed = settings.corsOrigins.includes("*") || settings.corsOrigins.includes(origin);
    return {
      "access-control-allow-origin": allowed ? origin : settings.corsOrigins[0] ?? "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,x-api-key",
    };
  }

  function json(request: Request, body: unknown, status = 200): Response {
    return Response.json(body, {
      status,
      headers: corsHeaders(request),
    });
  }

  function authorized(request: Request): boolean {
    return request.headers.get("x-api-key") === settings.apiKey;
  }

  return {
    async fetch(request) {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return json(request, { status: "ok" });
      }

      if (!url.pathname.startsWith("/api/")) {
        return json(request, { error: "Not found" }, 404);
      }

      if (!authorized(request)) {
        return json(request, { error: "Unauthorized" }, 401);
      }

      if (request.method === "GET" && url.pathname === "/api/agents") {
        return json(request, { agents: store.list() });
      }

      const agentMatch = /^\/api\/agents\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && agentMatch) {
        const agent = store.get(decodeURIComponent(agentMatch[1]));
        return agent ? json(request, { agent }) : json(request, { error: "Agent not found" }, 404);
      }

      if (request.method === "POST" && url.pathname === "/api/agents") {
        try {
          const payload = await request.json();
          const agent = store.create(createAgentSchema.parse(payload));
          return json(request, { agent }, 201);
        } catch (error) {
          return json(
            request,
            { error: "Invalid request", details: error instanceof Error ? error.message : String(error) },
            400,
          );
        }
      }

      return json(request, { error: "Not found" }, 404);
    },
  };
}
