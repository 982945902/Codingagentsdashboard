import { afterEach, describe, expect, it } from "bun:test";
import { transcribeAudio } from "./api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("frontend API client", () => {
  it("uploads audio for server-side transcription as multipart form data", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      request = { url: String(url), init };
      return Response.json({ text: "transcribed command" });
    }) as typeof fetch;

    const result = await transcribeAudio(
      { serverUrl: "http://localhost:8787/", apiKey: "secret" },
      new Blob(["audio"], { type: "audio/wav" }),
    );

    expect(result.text).toBe("transcribed command");
    expect(request?.url).toBe("http://localhost:8787/api/transcribe");
    expect(request?.init?.method).toBe("POST");
    expect(request?.init?.body).toBeInstanceOf(FormData);
    const headers = request?.init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("secret");
    expect(headers["Content-Type"]).toBeUndefined();
  });
});
