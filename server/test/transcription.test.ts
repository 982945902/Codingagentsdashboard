import { afterEach, describe, expect, it } from "bun:test";
import { createApp } from "../app";
import {
  WhisperCliTranscriber,
  type CommandRunner,
  type Transcriber,
} from "../transcription";

const apiKey = "test-key";
const servers: Array<ReturnType<typeof Bun.serve>> = [];

function authed(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      "x-api-key": apiKey,
      ...(init.headers ?? {}),
    },
  };
}

function startTestServer(transcriber?: Transcriber) {
  const app = createApp({
    settings: {
      apiKey,
      piBridgeToken: apiKey,
      corsOrigins: ["*"],
      host: "127.0.0.1",
      port: 0,
      persistencePath: "",
      whisperCppBin: "whisper-cli",
      whisperCppModel: "",
      whisperLanguage: "auto",
      ffmpegBin: "ffmpeg",
    },
    transcriber,
  });
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      return app.fetch(request, server);
    },
    websocket: {
      open: app.websocket.open,
      message: app.websocket.message,
      close: app.websocket.close,
    },
  });
  servers.push(server);
  return `http://${server.hostname}:${server.port}`;
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

describe("voice transcription", () => {
  it("transcribes an authenticated multipart audio upload", async () => {
    const seen: Array<{ filename: string; mimeType: string; byteLength: number }> = [];
    const baseUrl = startTestServer({
      async transcribe(input) {
        seen.push({
          filename: input.filename,
          mimeType: input.mimeType,
          byteLength: input.bytes.byteLength,
        });
        return { text: "ship it" };
      },
    });
    const form = new FormData();
    form.set("audio", new File([new Uint8Array([1, 2, 3])], "voice.wav", {
      type: "audio/wav",
    }));

    const response = await fetch(
      `${baseUrl}/api/transcribe`,
      authed({ method: "POST", body: form }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ text: "ship it" });
    expect(seen).toHaveLength(1);
    expect(seen[0].filename).toBe("voice.wav");
    expect(seen[0].mimeType).toStartWith("audio/");
    expect(seen[0].byteLength).toBe(3);
  });

  it("rejects transcription when whisper.cpp is not configured", async () => {
    const baseUrl = startTestServer();
    const form = new FormData();
    form.set("audio", new File(["audio"], "voice.wav", { type: "audio/wav" }));

    const response = await fetch(
      `${baseUrl}/api/transcribe`,
      authed({ method: "POST", body: form }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toContain("WHISPER_CPP_MODEL");
  });

  it("runs whisper-cli against the uploaded audio and returns output text", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: CommandRunner = async (command, args) => {
      calls.push({ command, args });
      return { exitCode: 0, stdout: "hello from whisper\n", stderr: "" };
    };
    const transcriber = new WhisperCliTranscriber({
      binaryPath: "/opt/whisper-cli",
      modelPath: "/models/ggml-base.bin",
      language: "auto",
      runner,
    });

    const result = await transcriber.transcribe({
      filename: "clip.wav",
      mimeType: "audio/wav",
      bytes: new Uint8Array([1, 2, 3, 4]),
    });

    expect(result.text).toBe("hello from whisper");
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("/opt/whisper-cli");
    expect(calls[0].args).toContain("-m");
    expect(calls[0].args).toContain("/models/ggml-base.bin");
    expect(calls[0].args).toContain("-f");
    expect(calls[0].args).toContain("-nt");
    expect(calls[0].args).toContain("-np");
    expect(calls[0].args).toContain("-l");
    expect(calls[0].args).toContain("auto");
  });
});
