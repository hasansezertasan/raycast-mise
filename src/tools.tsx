import {
  Action,
  ActionPanel,
  Alert,
  Clipboard,
  Color,
  confirmAlert,
  Detail,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import { useState } from "react";
import { ProjectDropdown } from "./components/ProjectDropdown";
import { StreamedRun } from "./components/StreamedRun";
import { StateEmptyView } from "./lib/empty-view";
import {
  getBinPaths,
  getToolInfo,
  listCurrentTools,
  listOutdated,
  listTools,
  MiseOutdated,
  MiseToolInstall,
  runMise,
  uninstallTool,
} from "./lib/mise";
import { projectLabel, tildify } from "./lib/projects";
import { toolRepoUrl } from "./lib/tools";
import { useProject, useProjectPromise } from "./lib/use-project";

interface ToolRow {
  key: string;
  name: string;
  install: MiseToolInstall;
  outdated?: MiseOutdated;
}

type Group = "missing" | "active" | "inactive";

function groupOf(install: MiseToolInstall): Group {
  if (install.installed === false) return "missing";
  return install.active ? "active" : "inactive";
}

function requestedOf(install: MiseToolInstall): string {
  return install.requested_version || install.version;
}

function ToolDetail({ name, install, cwd }: { name: string; install: MiseToolInstall; cwd?: string }) {
  const { data: info, isLoading } = usePromise(getToolInfo, [name, cwd]);
  const repo = toolRepoUrl(name, info);
  const version = install.version;
  const markdown = [`# ${name}`, "", info?.description ?? ""].join("\n");

  return (
    <Detail
      navigationTitle={`${name}@${version}`}
      isLoading={isLoading}
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Version" text={version} />
          {install.requested_version ? (
            <Detail.Metadata.Label title="Requested" text={install.requested_version} />
          ) : null}
          <Detail.Metadata.TagList title="Status">
            <Detail.Metadata.TagList.Item
              text={install.installed === false ? "Missing" : "Installed"}
              color={install.installed === false ? Color.Red : Color.Green}
            />
            <Detail.Metadata.TagList.Item
              text={install.active ? "Active" : "Inactive"}
              color={install.active ? Color.Blue : Color.SecondaryText}
            />
          </Detail.Metadata.TagList>
          {info?.backend ? <Detail.Metadata.Label title="Backend" text={info.backend} /> : null}
          {install.install_path ? <Detail.Metadata.Label title="Install Path" text={install.install_path} /> : null}
          {install.symlinked_to ? <Detail.Metadata.Label title="Symlinked To" text={install.symlinked_to} /> : null}
          {install.source ? <Detail.Metadata.Label title="Config File" text={install.source.path} /> : null}
          {info?.installed_versions?.length ? (
            <Detail.Metadata.TagList title="Installed Versions">
              {info.installed_versions.map((v) => (
                <Detail.Metadata.TagList.Item key={v} text={v} />
              ))}
            </Detail.Metadata.TagList>
          ) : null}
          {repo ? <Detail.Metadata.Link title="Repository" text={repo} target={repo} /> : null}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          {repo ? <Action.OpenInBrowser title="Open Repository" url={repo} /> : null}
          {install.install_path ? (
            <Action.CopyToClipboard
              title="Copy Install Path"
              content={install.install_path}
              shortcut={Keyboard.Shortcut.Common.CopyPath}
            />
          ) : null}
          <Action.CopyToClipboard title="Copy Tool Name" content={name} shortcut={Keyboard.Shortcut.Common.CopyName} />
        </ActionPanel>
      }
    />
  );
}

