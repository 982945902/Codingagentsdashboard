import { serverSettingsSchema, type ServerSettings } from "../src/shared/contracts";

export function loadServerSettings(env: Record<string, string | undefined> = Bun.env): ServerSettings {
  return serverSettingsSchema.parse({
    host: env.HOST,
    port: env.PORT,
    apiKey: env.API_KEY,
    corsOrigins: env.CORS_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean),
    persistencePath: env.PERSISTENCE_PATH,
    whisperCppBin: env.WHISPER_CPP_BIN,
    whisperCppModel: env.WHISPER_CPP_MODEL,
    whisperLanguage: env.WHISPER_LANGUAGE,
    ffmpegBin: env.FFMPEG_BIN,
  });
}
