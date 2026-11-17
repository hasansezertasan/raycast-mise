import {
  Action,
  ActionPanel,
  Alert,
  Color,
  confirmAlert,
  Form,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import { statSync } from "node:fs";
import { sep } from "node:path";
import { StateEmptyView } from "./lib/empty-view";
import { getTrustStatus, listConfigFiles, runMise } from "./lib/mise";
import {
  addProject,
  GLOBAL_PROJECT,
  Project,
  projectCwd,
  projectLabel,
  removeAddedProject,
  tildify,
} from "./lib/projects";
import { useProject } from "./lib/use-project";
import { StreamedRun } from "./components/StreamedRun";

function ProjectActions({ project }: { project: string }) {
  const cwd = projectCwd(project);
  const run = (title: string, args: string[]) => <StreamedRun title={title} args={args} cwd={cwd} project={project} />;

  return (
    <>
      <ActionPanel.Section title="Project">
        <Action.Push title="Install Missing Tools" icon={Icon.Download} target={run("mise install", ["install"])} />
        <Action.Push
          title="Run Project Checks"
          icon={Icon.CheckCircle}
          target={run("mise doctor project", ["doctor", "project"])}
        />
        <Action.Push title="Run Doctor" icon={Icon.Heartbeat} target={run("mise doctor", ["doctor"])} />
        <Action.Push title="Format Config Files" icon={Icon.Text} target={run("mise fmt", ["fmt"])} />
        <Action.Push
          title="Check Config Formatting"
          icon={Icon.Text}
          target={run("mise fmt --check", ["fmt", "--check"])}
        />
        <Action.Push title="Update Lockfile" icon={Icon.Lock} target={run("mise lock", ["lock"])} />
        <Action.Push
          title="Preview Lockfile Changes"
          icon={Icon.Lock}
          target={run("mise lock --dry-run", ["lock", "--dry-run"])}
        />
      </ActionPanel.Section>
      <ActionPanel.Section title="Bootstrap">
        <Action.Push
          title="Show Bootstrap Plan"
          icon={Icon.List}
          target={run("mise bootstrap plan", ["bootstrap", "plan"])}
        />
        <Action.Push
          title="Bootstrap Dry Run"
          icon={Icon.Eye}
          target={run("mise bootstrap --dry-run", ["bootstrap", "--dry-run"])}
        />
        <BootstrapAction project={project} />
      </ActionPanel.Section>
    </>
  );
}

function BootstrapAction({ project }: { project: string }) {
  const { push } = useNavigation();
  return (
    <Action
      title="Run Bootstrap"
      icon={Icon.Hammer}
      style={Action.Style.Destructive}
      onAction={async () => {
        const confirmed = await confirmAlert({
          title: "Run mise bootstrap?",
          message:
            "Bootstrap applies everything your config declares under [bootstrap]: packages, files, services and more. Check the plan or a dry run first.",
          primaryAction: { title: "Run Bootstrap", style: Alert.ActionStyle.Destructive },
        });
        if (!confirmed) return;
        push(
          <StreamedRun
            title="mise bootstrap"
            args={["bootstrap", "--yes"]}
            cwd={projectCwd(project)}
            project={project}
          />,
        );
      }}
    />
  );
}

/** The config files mise loads for a project, with their trust status. */
function ConfigFiles({ project }: { project: string }) {
  const cwd = projectCwd(project);
  const { isLoading, data, error, revalidate } = usePromise(
    async (dir: string | undefined) => {
      const [files, trust] = await Promise.all([
        listConfigFiles(dir),
        dir ? getTrustStatus(dir).catch(() => []) : Promise.resolve([]),
      ]);
      return files.map((file) => {
        // `mise trust --show` lists config folders; match the file or its folder
        // the longest matching folder wins, so a subfolder's own status beats its parent's
        const status = trust
          .filter((t) => file.path === t.path || file.path.startsWith(t.path + sep))
          .sort((a, b) => b.path.length - a.path.length)[0];
        return { ...file, trusted: status?.trusted };
      });
    },
    [cwd],
  );

  async function trustAction(path: string, args: string[], done: string) {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Updating trust…" });
    try {
      await runMise(["trust", ...args, path], { cwd });
      toast.style = Toast.Style.Success;
      toast.title = done;
      revalidate();
    } catch (e) {
      toast.hide();
      await showFailureToast(e, { title: "Could not update trust" });
    }
  }

  return (
    <List isLoading={isLoading} navigationTitle={`Config Files: ${projectLabel(project)}`}>
      {!isLoading && (error || !data?.length) && (
        <StateEmptyView error={error} emptyTitle="No Config Files" onReload={revalidate} />
      )}
      {data?.map((file) => (
        <List.Item
          key={file.path}
          icon={Icon.Document}
          title={tildify(file.path)}
          subtitle={file.tools.length > 0 ? file.tools.join(", ") : undefined}
          accessories={[
            ...(file.override ? [{ tag: "Override" }] : []),
            ...(file.trusted === false
              ? [{ tag: { value: "Untrusted", color: Color.Red } }]
              : file.trusted
                ? [{ tag: { value: "Trusted", color: Color.Green } }]
                : []),
          ]}
          actions={
            <ActionPanel>
              <Action.Open title="Open Config File" target={file.path} />
              <Action.ShowInFinder path={file.path} />
              {file.trusted === false ? (
                <Action
                  title="Trust Config"
                  icon={Icon.CheckCircle}
                  onAction={() => trustAction(file.path, [], "Config trusted")}
                />
              ) : null}
              {file.trusted ? (
                <Action
                  title="Untrust Config"
                  icon={Icon.XMarkCircle}
                  onAction={() => trustAction(file.path, ["--untrust"], "Trust removed")}
                />
              ) : null}
              <Action
                title="Ignore Config"
                icon={Icon.EyeDisabled}
                style={Action.Style.Destructive}
                onAction={async () => {
                  const confirmed = await confirmAlert({
                    title: "Ignore this config?",
                    message: "mise will skip this config file from now on, until you trust it again.",
                    primaryAction: { title: "Ignore", style: Alert.ActionStyle.Destructive },
                  });
                  if (confirmed) await trustAction(file.path, ["--ignore"], "Config ignored");
                }}
              />
              <Action.CopyToClipboard
                title="Copy Path"
                content={file.path}
                shortcut={Keyboard.Shortcut.Common.CopyPath}
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
      ))}
    </List>
  );
}

function AddProjectForm({ onAdded }: { onAdded: (path: string) => void }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle="Add Project"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Add Project"
            icon={Icon.Plus}
            onSubmit={async (values: { folder: string[] }) => {
              const folder = values.folder?.[0];
              if (!folder) {
                await showToast({ style: Toast.Style.Failure, title: "Choose a folder" });
                return;
              }
              try {
                if (!statSync(folder).isDirectory()) throw new Error("Not a folder");
              } catch {
                await showToast({ style: Toast.Style.Failure, title: "Choose a folder" });
                return;
              }
              await addProject(folder);
              await showToast({ style: Toast.Style.Success, title: "Project added", message: tildify(folder) });
              onAdded(folder);
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="folder"
        title="Folder"
        allowMultipleSelection={false}
        canChooseDirectories
        canChooseFiles={false}
      />
      <Form.Description text="Projects that mise has already loaded appear automatically. Add a folder here to keep it in the list." />
    </Form>
  );
}

const KIND_SECTIONS: { kind: Project["kind"]; title: string }[] = [
  { kind: "global", title: "Global" },
  { kind: "added", title: "Added" },
  { kind: "tracked", title: "Tracked by Mise" },
];

export default function Command() {
  const { project: current, setProject, projects, isLoadingProjects, reloadProjects } = useProject();

  const addAction = (
    <Action.Push
      title="Add Project"
      icon={Icon.Plus}
      shortcut={Keyboard.Shortcut.Common.New}
      target={
        <AddProjectForm
          onAdded={(path) => {
            setProject(path);
            reloadProjects();
          }}
        />
      }
    />
  );

  return (
    <List isLoading={isLoadingProjects} searchBarPlaceholder="Filter projects…">
      {!isLoadingProjects && projects.length === 0 ? (
        <List.EmptyView title="No Projects" actions={<ActionPanel>{addAction}</ActionPanel>} />
      ) : null}
      {KIND_SECTIONS.map(({ kind, title }) => (
        <List.Section key={kind} title={title}>
          {projects
            .filter((p) => p.kind === kind)
            .map((p) => {
              const isCurrent = p.id === current;
              return (
                <List.Item
                  key={p.id}
                  icon={p.kind === "global" ? Icon.Globe : p.kind === "added" ? Icon.Star : Icon.Folder}
                  title={p.name}
                  accessories={isCurrent ? [{ tag: { value: "Current", color: Color.Green } }] : []}
                  actions={
                    <ActionPanel>
                      <ActionPanel.Section>
                        {!isCurrent ? (
                          <Action
                            title="Set as Current Project"
                            icon={Icon.CheckCircle}
                            onAction={async () => {
                              setProject(p.id);
                              await showToast({
                                style: Toast.Style.Success,
                                title: "Current project changed",
                                message: projectLabel(p.id),
                              });
                            }}
                          />
                        ) : null}
                        <Action.Push
                          title="Show Config Files"
                          icon={Icon.Document}
                          target={<ConfigFiles project={p.id} />}
                        />
                        {p.id !== GLOBAL_PROJECT ? <Action.ShowInFinder path={p.id} /> : null}
                        {p.id !== GLOBAL_PROJECT ? (
                          <Action.CopyToClipboard
                            title="Copy Path"
                            content={p.id}
                            shortcut={Keyboard.Shortcut.Common.CopyPath}
                          />
                        ) : null}
                      </ActionPanel.Section>
                      <ProjectActions project={p.id} />
                      <ActionPanel.Section>
                        {addAction}
                        {p.kind === "added" ? (
                          <Action
                            title="Remove from List"
                            icon={Icon.Trash}
                            style={Action.Style.Destructive}
                            shortcut={Keyboard.Shortcut.Common.Remove}
                            onAction={async () => {
                              await removeAddedProject(p.id);
                              if (isCurrent) setProject(GLOBAL_PROJECT);
                              reloadProjects();
                            }}
                          />
                        ) : null}
                        <Action
                          title="Reload"
                          icon={Icon.ArrowClockwise}
                          shortcut={Keyboard.Shortcut.Common.Refresh}
                          onAction={reloadProjects}
                        />
                      </ActionPanel.Section>
                    </ActionPanel>
                  }
                />
              );
            })}
        </List.Section>
      ))}
    </List>
  );
}
