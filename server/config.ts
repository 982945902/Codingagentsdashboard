import { serverSettingsSchema, type ServerSettings } from "../src/shared/contracts";

export function loadServerSettings(env: Record<string, string | undefined> = Bun.env): ServerSettings {
  const settings = serverSettingsSchema.parse({
    host: env.HOST,
    port: env.PORT,
    apiKey: env.API_KEY,
    corsOrigins: env.CORS_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean),
    persistencePath: Object.hasOwn(env, "PERSISTENCE_PATH")
      ? env.PERSISTENCE_PATH
      : undefined,
    whisperCppBin: env.WHISPER_CPP_BIN,
    whisperCppModel: env.WHISPER_CPP_MODEL,
    whisperLanguage: env.WHISPER_LANGUAGE,
    ffmpegBin: env.FFMPEG_BIN,
  });
  if (!isLoopbackHost(settings.host) && settings.apiKey === "dev-api-key") {
    throw new Error("API_KEY must be set when HOST is not a loopback address");
  }
  return settings;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}
