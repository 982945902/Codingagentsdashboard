import { homedir } from "node:os";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Normalize a user-provided workspace path so Bun.spawn cwd can use it:
 *   - "~"          → $HOME
 *   - "~/foo/bar"  → $HOME/foo/bar
 *   - "."          → process.cwd()
 *   - relative     → resolved against process.cwd()
 * Throws if the resolved directory does not exist (so we fail fast with a clear
 * error instead of a posix_spawn ENOENT that looks like the binary is missing).
 */
export function resolveWorkspacePath(raw: string | undefined | null): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return process.cwd();
  let expanded = trimmed;
  if (expanded === "~" || expanded.startsWith("~/")) {
    expanded = expanded === "~" ? homedir() : `${homedir()}/${expanded.slice(2)}`;
  }
  const abs = resolve(expanded);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new Error(`workspace path does not exist or is not a directory: ${abs}`);
  }
  return abs;
}