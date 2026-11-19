import { useCachedPromise, useCachedState, usePromise } from "@raycast/utils";
import { existsSync } from "node:fs";
import { useEffect } from "react";
import { GLOBAL_PROJECT, loadProjects, projectCwd } from "./projects";

/**
 * The project every command works on. The choice is shared by all commands of the
 * extension and remembered between launches. A folder that no longer exists falls back to Global.
 */
export function useProject() {
  const [stored, setProject] = useCachedState<string>("mise.project", GLOBAL_PROJECT);
  const { data: projects, isLoading, revalidate } = useCachedPromise(loadProjects, [], { keepPreviousData: true });
  const exists = stored === GLOBAL_PROJECT || existsSync(stored);
  const project = exists ? stored : GLOBAL_PROJECT;

  useEffect(() => {
    if (!exists) setProject(GLOBAL_PROJECT);
  }, [exists]);

  return {
    project,
    setProject,
    cwd: projectCwd(project),
    projects: projects ?? [],
    isLoadingProjects: isLoading,
    reloadProjects: revalidate,
  };
}

/**
 * Load project data, but only ever return the result of the project that is selected now.
 * While another project loads, usePromise still holds the previous project's result; showing it
 * would let actions run against the new folder with the old rows.
 */
export function useProjectPromise<T>(fn: (cwd: string | undefined) => Promise<T>, cwd: string | undefined) {
  const result = usePromise(async (dir: string | undefined) => ({ dir, value: await fn(dir) }), [cwd]);
  const fresh = result.data !== undefined && result.data.dir === cwd;
  return {
    isLoading: result.isLoading || (!fresh && !result.error),
    data: fresh ? result.data?.value : undefined,
    error: result.error,
    revalidate: result.revalidate,
  };
}