export default function Command() {
  const { project, setProject, cwd, projects } = useProject();
  const [showAll, setShowAll] = useState(false);

  const {
    isLoading,
    data,
    error,
    revalidate: revalidateTools,
  } = usePromise(
    async (dir: string | undefined, all: boolean) => {
      const tools = await (all ? listTools(dir) : listCurrentTools(dir));
      const loaded = Object.entries(tools).flatMap(([name, installs]) =>
        installs.map((install, idx) => ({ key: `${name}@${install.version}@${idx}`, name, install })),
      );
      return { dir, all, rows: loaded };
    },
    [cwd, showAll],
  );
  // `mise outdated` asks the network for the latest versions, so it loads after the list
  // and is best effort: it must not delay or break the list
  const { data: outdatedMap, revalidate: revalidateOutdated } = useProjectPromise(
    (dir: string | undefined) => listOutdated(dir).catch((): Record<string, MiseOutdated> => ({})),
    cwd,
  );
  const revalidate = () => {
    revalidateTools();
    revalidateOutdated();
  };

  // while another project loads, the previous result is still in `data`; never show (or act on) it
  const current = data && data.dir === cwd && data.all === showAll ? data.rows : [];
  const rows: ToolRow[] = current.map((row) => {
    const o = outdatedMap?.[row.name];
    const isOutdated = o && (o.current === row.install.version || (!o.current && row.install.installed === false));
    return { ...row, outdated: isOutdated ? o : undefined };
  });
  const groups: { id: Group; title: string }[] = [
    { id: "missing", title: "Missing" },
    { id: "active", title: "Active" },
    { id: "inactive", title: showAll ? "Installed" : "Inactive" },
  ];
  const hasMissing = rows.some((r) => r.install.installed === false);

  async function copyBinPaths(name: string) {
    try {
      const paths = await getBinPaths(name, cwd);
      if (paths.length === 0) {
        await showToast({ style: Toast.Style.Failure, title: "No Bin Paths", message: name });
        return;
      }
      await Clipboard.copy(paths.join("\n"));
      await showToast({ style: Toast.Style.Success, title: "Copied Bin Paths", message: name });
    } catch (e) {
      await showFailureToast(e, { title: "Could Not Get Bin Paths" });
    }
  }

  async function removeFromConfig(row: ToolRow) {
    const confirmed = await confirmAlert({
      title: `Remove ${row.name} from Config?`,
      message: row.install.source?.path
        ? `This removes ${row.name} from ${tildify(row.install.source.path)} and removes unused installs.`
        : `This runs \`mise unuse ${row.name}\` for ${projectLabel(project)}. It edits the config file and removes unused installs.`,
      primaryAction: { title: "Remove", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return false;
    const toast = await showToast({ style: Toast.Style.Animated, title: `Removing ${row.name}…` });
    try {
      // name the file the tool comes from; mise's own choice skips override files
      const path = row.install.source?.path;
      await runMise(["unuse", ...(path ? ["--path", path] : []), row.name], { cwd });
      toast.style = Toast.Style.Success;
      toast.title = `Removed ${row.name}`;
      revalidate();
    } catch (e) {
      toast.hide();
      await showFailureToast(e, { title: "Remove Failed" });
    }
  }

  async function uninstall(row: ToolRow) {
    const { name, install } = row;
    const confirmed = await confirmAlert({
      title: `Uninstall ${name}@${install.version}?`,
      message: "This runs `mise uninstall` and cannot be undone.",
      primaryAction: { title: "Uninstall", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    const toast = await showToast({ style: Toast.Style.Animated, title: `Uninstalling ${name}@${install.version}…` });
    try {
      await uninstallTool(name, install.version);
      toast.style = Toast.Style.Success;
      toast.title = `Uninstalled ${name}@${install.version}`;
      revalidate();
    } catch (e) {
      toast.hide();
      await showFailureToast(e, { title: "Uninstall Failed" });
    }
  }

  function renderItem(row: ToolRow) {
    const { name, install, outdated } = row;
    const missing = install.installed === false;
    const accessories: List.Item.Accessory[] = [];
    if (missing)
      accessories.push({ tag: { value: "Missing", color: Color.Red }, tooltip: "Requested but not installed" });
    if (outdated) {
      accessories.push({
        tag: { value: `${outdated.latest} Available`, color: Color.Orange },
        tooltip: `Latest version: ${outdated.latest}`,
      });
    }
    if (install.requested_version && install.requested_version !== install.version) {
      accessories.push({ tag: install.requested_version, tooltip: "Requested version" });
    }
    if (!install.active && !missing) accessories.push({ icon: Icon.Circle, tooltip: "Inactive" });
    if (install.symlinked_to) accessories.push({ icon: Icon.Link, tooltip: install.symlinked_to });

    const repo = toolRepoUrl(name);
    const spec = `${name}@${install.version}`;
    const onSuccess = revalidate;

    return (
      <List.Item
        key={row.key}
        icon={missing ? { source: Icon.XMarkCircle, tintColor: Color.Red } : Icon.Box}
        title={name}
        subtitle={missing ? requestedOf(install) : install.version}
        keywords={[install.requested_version ?? ""]}
        accessories={accessories}
        actions={
          <ActionPanel>
            <ActionPanel.Section>
              {missing ? (
                <Action.Push
                  title="Install"
                  icon={Icon.Download}
                  target={
                    <StreamedRun
                      title={`mise install ${name}@${requestedOf(install)}`}
                      args={["install", `${name}@${requestedOf(install)}`]}
                      cwd={cwd}
                      project={project}
                      onSuccess={onSuccess}
                    />
                  }
                />
              ) : null}
              <Action.Push
                title="Show Details"
                icon={Icon.Sidebar}
                target={<ToolDetail name={name} install={install} cwd={cwd} />}
              />
              {outdated ? (
                <Action.Push
                  title="Upgrade"
                  icon={Icon.ArrowUpCircle}
                  target={
                    <StreamedRun
                      title={`mise upgrade ${name}`}
                      args={["upgrade", name]}
                      cwd={cwd}
                      project={project}
                      onSuccess={onSuccess}
                    />
                  }
                />
              ) : null}
              {outdated ? (
                <Action.Push
                  title="Upgrade and Keep Old Version"
                  icon={Icon.ArrowUpCircle}
                  target={
                    <StreamedRun
                      title={`mise upgrade --no-prune ${name}`}
                      args={["upgrade", "--no-prune", name]}
                      cwd={cwd}
                      project={project}
                      onSuccess={onSuccess}
                    />
                  }
                />
              ) : null}
            </ActionPanel.Section>
            <ActionPanel.Section>
              {hasMissing ? (
                <Action.Push
                  title="Install All Missing"
                  icon={Icon.Download}
                  target={
                    <StreamedRun
                      title="mise install"
                      args={["install"]}
                      cwd={cwd}
                      project={project}
                      onSuccess={onSuccess}
                    />
                  }
                />
              ) : null}
              <Action
                title={showAll ? "Show Project Tools" : "Show All Installed Versions"}
                icon={showAll ? Icon.List : Icon.AppWindowList}
                shortcut={{
                  macOS: { modifiers: ["cmd", "shift"], key: "a" },
                  Windows: { modifiers: ["ctrl", "shift"], key: "a" },
                }}
                onAction={() => setShowAll((v) => !v)}
              />
            </ActionPanel.Section>
            <ActionPanel.Section title="Version">
              {!missing ? (
                <>
                  {cwd ? (
                    <Action.Push
                      title="Use Version in Project"
                      icon={Icon.Pin}
                      target={
                        <StreamedRun
                          title={`mise use ${spec}`}
                          args={["use", spec]}
                          cwd={cwd}
                          project={project}
                          onSuccess={onSuccess}
                        />
                      }
                    />
                  ) : null}
                  <Action.Push
                    title="Use Globally"
                    icon={Icon.Globe}
                    target={
                      <StreamedRun
                        title={`mise use -g ${spec}`}
                        args={["use", "-g", spec]}
                        cwd={cwd}
                        project={project}
                        onSuccess={onSuccess}
                      />
                    }
                  />
                </>
              ) : null}
              {install.source ? (
                <Action
                  title="Remove from Config"
                  icon={Icon.MinusCircle}
                  style={Action.Style.Destructive}
                  onAction={() => removeFromConfig(row)}
                />
              ) : null}
              {!missing ? (
                <Action
                  title="Uninstall Version"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={Keyboard.Shortcut.Common.Remove}
                  onAction={() => uninstall(row)}
                />
              ) : null}
            </ActionPanel.Section>
            <ActionPanel.Section title="Open and Copy">
              {install.source ? <Action.Open title="Open Tool Definition" target={install.source.path} /> : null}
              {install.install_path && !missing ? (
                <Action.ShowInFinder title="Show in Finder" path={install.install_path} />
              ) : null}
              {repo ? <Action.OpenInBrowser title="Open Repository" url={repo} /> : null}
              {install.install_path ? (
                <Action.CopyToClipboard
                  title="Copy Install Path"
                  content={install.install_path}
                  shortcut={Keyboard.Shortcut.Common.CopyPath}
                />
              ) : null}
              {!missing ? (
                <Action title="Copy Bin Paths" icon={Icon.Clipboard} onAction={() => copyBinPaths(name)} />
              ) : null}
            </ActionPanel.Section>
            <ActionPanel.Section>
              <Action
                title="Reload"
                icon={Icon.ArrowClockwise}
                shortcut={Keyboard.Shortcut.Common.Refresh}
                onAction={revalidate}
              />
            </ActionPanel.Section>
          </ActionPanel>
        }
      />
    );
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder={showAll ? "Filter installed versions…" : "Filter project tools…"}
      searchBarAccessory={<ProjectDropdown project={project} projects={projects} onChange={setProject} />}
    >
      {!isLoading && (error || rows.length === 0) && (
        <StateEmptyView
          error={error}
          emptyTitle={showAll ? "No Tools Installed" : "No Tools in This Project"}
          emptyDescription="Add one with the Use Tool command."
          onReload={revalidate}
          extraActions={
            // the switch also lives on each row, but an empty list has no rows
            <Action
              title={showAll ? "Show Project Tools" : "Show All Installed Versions"}
              icon={showAll ? Icon.List : Icon.AppWindowList}
              onAction={() => setShowAll((v) => !v)}
            />
          }
        />
      )}
      {groups.map((g) => {
        const items = rows.filter((r) => groupOf(r.install) === g.id);
        return items.length > 0 ? (
          <List.Section key={g.id} title={g.title} subtitle={String(items.length)}>
            {items.map(renderItem)}
          </List.Section>
        ) : null;
      })}
    </List>
  );
}
