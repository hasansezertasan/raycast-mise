import {
  Action,
  ActionPanel,
  Alert,
  Color,
  confirmAlert,
  Detail,
  Form,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { showFailureToast, useCachedPromise, useCachedState, usePromise } from "@raycast/utils";
import { sep } from "node:path";
import { useState } from "react";
import { ProjectDropdown } from "./components/ProjectDropdown";
import { StreamedRun } from "./components/StreamedRun";
import { CreateTaskForm } from "./create-task";
import { StateEmptyView } from "./lib/empty-view";
import { getTaskDeps, getTaskInfo, listTasks, runMise, type MiseTask, type UsageArg, type UsageFlag } from "./lib/mise";
import { projectLabel, tildify } from "./lib/projects";
import { useProject } from "./lib/use-project";

/** The task artifact cache is experimental in mise; enable it for these calls only. */
const EXPERIMENTAL_ENV = { MISE_EXPERIMENTAL: "1" };

interface ProjectProps {
  project: string;
  cwd?: string;
}

function sourceLabel(source: string, cwd?: string): string {
  if (cwd && source.startsWith(cwd + sep)) return source.slice(cwd.length + 1);
  return tildify(source);
}

function asArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Splits on whitespace; good enough for list-valued args and flags. */
function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

// ---------- Form generated from a task's usage spec ----------

interface UsageSpec {
  args: UsageArg[];
  flags: UsageFlag[];
}

function flagToken(flag: UsageFlag): string {
  return flag.long.length > 0 ? `--${flag.long[0]}` : `-${flag.short[0]}`;
}

function flagTitle(flag: UsageFlag): string {
  return [...flag.short.map((s) => `-${s}`), ...flag.long.map((l) => `--${l}`)].join(", ");
}

export function buildTaskArgs(spec: UsageSpec, values: Record<string, string | boolean>): string[] {
  const flags: string[] = [];
  for (const flag of spec.flags) {
    const value = values[`flag:${flag.name}`];
    if (!flag.arg) {
      const defaultOn = asArray(flag.default).join(" ") === "true";
      if (value === true && !defaultOn) flags.push(flagToken(flag));
      // a default-true flag is only turned off by its negation
      if (value === false && defaultOn && flag.negate) flags.push(flag.negate);
      continue;
    }
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) continue;
    for (const item of flag.var ? words(text) : [text]) flags.push(flagToken(flag), item);
  }

  const positional: string[] = [];
  for (const arg of spec.args) {
    const text = String(values[`arg:${arg.name}`] ?? "").trim();
    if (arg.var) positional.push(...words(text));
    else positional.push(text);
  }
  while (positional.length > 0 && positional[positional.length - 1] === "") positional.pop();

  const needsSeparator = positional.some((p) => p.startsWith("-"));
  return [...flags, ...(needsSeparator ? ["--"] : []), ...positional];
}

function UsageField({ id, title, arg, defaultValue, info, error, onChange }: UsageFieldProps) {
  const choices = arg.choices?.choices;
  if (choices && choices.length > 0) {
    return (
      <Form.Dropdown
        id={id}
        title={title}
        defaultValue={defaultValue || (arg.required ? choices[0] : "")}
        info={info}
        error={error}
        onChange={onChange}
      >
        {arg.required ? null : <Form.Dropdown.Item title="None" value="" />}
        {choices.map((c) => (
          <Form.Dropdown.Item key={c} title={c} value={c} />
        ))}
      </Form.Dropdown>
    );
  }
  return (
    <Form.TextField
      id={id}
      title={title}
      placeholder={arg.required ? "Required" : "Optional"}
      defaultValue={defaultValue}
      info={info}
      error={error}
      onChange={onChange}
    />
  );
}

interface UsageFieldProps {
  id: string;
  title: string;
  arg: UsageArg;
  defaultValue: string;
  info?: string;
  error?: string;
  onChange: () => void;
}

