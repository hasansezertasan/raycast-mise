import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";
import { environment, getPreferenceValues } from "@raycast/api";
import { mkdirSync } from "node:fs";

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
  // the environment profile (mise.<env>.toml) chosen in the preferences, as if MISE_ENV were exported in a shell
  const profile = getPreferenceValues<Preferences>().miseEnv?.trim();
  return {
    ...process.env,
    PATH: parts.join(delimiter),
    NO_COLOR: "1",
    CLICOLOR: "0",
    ...(profile ? { MISE_ENV: profile } : {}),
    ...extra,
  };
}

/** The global config folder: MISE_CONFIG_DIR, else $XDG_CONFIG_HOME/mise, else ~/.config/mise. */
export function globalConfigDir(): string {
  return process.env.MISE_CONFIG_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "mise");
}

/**
 * Where mise runs for the Global context: an empty folder, with MISE_CEILING_PATHS set to it so mise
 * does not pick up project configs from its parents (such as ~/mise.toml). Global config still loads.
 */
function globalContext(): { cwd: string; env: Record<string, string> } {
  const dir = join(environment.supportPath, "global");
  mkdirSync(dir, { recursive: true });
  return { cwd: dir, env: { MISE_CEILING_PATHS: dir } };
}

function context(options: RunOptions): { cwd: string; env: NodeJS.ProcessEnv } {
  const base = options.cwd ? { cwd: options.cwd, env: {} } : globalContext();
  return { cwd: base.cwd, env: { ...base.env, ...options.env } };
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
    const ctx = context(options);
    const { stdout } = await execFileAsync(bin, args, {
      cwd: ctx.cwd,
      env: miseEnv(bin, ctx.env as Record<string, string>),
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
  const ctx = context(options);
  const child = spawn(bin, args, {
    cwd: ctx.cwd,
    env: miseEnv(bin, ctx.env as Record<string, string>),
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
    // Windows keeps a dead parent's children running, so end the whole tree
    else if (child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
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

/**
 * Runs a write to a project's config files and reports the files it made lose their trust.
 *
 * In paranoid mode mise ties the trust of a file to its content, and some writes (`mise settings set --local`)
 * do not renew it. A file trusted just before the write is trusted again when `trustOwnEdits` is on; a file
 * already untrusted is left alone, since it may hold changes nobody reviewed.
 */
export async function keepingTrust(cwd: string, write: () => Promise<unknown>): Promise<string[]> {
  const trusted = (list: { path: string; trusted: boolean }[]) => list.filter((t) => t.trusted).map((t) => t.path);
  const before = trusted(await getTrustStatus(cwd).catch(() => []));
  await write();
  if (before.length === 0) return [];
  const after = new Set(trusted(await getTrustStatus(cwd).catch(() => [])));
  const lost = before.filter((path) => !after.has(path));
  if (lost.length === 0 || !getPreferenceValues<Preferences>().trustOwnEdits) return lost;
  const failed: string[] = [];
  for (const path of lost) await runMise(["trust", path], { cwd }).catch(() => failed.push(path));
  return failed;
}

/** An entry of `mise config explain --json` (mise 2026.10.14+): a key the file sets. */
interface ConfigKeyExplanation {
  key: string;
  /** 1-based */
  line: number;
  description: string | null;
  deprecated: boolean;
  /** whether mise reads the key */
  known: boolean;
  /** the known key it most likely meant */
  suggestion: string | null;
}

export interface ConfigProblem {
  kind: "unknown" | "deprecated";
  /** dotted key, e.g. `settings.experimantal` */
  key: string;
  /** 1-based */
  line: number;
  message: string;
  suggestion?: string;
}

/** What a deprecated key's description says to do: `use env._.file instead.` out of `… Deprecated; use env._.file instead.` */
function deprecationAdvice(description: string | null): string | undefined {
  const text = description?.replace(/^\s*\[deprecated\]\s*/i, "").trim();
  if (!text) return undefined;
  return text.match(/\bdeprecated\b[;:,.]?\s*(.+)$/i)?.[1]?.trim() ?? text;
}

/** The keys of a TOML config file that mise does not read (e.g. a typo) or reads but deprecates. */
export async function listConfigProblems(file: string): Promise<ConfigProblem[]> {
  const keys = await runMiseJson<ConfigKeyExplanation[]>(["config", "explain", "--file", file]);
  return keys.flatMap((k): ConfigProblem[] => {
    if (!k.known) {
      // mise suggests `_`, the env directives, for any short unknown key
      const suggestion = k.suggestion && k.suggestion !== "_" ? k.suggestion : undefined;
      const hint = suggestion ? ` Did you mean \`${suggestion}\`?` : "";
      return [
        { kind: "unknown", key: k.key, line: k.line, message: `mise does not read \`${k.key}\`.${hint}`, suggestion },
      ];
    }
    if (!k.deprecated) return [];
    const advice = deprecationAdvice(k.description);
    return [
      {
        kind: "deprecated",
        key: k.key,
        line: k.line,
        message: `\`${k.key}\` is deprecated${advice ? `: ${advice}` : "."}`,
      },
    ];
  });
}

export interface MiseUpdate {
  current: string;
  latest: string;
  /** false when a package manager installed mise, so `mise self-update` cannot replace it */
  canSelfUpdate: boolean;
}

/** Whether calendar version `a` (e.g. 2026.11.10) is newer than `b`. */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

const settingIs = (key: string, value: string) =>
  runMise(["settings", "get", key])
    .then((out) => out.trim() === value)
    .catch(() => false);

/**
 * A newer mise release, unless the user turned the warning off (`disable_update_warning`)
 * or mise updates itself (`self_update.auto`).
 */
export async function checkMiseUpdate(): Promise<MiseUpdate | undefined> {
  const version = await runMiseJson<{ version: string; latest?: string | null }>(["version"]);
  // "2026.11.9 macos-arm64 (2026-11-16)"
  const current = version.version.split(" ")[0] ?? "";
  const latest = version.latest?.trim();
  if (!latest || !current || !isNewerVersion(latest, current)) return undefined;
  if (await settingIs("disable_update_warning", "true")) return undefined;
  const doctor = await runMiseJson<{ self_update_available?: boolean }>(["doctor"], { tolerateFailure: true }).catch(
    () => ({}) as { self_update_available?: boolean },
  );
  const canSelfUpdate = doctor.self_update_available === true;
  if (canSelfUpdate && (await settingIs("self_update.auto", "true"))) return undefined;
  return { current, latest, canSelfUpdate };
}

export const MISE_UPDATE_DOCS_URL = "https://mise.jdx.dev/cli/self-update.html";
export const MISE_CHANGELOG_URL = "https://github.com/jdx/mise/releases";

/** `mise daemons` is experimental; enable it for these calls only. */
export const DAEMON_ENV = { MISE_EXPERIMENTAL: "1", PITCHFORK_SUPERVISOR_AUTO_START: "false" };

export const listDaemons = (cwd: string) => runMiseJson<MiseDaemon[]>(["daemons", "ls"], { cwd, env: DAEMON_ENV });

export async function daemonAction(action: "start" | "stop" | "restart", cwd: string, id?: string): Promise<void> {
  // starting needs the supervisor, so let pitchfork start it
  const env = action === "stop" ? DAEMON_ENV : { MISE_EXPERIMENTAL: "1" };
  // without a name mise picks only the default group; --all means every daemon of the project
  await runMise(["daemons", action, ...(id ? [id] : ["--all"])], { cwd, env });
}
