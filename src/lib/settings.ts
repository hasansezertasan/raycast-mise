import { runMise } from "./mise";

export interface SettingRow {
  key: string;
  value: unknown;
  type: string;
  description: string;
  /** config file that sets it; undefined when it has its default value */
  source?: string;
}

interface RawLeaf {
  value: unknown;
  type: string;
  description?: string;
  source?: string;
}

function isLeaf(node: unknown): node is RawLeaf {
  if (typeof node !== "object" || node === null || Array.isArray(node)) return false;
  const n = node as Record<string, unknown>;
  // mise adds `description` only for settings it has metadata for, so a leaf is `value` + `type`
  return "value" in n && typeof n.type === "string";
}

function flatten(node: Record<string, unknown>, prefix: string, out: SettingRow[]) {
  for (const [name, child] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (isLeaf(child)) {
      out.push({
        key,
        value: child.value,
        type: child.type,
        description: child.description ?? "",
        source: child.source || undefined,
      });
    } else if (typeof child === "object" && child !== null && !Array.isArray(child)) {
      flatten(child as Record<string, unknown>, key, out);
    }
  }
}

/** Every setting, flattened to dotted keys, with its type, description and defining config file. */
export async function listSettingRows(cwd?: string): Promise<SettingRow[]> {
  // `--json-extended` cannot be combined with `--json`, so don't use runMiseJson here
  const stdout = await runMise(["settings", "ls", "--all", "--json-extended"], { cwd });
  const raw = JSON.parse(stdout) as Record<string, unknown>;
  const rows: SettingRow[] = [];
  flatten(raw, "", rows);
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

export function formatSettingValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** Text for the edit form: arrays are comma-separated, which is what `mise settings set` expects. */
export function editableValue(row: SettingRow): string {
  if (Array.isArray(row.value)) return row.value.map(String).join(",");
  return formatSettingValue(row.value);
}

export async function setSetting(key: string, value: string, local: boolean, cwd?: string): Promise<void> {
  await runMise(["settings", "set", ...(local ? ["--local"] : []), key, value], { cwd });
}

export async function unsetSetting(key: string, local: boolean, cwd?: string): Promise<void> {
  await runMise(["settings", "unset", ...(local ? ["--local"] : []), key], { cwd });
}

export function settingsDocsUrl(key: string): string {
  return `https://mise.jdx.dev/configuration/settings.html#${key}`;
}
