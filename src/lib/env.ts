import { delimiter, join, sep } from "node:path";
import { homedir } from "node:os";
import { MiseEnvEntry, runMise } from "./mise";

export const MASK = "••••••";

export type EnvGroup = "config" | "tools" | "other";

export function isPathKey(name: string): boolean {
  return process.platform === "win32" ? name.toLowerCase() === "path" : name === "PATH";
}

/** A source is a real config file path when mise reports a non-empty one. */
export function hasSourceFile(entry: MiseEnvEntry): entry is MiseEnvEntry & { source: string } {
  return Boolean(entry.source);
}

export function envGroup(entry: MiseEnvEntry): EnvGroup {
  if (entry.tool) return "tools";
  if (entry.source) return "config";
  return "other";
}

/** `export KEY="value"` with the characters that are special inside double quotes escaped. */
export function toExport(name: string, value: string): string {
  const escaped = value.replace(/[\\"$`]/g, "\\$&").replace(/\n/g, "\\n");
  return `export ${name}="${escaped}"`;
}

export function splitPath(value: string): string[] {
  return value.split(delimiter).filter(Boolean);
}

/** True for directories inside mise's installs directory. */
export function isMiseInstallPath(path: string): boolean {
  const dataDir = process.env.MISE_DATA_DIR ?? join(homedir(), ".local", "share", "mise");
  return path.startsWith(join(dataDir, "installs") + sep) || path.includes(`${sep}mise${sep}installs${sep}`);
}

export interface SetEnvOptions {
  name: string;
  value: string;
  global: boolean;
  cwd?: string;
}

export async function setEnvVar({ name, value, global, cwd }: SetEnvOptions): Promise<void> {
  await runMise(["set", ...(global ? ["--global"] : []), `${name}=${value}`], { cwd });
}

/** Remove a variable from the config file that defines it. */
export async function unsetEnvVar(name: string, sourceFile: string, cwd?: string): Promise<void> {
  await runMise(["unset", "--file", sourceFile, name], { cwd });
}
