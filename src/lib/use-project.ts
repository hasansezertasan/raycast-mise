import { useCachedPromise, useCachedState } from "@raycast/utils";
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
