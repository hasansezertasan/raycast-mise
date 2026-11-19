import type { MiseToolInfo } from "./mise";

const GITHUB_BACKENDS = new Set(["aqua", "github", "ubi", "gitlab"]);

/** Strips backend options such as `github:owner/repo[exe=foo]`. */
function stripOptions(value: string): string {
  const idx = value.indexOf("[");
  return idx === -1 ? value : value.slice(0, idx);
}

/** The repository page implied by a backend like `aqua:owner/repo` or `github:owner/repo`. */
export function repoUrlFromBackend(backend: string | undefined | null): string | undefined {
  if (!backend) return undefined;
  const clean = stripOptions(backend);
  const idx = clean.indexOf(":");
  if (idx === -1) return undefined;
  const kind = clean.slice(0, idx);
  const rest = clean.slice(idx + 1).replace(/^\/+|\/+$/g, "");
  if (!GITHUB_BACKENDS.has(kind) || !/^[\w.-]+\/[\w.-]+/.test(rest)) return undefined;
  const [owner, repo] = rest.split("/");
  return `https://${kind === "gitlab" ? "gitlab.com" : "github.com"}/${owner}/${repo}`;
}

export function toolRepoUrl(name: string, info?: MiseToolInfo): string | undefined {
  if (info?.url && /^https?:\/\//.test(info.url)) return info.url;
  return repoUrlFromBackend(info?.backend) ?? repoUrlFromBackend(name);
}
