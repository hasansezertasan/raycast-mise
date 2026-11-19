import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, sep } from "node:path";
import { LocalStorage } from "@raycast/api";
import { globalConfigDir, listTrackedConfigs } from "./mise";

/** Sentinel for "no project": mise runs in the home directory and sees only global config. */
export const GLOBAL_PROJECT = "__global__";

export interface Project {
  /** absolute folder, or GLOBAL_PROJECT */
  id: string;
  name: string;
  kind: "global" | "tracked" | "added";
}

const ADDED_KEY = "mise.addedProjects";

/** The folder mise should run in for a project, or undefined for the global context. */
export function projectCwd(project: string): string | undefined {
  return project === GLOBAL_PROJECT ? undefined : project;
}

export function projectLabel(project: string): string {
  if (project === GLOBAL_PROJECT) return "Global";
  return tildify(project);
}

export function tildify(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(home + sep) ? "~" + path.slice(home.length) : path;
}

/** Map a config file path to the project folder that owns it. */
export function configRoot(configPath: string): string {
  let dir = dirname(configPath);
  // <root>/.config/mise/config.toml, <root>/.config/mise/conf.d/x.toml
  if (basename(dir) === "conf.d") dir = dirname(dir);
  if (basename(dir) === "mise" && basename(dirname(dir)) === ".config") return dirname(dirname(dir));
  // <root>/.config/mise.toml, <root>/.mise/config.toml
  if (basename(dir) === ".config" || basename(dir) === ".mise") return dirname(dir);
  return dir;
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export async function getAddedProjects(): Promise<string[]> {
  const raw = await LocalStorage.getItem<string>(ADDED_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export async function addProject(path: string): Promise<void> {
  const added = await getAddedProjects();
  if (!added.includes(path)) await LocalStorage.setItem(ADDED_KEY, JSON.stringify([...added, path]));
}

export async function removeAddedProject(path: string): Promise<void> {
  const added = await getAddedProjects();
  await LocalStorage.setItem(ADDED_KEY, JSON.stringify(added.filter((p) => p !== path)));
}

/** Global first, then folders you added, then folders mise has tracked configs in. */
export async function loadProjects(): Promise<Project[]> {
  const home = homedir();
  const globalDir = globalConfigDir();
  const [added, tracked] = await Promise.all([getAddedProjects(), listTrackedConfigs().catch(() => [] as string[])]);

  const seen = new Set<string>();
  const projects: Project[] = [{ id: GLOBAL_PROJECT, name: "Global", kind: "global" }];

  for (const path of added) {
    if (seen.has(path)) continue;
    seen.add(path);
    projects.push({ id: path, name: tildify(path), kind: "added" });
  }

  const trackedRoots = tracked
    .filter((config) => !config.startsWith(globalDir + sep) && !config.startsWith("/etc/"))
    .map(configRoot)
    .filter((root) => root !== home && isDirectory(root))
    .sort((a, b) => a.localeCompare(b));

  for (const root of trackedRoots) {
    if (seen.has(root)) continue;
    seen.add(root);
    projects.push({ id: root, name: tildify(root), kind: "tracked" });
  }
  return projects;
}
