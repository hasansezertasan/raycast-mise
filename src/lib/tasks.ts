import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { globalConfigDir, runMiseJson } from "./mise";

export type TaskKind = "toml" | "file";

export interface NewTask {
  kind: TaskKind;
  name: string;
  description?: string;
  run: string;
  depends: string[];
  hide: boolean;
  /** project folder; undefined for the global config */
  cwd?: string;
}

export interface CreatedTask {
  /** the config file or script that now holds the task */
  path: string;
}

/** Returns an error message, or undefined when the name is usable. */
export function validateTaskName(name: string, kind: TaskKind): string | undefined {
  const value = name.trim();
  if (!value) return "The name is required";
  if (/\s/.test(value)) return "The name cannot contain spaces";
  if (kind === "file") {
    if (/[\\/]/.test(value) || value.startsWith(":") || value.endsWith(":") || value.includes("::"))
      return "Use `:` to nest file tasks, for example `test:unit`";
    if (value.split(":").some((part) => part === "." || part === ".."))
      return "The name cannot contain `.` or `..` segments";
  }
  return undefined;
}

/** TOML basic multi-line string; mise keeps the run command exactly as written. */
function tomlMultiline(text: string): string {
  const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r\n/g, "\n");
  return `"""\n${escaped}"""`;
}

function tomlString(text: string): string {
  return JSON.stringify(text);
}

/**
 * `mise tasks add` shell-quotes whatever is given after `--`, which would turn `a && b` into a
 * quoted word. So the task is added without a command and the `run` key is written into its table.
 */
async function addRunToTable(path: string, name: string, run: string): Promise<void> {
  const content = await readFile(path, "utf8");
  const headers = new Set([`[tasks.${name}]`, `[tasks.${tomlString(name)}]`, `[tasks."${name}"]`]);
  const lines = content.split("\n");
  const index = lines.findIndex((line) => headers.has(line.trim()));
  if (index === -1)
    throw new Error(`Created the task, but could not find [tasks.${name}] in ${path} to add its command`);
  const value = run.includes("\n") ? tomlMultiline(run) : tomlString(run);
  lines.splice(index + 1, 0, `run = ${value}`);
  await writeFile(path, lines.join("\n"), "utf8");
}

async function createTomlTask(task: NewTask): Promise<CreatedTask> {
  const args = ["tasks", "add", task.name];
  if (task.cwd === undefined) args.push("--global");
  if (task.description) args.push("--description", task.description);
  for (const dep of task.depends) args.push("--depends", dep);
  if (task.hide) args.push("--hide");
  // mise replaces an existing task of the same name, so ask it first (it knows which file it would edit)
  const plan = await runMiseJson<{ action: string; path: string }>([...args, "--dry-run"], { cwd: task.cwd });
  if (plan.action !== "added") throw new Error(`A task named ${task.name} already exists in ${plan.path}`);
  const result = await runMiseJson<{ path: string }>(args, { cwd: task.cwd });
  if (task.run.trim()) await addRunToTable(result.path, task.name, task.run.replace(/\s+$/, "") + "\n");
  return { path: result.path };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function createFileTask(task: NewTask): Promise<CreatedTask> {
  // global file tasks live in $MISE_CONFIG_DIR/tasks
  const root = task.cwd === undefined ? join(globalConfigDir(), "tasks") : join(task.cwd, "mise-tasks");
  // native mise on Windows needs no bash; it runs .ps1 file tasks with PowerShell
  const windows = process.platform === "win32";
  const parts = task.name.split(":");
  if (windows) parts[parts.length - 1] += ".ps1";
  const path = resolve(root, ...parts);
  if (!path.startsWith(resolve(root) + sep)) throw new Error("The task name points outside the task directory");
  if (await exists(path)) throw new Error(`${path} already exists`);

  const header = [windows ? "#!/usr/bin/env pwsh" : "#!/usr/bin/env bash"];
  if (task.description) header.push(`#MISE description=${tomlString(task.description)}`);
  if (task.depends.length > 0) header.push(`#MISE depends=${JSON.stringify(task.depends)}`);
  if (task.hide) header.push("#MISE hide=true");
  const body = task.run.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${header.join("\n")}\n\n${body}\n`, { encoding: "utf8", flag: "wx" });
  await chmod(path, 0o755);
  return { path };
}

export function createTask(task: NewTask): Promise<CreatedTask> {
  return task.kind === "file" ? createFileTask(task) : createTomlTask(task);
}
