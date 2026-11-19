import {
  Action,
  ActionPanel,
  Form,
  Icon,
  open,
  popToRoot,
  showInFinder,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { showFailureToast, useCachedPromise } from "@raycast/utils";
import { useState } from "react";
import { listTasks } from "./lib/mise";
import { GLOBAL_PROJECT, projectCwd, projectLabel } from "./lib/projects";
import { createTask, validateTaskName, type TaskKind } from "./lib/tasks";
import { useProject } from "./lib/use-project";

interface FormValues {
  kind: TaskKind;
  project: string;
  name: string;
  description: string;
  run: string;
  depends: string[];
  hide: boolean;
}

export interface CreateTaskFormProps {
  /** project preselected in the form; defaults to the project chosen in the extension */
  project?: string;
  /** called after the task was created; the form then closes itself with a pop */
  onCreated?: () => void;
}

export function CreateTaskForm({ project: initialProject, onCreated }: CreateTaskFormProps) {
  const { project: currentProject, projects } = useProject();
  const { pop } = useNavigation();
  const [project, setProject] = useState<string>(initialProject ?? currentProject);
  const [kind, setKind] = useState<TaskKind>("toml");
  const [nameError, setNameError] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);

  const { data: existing = [], isLoading } = useCachedPromise(
    (cwd?: string) => listTasks(cwd, true),
    [projectCwd(project)],
    {
      keepPreviousData: true,
      failureToastOptions: { title: "Could Not Load Existing Tasks" },
    },
  );
  const known = projects.some((p) => p.id === project);

  async function submit(values: FormValues, openAfter: boolean) {
    const name = values.name.trim();
    const error = validateTaskName(name, values.kind);
    if (error) {
      setNameError(error);
      return;
    }
    setIsSaving(true);
    try {
      const { path } = await createTask({
        kind: values.kind,
        name,
        description: values.description.trim() || undefined,
        run: values.run,
        depends: values.depends,
        hide: values.hide,
        cwd: projectCwd(values.project),
      });
      // a file task is an executable script: `open` could run it, so reveal it instead
      const reveal = () => (values.kind === "file" ? showInFinder(path) : open(path));
      if (openAfter) await reveal();
      await showToast({
        style: Toast.Style.Success,
        title: "Created Task",
        message: name,
        primaryAction: {
          title: values.kind === "file" ? "Show in Finder" : "Open Task Definition",
          onAction: () => reveal(),
        },
      });
      if (onCreated) {
        onCreated();
        pop();
      } else {
        await popToRoot({ clearSearchBar: true });
      }
    } catch (e) {
      await showFailureToast(e, { title: "Could Not Create Task" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Form
      // only when pushed from Run Task; a root view must not set its own title
      navigationTitle={onCreated ? "Create Task" : undefined}
      isLoading={isLoading || isSaving}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Task" icon={Icon.Plus} onSubmit={(v: FormValues) => submit(v, false)} />
          <Action.SubmitForm
            title="Create Task and Open Definition"
            icon={Icon.Document}
            onSubmit={(v: FormValues) => submit(v, true)}
          />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="project" title="Project" value={project} onChange={setProject}>
        <Form.Dropdown.Item title="Global" value={GLOBAL_PROJECT} icon={Icon.Globe} />
        {!known && project !== GLOBAL_PROJECT ? (
          <Form.Dropdown.Item title={projectLabel(project)} value={project} icon={Icon.Folder} />
        ) : null}
        {projects
          .filter((p) => p.id !== GLOBAL_PROJECT)
          .map((p) => (
            <Form.Dropdown.Item key={p.id} title={p.name} value={p.id} icon={Icon.Folder} />
          ))}
      </Form.Dropdown>
      <Form.Dropdown
        id="kind"
        title="Type"
        value={kind}
        onChange={(v) => {
          setKind(v as TaskKind);
          setNameError(undefined);
        }}
        info="A TOML task lives in the project's mise.toml. A file task is an executable script in mise-tasks/."
      >
        <Form.Dropdown.Item title="TOML Task" value="toml" icon={Icon.Document} />
        <Form.Dropdown.Item title="File Task" value="file" icon={Icon.Terminal} />
      </Form.Dropdown>
      <Form.TextField
        id="name"
        title="Name"
        placeholder={kind === "file" ? "build or test:unit" : "build"}
        error={nameError}
        onChange={() => setNameError(undefined)}
        info={kind === "file" ? "Use : for nested tasks. They become subfolders of mise-tasks/." : undefined}
      />
      <Form.TextField id="description" title="Description" placeholder="What the task does" />
      <Form.TextArea id="run" title="Run" placeholder="npm run build" info="One command per line." />
      <Form.TagPicker id="depends" title="Depends" info="Tasks that run before this one.">
        {existing.map((t) => (
          <Form.TagPicker.Item key={t.name} title={t.name} value={t.name} />
        ))}
      </Form.TagPicker>
      <Form.Checkbox id="hide" label="Hide from Task Lists" defaultValue={false} />
    </Form>
  );
}

export default function Command() {
  return <CreateTaskForm />;
}
