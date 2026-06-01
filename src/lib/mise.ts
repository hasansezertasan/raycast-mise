import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getPreferenceValues } from "@raycast/api";

const execFileAsync = promisify(execFile);

const CANDIDATE_PATHS = [
  join(homedir(), ".local", "bin", "mise"),
  "/opt/homebrew/bin/mise",
  "/usr/local/bin/mise",
  "/usr/bin/mise",
];

export class MiseNotFoundError extends Error {
  constructor() {
    super(
      "Could not find the `mise` executable. Set the path in extension preferences, " +
        "or install mise (https://mise.jdx.dev/).",
    );
    this.name = "MiseNotFoundError";
  }
}

let cachedPath: string | undefined;

export async function resolveMisePath(): Promise<string> {
  const preference = getPreferenceValues<Preferences>().misePath?.trim();
  if (preference) return preference;
  if (cachedPath) return cachedPath;

  for (const candidate of CANDIDATE_PATHS) {
    try {
      await access(candidate, constants.X_OK);
      cachedPath = candidate;
      return candidate;
    } catch {
      // try next
    }
  }
  throw new MiseNotFoundError();
}

export async function runMise(args: string[]): Promise<string> {
  const bin = await resolveMisePath();
  const { stdout } = await execFileAsync(bin, args, { maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

// `mise doctor` (and a few others) exit non-zero when they find problems,
// but the diagnostic output we want is on stdout. Capture it either way.
async function runMiseTolerant(args: string[]): Promise<string> {
  const bin = await resolveMisePath();
  try {
    const { stdout } = await execFileAsync(bin, args, { maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: number };
    if (typeof e.stdout === "string" && e.stdout.length > 0) return e.stdout;
    throw error;
  }
}

export async function runMiseJson<T>(args: string[]): Promise<T> {
  const stdout = await runMise([...args, "--json"]);
  return JSON.parse(stdout) as T;
}

export interface MiseToolInstall {
  version: string;
  requested_version?: string;
  install_path?: string;
  source?: { type: string; path: string } | null;
  symlinked_to?: string | null;
  active?: boolean;
  installed?: boolean;
}

export type MiseToolsList = Record<string, MiseToolInstall[]>;

export async function listTools(): Promise<MiseToolsList> {
  return runMiseJson<MiseToolsList>(["ls"]);
}

export type MiseSettings = Record<string, unknown>;

export async function getSettings(): Promise<MiseSettings> {
  return runMiseJson<MiseSettings>(["settings"]);
}

export async function getDoctor(): Promise<string> {
  return runMiseTolerant(["doctor"]);
}

export type MiseEnv = Record<string, string>;

export async function getEnv(): Promise<MiseEnv> {
  return runMiseJson<MiseEnv>(["env"]);
}

export async function uninstallTool(name: string, version: string): Promise<void> {
  await runMise(["uninstall", `${name}@${version}`]);
}