function TaskArgsForm({ task, spec, cwd, project }: ProjectProps & { task: string; spec: UsageSpec }) {
  const { push } = useNavigation();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(values: Record<string, string | boolean>) {
    const next: Record<string, string> = {};
    for (const arg of spec.args) {
      if (arg.required && !String(values[`arg:${arg.name}`] ?? "").trim()) next[`arg:${arg.name}`] = "Required";
    }
    for (const flag of spec.flags) {
      if (flag.arg && flag.required && !String(values[`flag:${flag.name}`] ?? "").trim())
        next[`flag:${flag.name}`] = "Required";
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const args = ["run", task, ...buildTaskArgs(spec, values)];
    push(<StreamedRun title={`mise run ${task}`} args={args} cwd={cwd} project={project} />);
  }

  const clear = (id: string) => () => setErrors((e) => ({ ...e, [id]: "" }));

  return (
    <Form
      navigationTitle={`Run ${task}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Run Task" icon={Icon.Play} onSubmit={submit} />
        </ActionPanel>
      }
    >
      {spec.flags.map((flag) => {
        const id = `flag:${flag.name}`;
        const def = asArray(flag.default).join(" ");
        if (!flag.arg && def === "true" && !flag.negate) {
          // on by default and the spec gives no way to turn it off
          return <Form.Description key={id} title={flagTitle(flag)} text={`${flag.help ?? flag.name} (always on)`} />;
        }
        if (!flag.arg) {
          return (
            <Form.Checkbox
              key={id}
              id={id}
              title={flagTitle(flag)}
              label={flag.help ?? flag.name}
              defaultValue={def === "true"}
            />
          );
        }
        return (
          <UsageField
            key={id}
            id={id}
            title={flagTitle(flag)}
            arg={{ ...flag.arg, required: flag.required }}
            defaultValue={def}
            info={flag.help}
            error={errors[id] || undefined}
            onChange={clear(id)}
          />
        );
      })}
      {spec.args.map((arg) => {
        const id = `arg:${arg.name}`;
        return (
          <UsageField
            key={id}
            id={id}
            title={arg.var ? `${arg.name} (Multiple)` : arg.name}
            arg={arg}
            defaultValue={asArray(arg.default).join(" ")}
            info={arg.help}
            error={errors[id] || undefined}
            onChange={clear(id)}
          />
        );
      })}
    </Form>
  );
}

// ---------- Detail views ----------

function CommandOutput({
  title,
  args,
  cwd,
  env,
}: {
  title: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}) {
  const { data, error, isLoading, revalidate } = usePromise(
    async () => {
      try {
        return { text: await runMise(args, { cwd, env }), failed: false };
      } catch (e) {
        return { text: e instanceof Error ? e.message : String(e), failed: true };
      }
    },
    [],
    { failureToastOptions: { title: `Could Not Run ${title}` } },
  );
  const body = data ? data.text.trim().replace(/```/g, "ʼʼʼ") : error ? String(error) : "";
  const markdown = isLoading
    ? "_Loading…_"
    : (data?.failed ? `**Failed**\n\n` : "") + (body ? "```\n" + body + "\n```" : "_No output._");
  return (
    <Detail
      navigationTitle={title}
      isLoading={isLoading}
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action
            title="Reload"
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={revalidate}
          />
          {data ? <Action.CopyToClipboard title="Copy Output" content={data.text} /> : null}
        </ActionPanel>
      }
    />
  );
}

function DependenciesView({ task, cwd }: { task?: string; cwd?: string }) {
  const { data, isLoading, error, revalidate } = useCachedPromise(getTaskDeps, [task, cwd], {
    failureToastOptions: { title: "Could Not Load Dependencies" },
  });
  const text = data?.trim() ?? "";
  const markdown = error
    ? `**Failed**\n\n\`\`\`\n${error.message}\n\`\`\``
    : isLoading && !data
      ? "_Loading…_"
      : text
        ? "```\n" + text.replace(/```/g, "ʼʼʼ") + "\n```"
        : "_No dependencies._";
  return (
    <Detail
      navigationTitle={task ? `Dependencies of ${task}` : "All Task Dependencies"}
      isLoading={isLoading}
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action
            title="Reload"
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={revalidate}
          />
          {text ? <Action.CopyToClipboard title="Copy Dependencies" content={text} /> : null}
        </ActionPanel>
      }
    />
  );
}

// ---------- Actions ----------

function RunTaskAction({ task, cwd, project }: ProjectProps & { task: string }) {
  const { push } = useNavigation();

  async function run() {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Reading Task Arguments…" });
    try {
      const info = await getTaskInfo(task, cwd);
      toast.hide();
      const cmd = info.usage_spec?.cmd;
      const spec: UsageSpec = {
        args: (cmd?.args ?? []).filter((a) => !a.hide),
        flags: (cmd?.flags ?? []).filter((f) => !f.hide),
      };
      if (spec.args.length > 0 || spec.flags.length > 0) {
        push(<TaskArgsForm task={task} spec={spec} cwd={cwd} project={project} />);
      } else {
        push(<StreamedRun title={`mise run ${task}`} args={["run", task]} cwd={cwd} project={project} />);
      }
    } catch (error) {
      toast.hide();
      await showFailureToast(error, { title: "Could Not Read Task Arguments" });
    }
  }

  return <Action title="Run Task" icon={Icon.Play} onAction={run} />;
}

function RunVariantAction({
  title,
  icon,
  args,
  cwd,
  project,
  shortcut,
  env,
}: ProjectProps & {
  title: string;
  icon: Icon;
  args: string[];
  shortcut?: Keyboard.Shortcut;
  env?: Record<string, string>;
}) {
  return (
    <Action.Push
      title={title}
      icon={icon}
      shortcut={shortcut}
      target={<StreamedRun title={`mise ${args.join(" ")}`} args={args} cwd={cwd} env={env} project={project} />}
    />
  );
}

async function clearTaskCache(task: string, cwd?: string) {
  const confirmed = await confirmAlert({
    title: "Clear Task Cache?",
    message: `Deletes the cached artifacts of ${task}. The task runs from scratch next time.`,
    primaryAction: { title: "Clear Cache", style: Alert.ActionStyle.Destructive },
  });
  if (!confirmed) return;
  const toast = await showToast({ style: Toast.Style.Animated, title: "Clearing Task Cache…" });
  try {
    await runMise(["cache", "clear", "--task", task], { cwd, env: EXPERIMENTAL_ENV });
    toast.style = Toast.Style.Success;
    toast.title = "Cleared Task Cache";
    toast.message = task;
  } catch (error) {
    toast.hide();
    await showFailureToast(error, { title: "Could Not Clear Task Cache" });
  }
}

// ---------- List ----------

function taskDetail(task: MiseTask, cwd?: string) {
  const run = task.run.join("\n").trim();
  const list = (title: string, items?: string[]) =>
    items && items.length > 0 ? <List.Item.Detail.Metadata.Label title={title} text={items.join(", ")} /> : null;
  return (
    <List.Item.Detail
      markdown={run ? "```sh\n" + run.replace(/```/g, "ʼʼʼ") + "\n```" : "_No run command._"}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Name" text={task.name} />
          {task.description ? <List.Item.Detail.Metadata.Label title="Description" text={task.description} /> : null}
          {list("Aliases", task.aliases)}
          {list("Tags", task.tags)}
          {list("Depends", task.depends)}
          {list("Depends Post", task.depends_post)}
          {list("Wait For", task.wait_for)}
          {list("Sources", task.sources)}
          {list("Outputs", task.outputs)}
          {task.dir ? <List.Item.Detail.Metadata.Label title="Directory" text={tildify(task.dir)} /> : null}
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label title="Source" text={sourceLabel(task.file ?? task.source, cwd)} />
        </List.Item.Detail.Metadata>
      }
    />
  );
}

export default function Command() {
  const { project, setProject, cwd, projects } = useProject();
  const [showHidden, setShowHidden] = useCachedState("mise.tasks.showHidden", false);
  const [grouped, setGrouped] = useCachedState("mise.tasks.grouped", true);
  const [showDetail, setShowDetail] = useCachedState("mise.tasks.showDetail", false);

  const {
    data: tasks,
    isLoading,
    error,
    revalidate,
  } = useCachedPromise((dir: string | undefined, hidden: boolean) => listTasks(dir, hidden), [cwd, showHidden], {
    keepPreviousData: true,
    failureToastOptions: { title: "Could Not Load Tasks" },
  });

  const sections = new Map<string, MiseTask[]>();
  for (const task of tasks ?? []) {
    const key = grouped ? sourceLabel(task.file ?? task.source, cwd) : "";
    sections.set(key, [...(sections.get(key) ?? []), task]);
  }
  // group by the config file; file tasks live in their own script, so group those by directory
  const orderedSections = [...sections.entries()].sort(([a], [b]) => a.localeCompare(b));

  const createAction = (
    <Action.Push
      title="Create Task"
      icon={Icon.Plus}
      shortcut={Keyboard.Shortcut.Common.New}
      target={<CreateTaskForm project={project} onCreated={revalidate} />}
    />
  );

  const listActions = (
    <>
      {createAction}
      <Action.Push title="Show All Dependencies" icon={Icon.Network} target={<DependenciesView cwd={cwd} />} />
      <Action
        title={grouped ? "Show Flat List" : "Group by Source File"}
        icon={Icon.List}
        onAction={() => setGrouped(!grouped)}
      />
      <Action
        title={showHidden ? "Hide Hidden Tasks" : "Show Hidden Tasks"}
        icon={showHidden ? Icon.EyeDisabled : Icon.Eye}
        onAction={() => setShowHidden(!showHidden)}
      />
      <Action
        title={showDetail ? "Hide Details" : "Show Details"}
        icon={Icon.Sidebar}
        shortcut={{ macOS: { modifiers: ["cmd"], key: "d" }, Windows: { modifiers: ["ctrl"], key: "d" } }}
        onAction={() => setShowDetail(!showDetail)}
      />
      <Action
        title="Reload"
        icon={Icon.ArrowClockwise}
        shortcut={Keyboard.Shortcut.Common.Refresh}
        onAction={revalidate}
      />
    </>
  );

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={showDetail && (tasks?.length ?? 0) > 0}
      searchBarPlaceholder="Search Tasks by Name, Alias, Description or Tag"
      searchBarAccessory={<ProjectDropdown project={project} projects={projects} onChange={setProject} />}
    >
      {!isLoading && (tasks?.length ?? 0) === 0 ? (
        <StateEmptyView
          error={error}
          emptyTitle="No Tasks"
          emptyDescription={`${projectLabel(project)} defines no tasks. Use Create Task to add one.`}
          onReload={revalidate}
        />
      ) : null}
      {orderedSections.map(([source, items]) => (
        <List.Section key={source || "all"} title={source || undefined} subtitle={`${items.length}`}>
          {items.map((task) => {
            const file = task.file ?? task.source;
            const accessories: List.Item.Accessory[] = [];
            for (const alias of task.aliases) accessories.push({ tag: alias, tooltip: "Alias" });
            if (task.depends.length > 0)
              accessories.push({
                icon: Icon.Network,
                text: String(task.depends.length),
                tooltip: `Depends on ${task.depends.join(", ")}`,
              });
            if (task.global) accessories.push({ tag: { value: "Global", color: Color.Blue } });
            if (task.hide) accessories.push({ icon: Icon.EyeDisabled, tooltip: "Hidden" });
            return (
              <List.Item
                key={`${task.source}:${task.name}`}
                title={task.name}
                subtitle={showDetail ? undefined : task.description}
                icon={task.file ? Icon.Terminal : Icon.Document}
                keywords={[...task.aliases, ...(task.tags ?? []), task.description, sourceLabel(file, cwd)].filter(
                  Boolean,
                )}
                accessories={accessories}
                detail={showDetail ? taskDetail(task, cwd) : undefined}
                actions={
                  <ActionPanel>
                    <ActionPanel.Section>
                      <RunTaskAction task={task.name} cwd={cwd} project={project} />
                      <RunVariantAction
                        title="Run Task Forced"
                        icon={Icon.Bolt}
                        args={["run", "--force", task.name]}
                        cwd={cwd}
                        project={project}
                      />
                      <RunVariantAction
                        title="Run Without Task Cache"
                        icon={Icon.XMarkCircle}
                        args={["run", "--task-cache", "off", task.name]}
                        cwd={cwd}
                        env={EXPERIMENTAL_ENV}
                        project={project}
                      />
                      <RunVariantAction
                        title="Run Without Remote Task Cache"
                        icon={Icon.XMarkCircle}
                        args={["run", "--no-cache", task.name]}
                        cwd={cwd}
                        project={project}
                      />
                      <RunVariantAction
                        title="Run in Watch Mode"
                        icon={Icon.Eye}
                        args={["watch", task.name]}
                        cwd={cwd}
                        project={project}
                      />
                      <RunVariantAction
                        title="Dry Run"
                        icon={Icon.Clipboard}
                        args={["run", "--dry-run", task.name]}
                        cwd={cwd}
                        project={project}
                      />
                    </ActionPanel.Section>
                    <ActionPanel.Section>
                      <Action.Push
                        title="Show Dependencies"
                        icon={Icon.Network}
                        target={<DependenciesView task={task.name} cwd={cwd} />}
                      />
                      <Action.Push
                        title="Explain Task Cache"
                        icon={Icon.QuestionMark}
                        target={
                          <CommandOutput
                            title={`Cache of ${task.name}`}
                            args={["cache", "task", task.name]}
                            cwd={cwd}
                            env={EXPERIMENTAL_ENV}
                          />
                        }
                      />
                      <Action
                        title="Clear Task Cache"
                        icon={Icon.Trash}
                        style={Action.Style.Destructive}
                        onAction={() => clearTaskCache(task.name, cwd)}
                      />
                    </ActionPanel.Section>
                    <ActionPanel.Section>
                      {task.file ? (
                        // a file task is an executable script; opening it directly could run it
                        <Action.OpenWith title="Open Task Definition with" path={file} />
                      ) : (
                        <Action.Open title="Open Task Definition" target={file} />
                      )}
                      <Action.ShowInFinder path={file} />
                      <Action.CopyToClipboard
                        title="Copy Task Name"
                        content={task.name}
                        shortcut={Keyboard.Shortcut.Common.CopyName}
                      />
                      <Action.CopyToClipboard
                        title="Copy Run Command"
                        content={`mise run ${task.name}`}
                        shortcut={Keyboard.Shortcut.Common.Copy}
                      />
                    </ActionPanel.Section>
                    <ActionPanel.Section>{listActions}</ActionPanel.Section>
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
