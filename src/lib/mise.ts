import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";
import { getPreferenceValues } from "@raycast/api";

const execFileAsync = promisify(execFile);
const isWindows = process.platform === "win32";
const MAX_BUFFER = 32 * 1024 * 1024;

function candidatePaths(): string[] {
  const home = homedir();
  if (isWindows) {
    const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return [
      join(localAppData, "Microsoft", "WinGet", "Links", "mise.exe"),
      join(home, "scoop", "shims", "mise.exe"),
      join(localAppData, "mise", "bin", "mise.exe"),
      join(home, ".local", "bin", "mise.exe"),
    ];
  }
  return [
    join(home, ".local", "bin", "mise"),
    "/opt/homebrew/bin/mise",
    "/usr/local/bin/mise",
    "/usr/bin/mise",
    join(home, ".cargo", "bin", "mise"),
    "/run/current-system/sw/bin/mise",
    join(home, ".nix-profile", "bin", "mise"),
  ];
}

export class MiseNotFoundError extends Error {
  constructor() {
    super(
      "Could not find the `mise` executable. Set the path in extension preferences, " +
        "or install mise (https://mise.jdx.dev/).",
    );
    this.name = "MiseNotFoundError";
  }
}

/** A failed mise command, with the message mise printed on stderr. */
export class MiseCommandError extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "MiseCommandError";
  }
}

let cachedPath: string | undefined;

