import {
  Action,
  ActionPanel,
  Alert,
  Color,
  confirmAlert,
  Form,
  getPreferenceValues,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import { useState } from "react";
import { ProjectDropdown } from "./components/ProjectDropdown";
import {
  envGroup,
  hasSourceFile,
  isMiseInstallPath,
  isPathKey,
  MASK,
  setEnvVar,
  splitPath,
  toExport,
  unsetEnvVar,
} from "./lib/env";
import { StateEmptyView } from "./lib/empty-view";
import { getEnvExtended, MiseEnvEntry } from "./lib/mise";
import { projectLabel, tildify } from "./lib/projects";
import { useProject } from "./lib/use-project";

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export default function Command() {
  const { showEnvValues } = getPreferenceValues<Preferences>();
  const { project, setProject, cwd, projects } = useProject();
  const { isLoading, data, error, revalidate } = usePromise(getEnvExtended, [cwd]);

  // `showAll` is the list-wide mode; the sets hold per-variable exceptions to it
  const [showAll, setShowAll] = useState<boolean>(Boolean(showEnvValues));
  const [exceptions, setExceptions] = useState<Set<string>>(new Set());

  const isRevealed = (name: string) => (showAll ? !exceptions.has(name) : exceptions.has(name));
  const toggle = (name: string) =>
    setExceptions((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const setAll = (reveal: boolean) => {
    setShowAll(reveal);
    setExceptions(new Set());
  };

  const entries = Object.entries(data ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const pathEntry = entries.find(([name]) => isPathKey(name));
  const others = entries.filter(([name]) => !isPathKey(name));
  const fromConfig = others.filter(([, e]) => envGroup(e) === "config");
  const fromTools = others.filter(([, e]) => envGroup(e) === "tools");
  const rest = others.filter(([, e]) => envGroup(e) === "other");

  const listActions = (
    <>
      <Action.Push
        title="Set Environment Variable"
        icon={Icon.Plus}
        shortcut={Keyboard.Shortcut.Common.New}
        target={<SetEnvForm cwd={cwd} onDone={revalidate} />}
      />
      {showAll ? (
        <Action title="Hide All Values" icon={Icon.EyeDisabled} onAction={() => setAll(false)} />
      ) : (
        <Action title="Reveal All Values" icon={Icon.Eye} onAction={() => setAll(true)} />
      )}
      <Action
        title="Reload"
        icon={Icon.ArrowClockwise}
        shortcut={Keyboard.Shortcut.Common.Refresh}
        onAction={revalidate}
      />
    </>
  );

  const renderRow = (name: string, entry: MiseEnvEntry) => {
    const revealed = isRevealed(name);
    const accessories: List.Item.Accessory[] = [{ text: revealed ? entry.value : MASK }];
    if (entry.tool) accessories.push({ tag: { value: entry.tool, color: Color.Blue }, tooltip: "Set by tool" });
    else if (entry.source) accessories.push({ text: tildify(entry.source), tooltip: entry.source });

    return (
      <List.Item
        key={name}
        icon={Icon.Terminal}
        title={name}
        accessories={accessories}
        actions={
          <ActionPanel>
            <ActionPanel.Section>
              <Action
                title={revealed ? "Hide Value" : "Reveal Value"}
                icon={revealed ? Icon.EyeDisabled : Icon.Eye}
                onAction={() => toggle(name)}
              />
              <Action.CopyToClipboard title="Copy Value" content={entry.value} concealed />
              <Action.CopyToClipboard title="Copy Name" content={name} />
              <Action.CopyToClipboard title="Copy as Export" content={toExport(name, entry.value)} concealed />
            </ActionPanel.Section>
            {hasSourceFile(entry) ? (
              <ActionPanel.Section>
                <Action.Open title="Find Definition" icon={Icon.Document} target={entry.source} />
                <Action.ShowInFinder path={entry.source} />
              </ActionPanel.Section>
            ) : null}
            <ActionPanel.Section>
              {hasSourceFile(entry) && !entry.tool ? (
                <Action
                  title="Unset Variable"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={Keyboard.Shortcut.Common.Remove}
                  onAction={() => unsetVariable(name, entry.source, cwd, revalidate)}
                />
              ) : null}
              {pathEntry ? (
                <Action.Push title="Show PATH" icon={Icon.List} target={<PathList value={pathEntry[1].value} />} />
              ) : null}
              {listActions}
            </ActionPanel.Section>
          </ActionPanel>
        }
      />
    );
  };

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Filter environment variables…"
      searchBarAccessory={<ProjectDropdown project={project} projects={projects} onChange={setProject} />}
    >
      {!isLoading && entries.length === 0 ? (
        <StateEmptyView
          error={error}
          emptyTitle="No Environment Variables"
          emptyDescription={`Nothing is set under [env] for ${projectLabel(project)}.`}
          onReload={revalidate}
        />
      ) : null}
      {fromConfig.length > 0 ? (
        <List.Section title="Set by Config" subtitle={String(fromConfig.length)}>
          {fromConfig.map(([name, entry]) => renderRow(name, entry))}
        </List.Section>
      ) : null}
      {fromTools.length > 0 ? (
        <List.Section title="Set by Tools" subtitle={String(fromTools.length)}>
          {fromTools.map(([name, entry]) => renderRow(name, entry))}
        </List.Section>
      ) : null}
      {rest.length > 0 ? (
        <List.Section title="Other" subtitle={String(rest.length)}>
          {rest.map(([name, entry]) => renderRow(name, entry))}
        </List.Section>
      ) : null}
      {pathEntry ? (
        <List.Section title="PATH">
          <List.Item
            icon={Icon.List}
            title={pathEntry[0]}
            accessories={[{ text: `${splitPath(pathEntry[1].value).length} entries` }]}
            actions={
              <ActionPanel>
                <Action.Push title="Show PATH" icon={Icon.List} target={<PathList value={pathEntry[1].value} />} />
                <Action.CopyToClipboard title="Copy Value" content={pathEntry[1].value} />
                <Action.CopyToClipboard title="Copy Name" content={pathEntry[0]} />
                {listActions}
              </ActionPanel>
            }
          />
        </List.Section>
      ) : null}
    </List>
  );
}

async function unsetVariable(name: string, source: string, cwd: string | undefined, onDone: () => void) {
  const confirmed = await confirmAlert({
    title: `Unset ${name}?`,
    message: `This removes ${name} from ${tildify(source)}.`,
    primaryAction: { title: "Unset Variable", style: Alert.ActionStyle.Destructive },
  });
  if (!confirmed) return;
  const toast = await showToast({ style: Toast.Style.Animated, title: `Unsetting ${name}` });
  try {
    await unsetEnvVar(name, source, cwd);
    toast.style = Toast.Style.Success;
    toast.title = `Unset ${name}`;
    onDone();
  } catch (error) {
    await toast.hide();
    await showFailureToast(error, { title: `Could not unset ${name}` });
  }
}

function SetEnvForm({ cwd, onDone }: { cwd?: string; onDone: () => void }) {
  const { pop } = useNavigation();
  const [nameError, setNameError] = useState<string | undefined>();

  async function submit(values: { name: string; value: string; target?: string }) {
    const name = values.name.trim();
    if (!NAME_PATTERN.test(name)) {
      setNameError("Use letters, digits and underscores, and don't start with a digit");
      return false;
    }
    const global = !cwd || values.target === "global";
    const toast = await showToast({ style: Toast.Style.Animated, title: `Setting ${name}` });
    try {
      await setEnvVar({ name, value: values.value, global, cwd });
      toast.style = Toast.Style.Success;
      toast.title = `Set ${name}`;
      onDone();
      pop();
    } catch (error) {
      await toast.hide();
      await showFailureToast(error, { title: `Could not set ${name}` });
      return false;
    }
  }

  return (
    <Form
      navigationTitle="Set Environment Variable"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Set Environment Variable" icon={Icon.Check} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="name"
        title="Name"
        placeholder="NODE_ENV"
        error={nameError}
        onChange={() => setNameError(undefined)}
      />
      <Form.TextField id="value" title="Value" placeholder="production" />
      {cwd ? (
        <Form.Dropdown id="target" title="Target" defaultValue="project">
          <Form.Dropdown.Item value="project" title={`Project Config (${tildify(cwd)})`} />
          <Form.Dropdown.Item value="global" title="Global Config" />
        </Form.Dropdown>
      ) : (
        <Form.Description title="Target" text="Global config" />
      )}
    </Form>
  );
}

function PathList({ value }: { value: string }) {
  const parts = splitPath(value);
  return (
    <List navigationTitle="PATH" searchBarPlaceholder="Filter PATH entries…">
      {parts.map((path, index) => {
        const mise = isMiseInstallPath(path);
        return (
          <List.Item
            key={`${index}-${path}`}
            icon={mise ? Icon.Hammer : Icon.Folder}
            title={path}
            accessories={mise ? [{ tag: { value: "Mise", color: Color.Green } }] : []}
            actions={
              <ActionPanel>
                <Action.CopyToClipboard title="Copy Path" content={path} />
                <Action.ShowInFinder path={path} />
                <Action.CopyToClipboard title="Copy Full PATH" content={value} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
