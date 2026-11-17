import { Action, ActionPanel, Alert, Color, confirmAlert, Icon, Keyboard, List, showToast, Toast } from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import { StreamedRun } from "./components/StreamedRun";
import { ProjectDropdown } from "./components/ProjectDropdown";
import { StateEmptyView } from "./lib/empty-view";
import { DAEMON_ENV, daemonAction, listDaemons, MiseDaemon, runMise } from "./lib/mise";
import { tildify } from "./lib/projects";
import { useProject } from "./lib/use-project";

type DaemonAction = "start" | "stop" | "restart";

const PAST: Record<DaemonAction, string> = { start: "Started", stop: "Stopped", restart: "Restarted" };
const PRESENT: Record<DaemonAction, string> = { start: "Starting", stop: "Stopping", restart: "Restarting" };

function statusTag(status: string): List.Item.Accessory {
  const s = status.toLowerCase();
  const color = /running|up|ready/.test(s)
    ? Color.Green
    : /fail|error|crash/.test(s)
      ? Color.Red
      : /start|wait|pending/.test(s)
        ? Color.Yellow
        : Color.SecondaryText;
  return { tag: { value: status, color } };
}

function isRunning(status: string) {
  return /running|up|ready|start/i.test(status);
}

function isExperimentalError(error?: Error) {
  return Boolean(error && /experimental/i.test(error.message));
}

export default function Command() {
  const { project, setProject, cwd, projects } = useProject();
  const { isLoading, data, error, revalidate } = usePromise(
    async (dir: string | undefined) => (dir ? listDaemons(dir) : []),
    [cwd],
  );

  async function act(action: DaemonAction, daemon?: MiseDaemon) {
    if (!cwd) return;
    const label = daemon ? daemon.name : "all daemons";
    const toast = await showToast({ style: Toast.Style.Animated, title: `${PRESENT[action]} ${label}…` });
    try {
      await daemonAction(action, cwd, daemon?.id);
      toast.style = Toast.Style.Success;
      toast.title = `${PAST[action]} ${label}`;
    } catch (e) {
      toast.hide();
      await showFailureToast(e, { title: `Could not ${action} ${label}` });
    }
    revalidate();
  }

  async function enableExperimental() {
    const confirmed = await confirmAlert({
      title: "Enable experimental features?",
      message: "This runs `mise settings set experimental true` in your global config. Daemons need it.",
      primaryAction: { title: "Enable" },
    });
    if (!confirmed) return;
    try {
      await runMise(["settings", "set", "experimental", "true"]);
      await showToast({ style: Toast.Style.Success, title: "Experimental features enabled" });
      revalidate();
    } catch (e) {
      await showFailureToast(e, { title: "Could not change the setting" });
    }
  }

  const reload = (
    <Action
      title="Reload"
      icon={Icon.ArrowClockwise}
      shortcut={Keyboard.Shortcut.Common.Refresh}
      onAction={revalidate}
    />
  );

  const allActions = cwd ? (
    <ActionPanel.Section title="All Daemons">
      <Action title="Start All Daemons" icon={Icon.Play} onAction={() => act("start")} />
      <Action title="Restart All Daemons" icon={Icon.RotateClockwise} onAction={() => act("restart")} />
      <Action
        title="Stop All Daemons"
        icon={Icon.Stop}
        style={Action.Style.Destructive}
        onAction={async () => {
          const confirmed = await confirmAlert({
            title: "Stop all daemons of this project?",
            primaryAction: { title: "Stop All", style: Alert.ActionStyle.Destructive },
          });
          if (confirmed) await act("stop");
        }}
      />
    </ActionPanel.Section>
  ) : null;

  function emptyView() {
    if (isLoading) return null;
    if (!cwd) {
      return (
        <List.EmptyView
          icon={Icon.Folder}
          title="Choose a Project"
          description="Daemons belong to a project. Pick one in the dropdown."
        />
      );
    }
    if (isExperimentalError(error)) {
      return (
        <List.EmptyView
          icon={Icon.Bolt}
          title="Daemons Are Experimental"
          description="mise only runs daemons when experimental features are on."
          actions={
            <ActionPanel>
              <Action title="Enable Experimental Features" icon={Icon.Bolt} onAction={enableExperimental} />
              <Action.OpenInBrowser title="Open Daemons Docs" url="https://mise.jdx.dev/daemons.html" />
            </ActionPanel>
          }
        />
      );
    }
    return (
      <StateEmptyView
        error={error}
        emptyTitle="No Daemons"
        emptyDescription="Declare daemons under [daemons] in mise.toml."
        onReload={revalidate}
      />
    );
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Filter daemons…"
      searchBarAccessory={<ProjectDropdown project={project} projects={projects} onChange={setProject} />}
    >
      {emptyView()}
      {data?.map((daemon) => {
        const running = isRunning(daemon.status);
        return (
          <List.Item
            key={daemon.id}
            icon={Icon.HardDrive}
            title={daemon.name}
            subtitle={daemon.preset ?? daemon.run}
            accessories={[
              ...(daemon.port ? [{ text: `:${daemon.port}`, tooltip: "Port" }] : []),
              ...(daemon.error ? [{ icon: Icon.Warning, tooltip: daemon.error }] : []),
              statusTag(daemon.status),
            ]}
            actions={
              <ActionPanel>
                <ActionPanel.Section title={daemon.name}>
                  {running ? (
                    <Action
                      title="Restart Daemon"
                      icon={Icon.RotateClockwise}
                      onAction={() => act("restart", daemon)}
                    />
                  ) : (
                    <Action title="Start Daemon" icon={Icon.Play} onAction={() => act("start", daemon)} />
                  )}
                  {running ? (
                    <Action
                      title="Stop Daemon"
                      icon={Icon.Stop}
                      style={Action.Style.Destructive}
                      onAction={() => act("stop", daemon)}
                    />
                  ) : null}
                  <Action.Push
                    title="Show Logs"
                    icon={Icon.Terminal}
                    target={
                      <StreamedRun
                        title={`mise daemons logs ${daemon.name}`}
                        args={["daemons", "logs", daemon.id, "-n", "200"]}
                        cwd={cwd}
                        env={DAEMON_ENV}
                        project={project}
                      />
                    }
                  />
                  {daemon.url ? <Action.OpenInBrowser url={daemon.url} /> : null}
                  {daemon.url ? (
                    <Action.CopyToClipboard
                      title="Copy URL"
                      content={daemon.url}
                      shortcut={Keyboard.Shortcut.Common.CopyName}
                    />
                  ) : null}
                  {daemon.source ? <Action.Open title="Open Daemon Definition" target={daemon.source} /> : null}
                  {daemon.source ? (
                    <Action.ShowInFinder path={daemon.source} title={`Show ${tildify(daemon.source)} in Finder`} />
                  ) : null}
                </ActionPanel.Section>
                {allActions}
                <ActionPanel.Section>
                  <Action.Push
                    title="Show Daemon Status"
                    icon={Icon.Info}
                    target={
                      <StreamedRun
                        title="mise daemons status"
                        args={["daemons", "status"]}
                        cwd={cwd}
                        env={DAEMON_ENV}
                        project={project}
                      />
                    }
                  />
                  {reload}
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
