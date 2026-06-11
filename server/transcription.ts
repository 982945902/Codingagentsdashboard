import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerSettings } from "../src/shared/contracts";

export interface TranscriptionInput {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface TranscriptionResult {
  text: string;
}

export interface Transcriber {
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export interface WhisperCliOptions {
  binaryPath: string;
  modelPath: string;
  language?: string;
  ffmpegPath?: string;
  runner?: CommandRunner;
}

const SUPPORTED_EXTENSIONS = new Set([".flac", ".mp3", ".ogg", ".wav"]);

export function createWhisperTranscriber(settings: ServerSettings): Transcriber | null {
  if (!settings.whisperCppModel.trim()) return null;
  return new WhisperCliTranscriber({
    binaryPath: settings.whisperCppBin,
    modelPath: settings.whisperCppModel,
    language: settings.whisperLanguage,
    ffmpegPath: settings.ffmpegBin,
  });
}

export class WhisperCliTranscriber implements Transcriber {
  private readonly runner: CommandRunner;
  private readonly language: string;
  private readonly ffmpegPath: string;

  constructor(private readonly options: WhisperCliOptions) {
    this.runner = options.runner ?? runCommand;
    this.language = options.language?.trim() || "auto";
    this.ffmpegPath = options.ffmpegPath?.trim() || "ffmpeg";
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const workDir = await mkdtemp(join(tmpdir(), "coding-agents-whisper-"));
    try {
      const sourcePath = join(workDir, `audio${extensionFor(input)}`);
      await Bun.write(sourcePath, input.bytes);

      const audioPath = await this.prepareAudio(sourcePath, input, workDir);
      const outputBase = join(workDir, "transcript");
      const args = [
        "-m",
        this.options.modelPath,
        "-f",
        audioPath,
        "-l",
        this.language,
        "-nt",
        "-np",
        "-otxt",
        "-of",
        outputBase,
      ];
      const result = await this.runner(this.options.binaryPath, args);
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `whisper-cli exited ${result.exitCode}`);
      }

      const fileText = await readOptionalText(`${outputBase}.txt`);
      const text = normalizeTranscript(fileText || result.stdout);
      if (!text) throw new Error("whisper-cli returned an empty transcript");
      return { text };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async prepareAudio(
    sourcePath: string,
    input: TranscriptionInput,
    workDir: string,
  ): Promise<string> {
    const extension = extensionFor(input);
    if (SUPPORTED_EXTENSIONS.has(extension)) return sourcePath;

    const wavPath = join(workDir, "audio.wav");
    const result = await this.runner(this.ffmpegPath, [
      "-y",
      "-i",
      sourcePath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      wavPath,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr.trim() ||
          `ffmpeg could not convert ${input.mimeType || input.filename} for whisper.cpp`,
      );
    }
    return wavPath;
  }
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  const proc = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

function extensionFor(input: TranscriptionInput): string {
  const nameMatch = /\.([a-z0-9]+)$/i.exec(input.filename);
  if (nameMatch) return `.${nameMatch[1].toLowerCase()}`;
  if (input.mimeType.includes("wav")) return ".wav";
  if (input.mimeType.includes("mpeg") || input.mimeType.includes("mp3")) return ".mp3";
  if (input.mimeType.includes("ogg")) return ".ogg";
  if (input.mimeType.includes("flac")) return ".flac";
  if (input.mimeType.includes("webm")) return ".webm";
  if (input.mimeType.includes("mp4")) return ".mp4";
  return ".audio";
}

async function readOptionalText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function normalizeTranscript(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\[[^\]]+\]\s*/, "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}