export async function resolveMisePath(): Promise<string> {
  const preference = getPreferenceValues<Preferences>().misePath?.trim();
  if (preference) return preference;
  if (cachedPath) return cachedPath;

  for (const candidate of candidatePaths()) {
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

/**
 * Raycast starts extensions with a minimal PATH. Tasks and backends often need the
 * usual user locations (Homebrew, ~/.local/bin), so add them after the inherited PATH.
 */
function miseEnv(bin: string, extra?: Record<string, string>): NodeJS.ProcessEnv {
  const home = homedir();
  const extraPaths = isWindows
    ? [dirname(bin)]
    : [dirname(bin), "/opt/homebrew/bin", "/usr/local/bin", join(home, ".local", "bin")];
  const current = process.env.PATH ?? "";
  const parts = [...current.split(delimiter).filter(Boolean)];
  for (const p of extraPaths) if (!parts.includes(p)) parts.push(p);
  return { ...process.env, PATH: parts.join(delimiter), NO_COLOR: "1", CLICOLOR: "0", ...extra };
}

export interface RunOptions {
  /** Directory mise runs in. Omit for the global context (home directory). */
  cwd?: string;
  env?: Record<string, string>;
  /** Return stdout even when mise exits non-zero (e.g. `mise doctor`). */
  tolerateFailure?: boolean;
}

function lastLines(text: string, count = 6): string {
  const lines = text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l && !/^mise (ERROR|WARN)\s+(Version:|Run with --verbose)/.test(l));
  return lines.slice(-count).join("\n");
}

export async function runMise(args: string[], options: RunOptions = {}): Promise<string> {
  const bin = await resolveMisePath();
  try {
    const { stdout } = await execFileAsync(bin, args, {
      cwd: options.cwd ?? homedir(),
      env: miseEnv(bin, options.env),
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    const stdout = typeof e.stdout === "string" ? e.stdout : "";
    const stderr = typeof e.stderr === "string" ? e.stderr : "";
    if (options.tolerateFailure && stdout.length > 0) return stdout;
    const detail = lastLines(stderr) || lastLines(stdout) || e.message || "mise failed";
    throw new MiseCommandError(detail.replace(/^mise ERROR\s+/gm, ""), stdout, stderr);
  }
}

export async function runMiseJson<T>(args: string[], options: RunOptions = {}): Promise<T> {
  const stdout = await runMise([...args, "--json"], options);
  return JSON.parse(stdout) as T;
}

export interface StreamHandlers {
  onData: (chunk: string) => void;
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  onError: (error: Error) => void;
}

/** Start a long-running mise command and stream its combined output. */
export async function spawnMise(args: string[], options: RunOptions, handlers: StreamHandlers): Promise<ChildProcess> {
  const bin = await resolveMisePath();
  const child = spawn(bin, args, {
    cwd: options.cwd ?? homedir(),
    env: miseEnv(bin, options.env),
    // no stdin: a prompt fails instead of waiting forever for an answer nobody can type
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    // its own process group, so stopping it also stops the task's children
    detached: !isWindows,
  });
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", handlers.onData);
  child.stderr?.on("data", handlers.onData);
  child.on("error", handlers.onError);
  child.on("close", handlers.onExit);
  return child;
}

export function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (!isWindows && child.pid) process.kill(-child.pid, "SIGTERM");
    else child.kill();
  } catch {
    child.kill();
  }
}

// ---------- Types for mise JSON output ----------

export interface MiseToolSource {
  type: string;
  path: string;
}

export interface MiseToolInstall {
  version: string;
  requested_version?: string;
  install_path?: string;
  source?: MiseToolSource | null;
  symlinked_to?: string | null;
  active?: boolean;
  installed?: boolean;
}

export type MiseToolsList = Record<string, MiseToolInstall[]>;

export interface MiseToolInfo {
  backend?: string;
  description?: string | null;
  url?: string | null;
  installed_versions?: string[];
  requested_versions?: string[];
  active_versions?: string[];
  config_source?: MiseToolSource | null;
}

export interface MiseOutdated {
  name: string;
  requested: string;
  current: string | null;
  latest: string;
  bump?: string | null;
  source?: MiseToolSource | null;
}

export interface MiseRegistryEntry {
  short: string;
  backends: string[];
  bins?: string[];
  description?: string | null;
  aliases?: string[];
}

export interface MiseTask {
  name: string;
  aliases: string[];
  tags?: string[];
  description: string;
  source: string;
  depends: string[];
  depends_post?: string[];
  wait_for?: string[];
  dir?: string | null;
  hide: boolean;
  global?: boolean;
  sources?: string[];
  outputs?: string[];
  run: string[];
  file?: string | null;
  usage?: string;
}

export interface UsageArg {
  name: string;
  usage: string;
  help?: string;
  required?: boolean;
  var?: boolean;
  default?: string | string[];
  choices?: { choices: string[] };
  hide?: boolean;
}

export interface UsageFlag {
  name: string;
  usage: string;
  help?: string;
  short: string[];
  long: string[];
  required?: boolean;
  var?: boolean;
  hide?: boolean;
  default?: string | string[];
  /** the flag that turns a default-true flag off, e.g. `--no-loud` */
  negate?: string;
  /** present when the flag takes a value */
  arg?: UsageArg;
}

export interface MiseTaskInfo extends MiseTask {
  usage_spec?: {
    cmd?: {
      args?: UsageArg[];
      flags?: UsageFlag[];
    };
  };
}

export interface MiseEnvEntry {
  value: string;
  source?: string;
  tool?: string;
}

export type MiseEnvExtended = Record<string, MiseEnvEntry>;

export interface MiseConfigFile {
  path: string;
  tools: string[];
  override?: boolean;
}

export interface MiseDaemon {
  id: string;
  name: string;
  namespace?: string;
  status: string;
  pid?: number;
  port?: number;
  url?: string;
  error?: string;
  preset?: string;
  run?: string;
  source?: string;
  root?: string;
}

// ---------- Commands ----------

export const listTools = (cwd?: string) => runMiseJson<MiseToolsList>(["ls"], { cwd });
export const listCurrentTools = (cwd?: string) => runMiseJson<MiseToolsList>(["ls", "--current"], { cwd });
export const getToolInfo = (tool: string, cwd?: string) => runMiseJson<MiseToolInfo>(["tool", tool], { cwd });
export const listOutdated = (cwd?: string) => runMiseJson<Record<string, MiseOutdated>>(["outdated"], { cwd });
export const listRegistry = () => runMiseJson<MiseRegistryEntry[]>(["registry"]);

export async function listRemoteVersions(tool: string): Promise<string[]> {
  const out = await runMise(["ls-remote", tool]);
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .reverse();
}

export async function getBinPaths(tool: string, cwd?: string): Promise<string[]> {
  const out = await runMise(["bin-paths", tool], { cwd });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export async function uninstallTool(name: string, version: string): Promise<void> {
  await runMise(["uninstall", `${name}@${version}`]);
}

export const listTasks = (cwd?: string, hidden = false) =>
  runMiseJson<MiseTask[]>(["tasks", "ls", ...(hidden ? ["--hidden"] : [])], { cwd });
export const getTaskInfo = (task: string, cwd?: string) => runMiseJson<MiseTaskInfo>(["tasks", "info", task], { cwd });
export const getTaskDeps = (task: string | undefined, cwd?: string) =>
  runMise(["tasks", "deps", ...(task ? [task] : [])], { cwd });

/** `--json-extended` loses to `--json`, so it must not go through runMiseJson (which appends `--json`). */
export async function getEnvExtended(cwd?: string): Promise<MiseEnvExtended> {
  return JSON.parse(await runMise(["env", "--json-extended"], { cwd })) as MiseEnvExtended;
}
export type MiseEnv = Record<string, string>;
export const getEnv = (cwd?: string) => runMiseJson<MiseEnv>(["env"], { cwd });

export type MiseSettings = Record<string, unknown>;
/** Every setting with its effective value. */
export const getAllSettings = (cwd?: string) => runMiseJson<MiseSettings>(["settings", "ls", "--all"], { cwd });
/** Only the settings set in config files. */
export const getSettings = (cwd?: string) => runMiseJson<MiseSettings>(["settings"], { cwd });

export const getDoctor = (cwd?: string) => runMise(["doctor"], { cwd, tolerateFailure: true });

export const listConfigFiles = (cwd?: string) => runMiseJson<MiseConfigFile[]>(["config", "ls"], { cwd });

export async function listTrackedConfigs(): Promise<string[]> {
  const out = await runMise(["config", "ls", "--tracked-configs"]);
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** `mise trust --show` prints `<dir>: trusted|untrusted` per config directory. */
export async function getTrustStatus(cwd: string): Promise<{ path: string; trusted: boolean }[]> {
  const out = await runMise(["trust", "--show"], { cwd, tolerateFailure: true });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.lastIndexOf(": ");
      if (idx === -1) return undefined;
      return { path: line.slice(0, idx), trusted: line.slice(idx + 2).trim() === "trusted" };
    })
    .filter((x): x is { path: string; trusted: boolean } => Boolean(x));
}

/** `mise daemons` is experimental; enable it for these calls only. */
export const DAEMON_ENV = { MISE_EXPERIMENTAL: "1", PITCHFORK_SUPERVISOR_AUTO_START: "false" };

export const listDaemons = (cwd: string) => runMiseJson<MiseDaemon[]>(["daemons", "ls"], { cwd, env: DAEMON_ENV });

export async function daemonAction(action: "start" | "stop" | "restart", cwd: string, id?: string): Promise<void> {
  // starting needs the supervisor, so let pitchfork start it
  const env = action === "stop" ? DAEMON_ENV : { MISE_EXPERIMENTAL: "1" };
  await runMise(["daemons", action, ...(id ? [id] : [])], { cwd, env });
}
