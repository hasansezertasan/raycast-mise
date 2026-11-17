import { Action, ActionPanel, Color, Icon, Keyboard, List } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { ProjectDropdown } from "./components/ProjectDropdown";
import { StreamedRun } from "./components/StreamedRun";
import { StateEmptyView } from "./lib/empty-view";
import { listRegistry, listRemoteVersions, MiseRegistryEntry } from "./lib/mise";
import { projectLabel } from "./lib/projects";
import { repoUrlFromBackend } from "./lib/tools";
import { useProject } from "./lib/use-project";

interface Target {
  project: string;
  cwd?: string;
}

function ToolVersions({ tool, project, cwd }: { tool: MiseRegistryEntry } & Target) {
  const { isLoading, data, error, revalidate } = useCachedPromise(
    async (short: string) => ["latest", ...(await listRemoteVersions(short))],
    [tool.short],
    { keepPreviousData: true },
  );

  return (
    <List
      navigationTitle={`Use ${tool.short}`}
      isLoading={isLoading}
      searchBarPlaceholder={`Filter ${tool.short} versions…`}
    >
      {!isLoading && (
        <StateEmptyView
          error={error}
          emptyTitle="No Versions Found"
          emptyDescription={`mise found no remote versions for ${tool.short}.`}
          onReload={revalidate}
        />
      )}
      {(data ?? []).map((version) => {
        const spec = `${tool.short}@${version}`;
        return (
          <List.Item
            key={version}
            icon={version === "latest" ? Icon.Star : Icon.Tag}
            title={version}
            actions={
              <ActionPanel>
                {cwd ? (
                  <Action.Push
                    title="Use in Project"
                    icon={Icon.Pin}
                    target={<StreamedRun title={`mise use ${spec}`} args={["use", spec]} cwd={cwd} project={project} />}
                  />
                ) : null}
                <Action.Push
                  title="Use Globally"
                  icon={Icon.Globe}
                  target={
                    <StreamedRun title={`mise use -g ${spec}`} args={["use", "-g", spec]} cwd={cwd} project={project} />
                  }
                />
                <Action.CopyToClipboard
                  title="Copy Tool Spec"
                  content={spec}
                  shortcut={Keyboard.Shortcut.Common.Copy}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

export default function Command() {
  const { project, setProject, cwd, projects } = useProject();
  const { isLoading, data, error, revalidate } = useCachedPromise(listRegistry, [], { keepPreviousData: true });

  // aliases appear as separate registry rows; keep one row per short name
  const seen = new Set<string>();
  const entries = (data ?? []).filter((e) => (seen.has(e.short) ? false : (seen.add(e.short), true)));

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search the mise registry…"
      searchBarAccessory={<ProjectDropdown project={project} projects={projects} onChange={setProject} />}
    >
      {!isLoading && (
        <StateEmptyView
          error={error}
          emptyTitle="No Tools Found"
          emptyDescription="Try a different search term."
          onReload={revalidate}
        />
      )}
      {entries.map((tool) => {
        const repo = repoUrlFromBackend(tool.backends[0]);
        return (
          <List.Item
            key={tool.short}
            icon={Icon.Box}
            title={tool.short}
            subtitle={tool.description ?? undefined}
            keywords={[...(tool.aliases ?? []), ...(tool.bins ?? []), ...tool.backends]}
            accessories={[
              ...(tool.bins?.length
                ? [{ text: tool.bins.slice(0, 3).join(", "), icon: Icon.Terminal, tooltip: "Binaries" }]
                : []),
              {
                tag: { value: tool.backends[0]?.split(":")[0] ?? "", color: Color.SecondaryText },
                tooltip: tool.backends.join("\n"),
              },
            ]}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Show Versions"
                  icon={Icon.List}
                  target={<ToolVersions tool={tool} project={project} cwd={cwd} />}
                />
                {cwd ? (
                  <Action.Push
                    title={`Use Latest in ${projectLabel(project)}`}
                    icon={Icon.Pin}
                    target={
                      <StreamedRun
                        title={`mise use ${tool.short}@latest`}
                        args={["use", `${tool.short}@latest`]}
                        cwd={cwd}
                        project={project}
                      />
                    }
                  />
                ) : null}
                <Action.Push
                  title="Use Latest Globally"
                  icon={Icon.Globe}
                  target={
                    <StreamedRun
                      title={`mise use -g ${tool.short}@latest`}
                      args={["use", "-g", `${tool.short}@latest`]}
                      cwd={cwd}
                      project={project}
                    />
                  }
                />
                {repo ? <Action.OpenInBrowser title="Open Repository" url={repo} /> : null}
                <Action.CopyToClipboard
                  title="Copy Tool Name"
                  content={tool.short}
                  shortcut={Keyboard.Shortcut.Common.CopyName}
                />
                <Action
                  title="Reload"
                  icon={Icon.ArrowClockwise}
                  shortcut={Keyboard.Shortcut.Common.Refresh}
                  onAction={revalidate}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
