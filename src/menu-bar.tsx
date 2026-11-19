import { Color, Icon, launchCommand, LaunchType, MenuBarExtra, open, showHUD, showToast, Toast } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import {
  checkMiseUpdate,
  listCurrentTools,
  listDaemons,
  listOutdated,
  MISE_CHANGELOG_URL,
  MISE_UPDATE_DOCS_URL,
  MiseDaemon,
  MiseUpdate,
  runMise,
} from "./lib/mise";
import { projectCwd, projectLabel } from "./lib/projects";
import { useProject, useProjectPromise } from "./lib/use-project";

interface Status {
  missing: string[];
  outdated: { name: string; current: string | null; latest: string }[];
  daemons: MiseDaemon[];
  update?: MiseUpdate;
}

async function loadStatus(cwd: string | undefined): Promise<Status> {
  const tools = await listCurrentTools(cwd);
  const missing = Object.entries(tools).flatMap(([name, installs]) =>
    installs.filter((i) => i.installed === false).map((i) => `${name}@${i.requested_version ?? i.version}`),
  );
  const [outdated, daemons, update] = await Promise.all([
    listOutdated(cwd)
      .then((o) => Object.values(o).map(({ name, current, latest }) => ({ name, current, latest })))
      .catch(() => []),
    // daemons are experimental and per project: show them only when they work
    cwd ? listDaemons(cwd).catch(() => [] as MiseDaemon[]) : Promise.resolve([] as MiseDaemon[]),
    checkMiseUpdate().catch(() => undefined),
  ]);
  return { missing, outdated, daemons, update };
}

async function openCommand(name: string) {
  try {
    await launchCommand({ name, type: LaunchType.UserInitiated });
  } catch (error) {
    await showFailureToast(error, { title: "Could not open the command" });
  }
}

export default function Command() {
  const { project, setProject, projects, isLoadingProjects } = useProject();
  const cwd = projectCwd(project);
  const { isLoading, data, error, revalidate } = useProjectPromise(loadStatus, cwd);

  const problems = (data?.missing.length ?? 0) + (error ? 1 : 0);
  const running = data?.daemons.filter((d) => /running|up|ready/i.test(d.status)).length ?? 0;

  async function installMissing() {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Installing missing tools…" });
    try {
      await runMise(["install"], { cwd });
      toast.hide();
      await showHUD("Installed missing tools");
    } catch (e) {
      toast.hide();
      await showFailureToast(e, { title: "mise install failed" });
    }
    revalidate();
  }

  async function updateMise() {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Updating mise…" });
    try {
      await runMise(["self-update", "--yes"]);
      toast.hide();
      await showHUD("Updated mise");
    } catch (e) {
      toast.hide();
      await showFailureToast(e, { title: "mise self-update failed" });
    }
    revalidate();
  }

  return (
    <MenuBarExtra
      isLoading={isLoading || isLoadingProjects}
      icon={{ source: Icon.Hammer, tintColor: problems > 0 ? Color.Red : undefined }}
      title={problems > 0 ? String(problems) : undefined}
      tooltip={`mise: ${projectLabel(project)}`}
    >
      <MenuBarExtra.Section title={`Project: ${projectLabel(project)}`}>
        <MenuBarExtra.Submenu title="Switch Project" icon={Icon.Folder}>
          {projects.map((p) => (
            <MenuBarExtra.Item
              key={p.id}
              title={p.name}
              icon={p.id === project ? Icon.CheckCircle : Icon.Circle}
              onAction={() => setProject(p.id)}
            />
          ))}
        </MenuBarExtra.Submenu>
        {cwd ? <MenuBarExtra.Item title="Open Project Folder" icon={Icon.Finder} onAction={() => open(cwd)} /> : null}
      </MenuBarExtra.Section>

      {error ? (
        <MenuBarExtra.Section title="Error">
          <MenuBarExtra.Item title={error.message.split("\n")[0].slice(0, 80)} icon={Icon.Warning} />
        </MenuBarExtra.Section>
      ) : null}

      {data && data.missing.length > 0 ? (
        <MenuBarExtra.Section title={`Missing Tools (${data.missing.length})`}>
          {data.missing.map((tool) => (
            <MenuBarExtra.Item key={tool} title={tool} icon={{ source: Icon.Warning, tintColor: Color.Red }} />
          ))}
          <MenuBarExtra.Item title="Install Missing Tools" icon={Icon.Download} onAction={installMissing} />
        </MenuBarExtra.Section>
      ) : null}

      {data && data.outdated.length > 0 ? (
        <MenuBarExtra.Section title={`Outdated Tools (${data.outdated.length})`}>
          {data.outdated.map((t) => (
            <MenuBarExtra.Item
              key={t.name}
              title={t.name}
              subtitle={`${t.current ?? "?"} → ${t.latest}`}
              icon={Icon.ArrowUpCircle}
              onAction={() => openCommand("tools")}
            />
          ))}
        </MenuBarExtra.Section>
      ) : null}

      {data?.update ? (
        <MenuBarExtra.Section title={`mise ${data.update.latest} Available`}>
          {data.update.canSelfUpdate ? (
            <MenuBarExtra.Item
              title="Update Mise"
              subtitle={`${data.update.current} → ${data.update.latest}`}
              icon={Icon.ArrowUpCircle}
              onAction={updateMise}
            />
          ) : (
            <MenuBarExtra.Item
              title="How to Update Mise"
              subtitle={`${data.update.current} → ${data.update.latest}`}
              icon={Icon.ArrowUpCircle}
              onAction={() => open(MISE_UPDATE_DOCS_URL)}
            />
          )}
          <MenuBarExtra.Item title="Show Changelog" icon={Icon.Document} onAction={() => open(MISE_CHANGELOG_URL)} />
        </MenuBarExtra.Section>
      ) : null}

      {data && data.daemons.length > 0 ? (
        <MenuBarExtra.Section title={`Daemons (${running}/${data.daemons.length} running)`}>
          {data.daemons.map((d) => (
            <MenuBarExtra.Item
              key={d.id}
              title={d.name}
              subtitle={d.status}
              icon={{
                source: Icon.CircleFilled,
                tintColor: /running|up|ready/i.test(d.status) ? Color.Green : Color.SecondaryText,
              }}
              onAction={() => (d.url ? open(d.url) : openCommand("daemons"))}
            />
          ))}
        </MenuBarExtra.Section>
      ) : null}

      <MenuBarExtra.Section>
        <MenuBarExtra.Item title="Manage Tools" icon={Icon.Box} onAction={() => openCommand("tools")} />
        <MenuBarExtra.Item title="Run Task" icon={Icon.Play} onAction={() => openCommand("tasks")} />
        <MenuBarExtra.Item
          title="Show Environment Variables"
          icon={Icon.Terminal}
          onAction={() => openCommand("env-vars")}
        />
        <MenuBarExtra.Item title="Manage Projects" icon={Icon.Folder} onAction={() => openCommand("projects")} />
        <MenuBarExtra.Item title="Reload" icon={Icon.ArrowClockwise} onAction={revalidate} />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
