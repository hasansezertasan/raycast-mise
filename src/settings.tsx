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
  open,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { sep } from "node:path";
import { showFailureToast, usePromise } from "@raycast/utils";
import { useState } from "react";
import { ProjectDropdown } from "./components/ProjectDropdown";
import { StateEmptyView } from "./lib/empty-view";
import { tildify } from "./lib/projects";
import {
  editableValue,
  formatSettingValue,
  listSettingRows,
  setSetting,
  settingsDocsUrl,
  SettingRow,
  unsetSetting,
} from "./lib/settings";
import { useProject } from "./lib/use-project";

export default function Command() {
  const { project, setProject, cwd, projects } = useProject();
  const { isLoading, data, error, revalidate } = usePromise(listSettingRows, [cwd]);
  const [isShowingDetail, setIsShowingDetail] = useState(false);

  const rows = data ?? [];
  const configured = rows.filter((r) => r.source);
  const defaults = rows.filter((r) => !r.source);

  const renderRow = (row: SettingRow) => {
    const text = formatSettingValue(row.value);
    const accessories: List.Item.Accessory[] = [];
    if (!isShowingDetail) {
      accessories.push({ text: text.length > 40 ? `${text.slice(0, 40)}…` : text });
      if (row.source) accessories.push({ tag: { value: "Configured", color: Color.Green }, tooltip: row.source });
    }
    return (
      <List.Item
        key={row.key}
        icon={Icon.Cog}
        title={row.key}
        accessories={accessories}
        detail={
          <List.Item.Detail
            markdown={`## ${row.key}\n\n${row.description}\n\n\`\`\`json\n${JSON.stringify(row.value, null, 2) ?? ""}\n\`\`\``}
            metadata={
              <List.Item.Detail.Metadata>
                <List.Item.Detail.Metadata.Label title="Key" text={row.key} />
                <List.Item.Detail.Metadata.Label title="Type" text={row.type} />
                <List.Item.Detail.Metadata.Label title="Value" text={text || "(empty)"} />
                {row.source ? (
                  <List.Item.Detail.Metadata.Label title="Defined In" text={tildify(row.source)} />
                ) : (
                  <List.Item.Detail.Metadata.Label title="Defined In" text="Default" />
                )}
              </List.Item.Detail.Metadata>
            }
          />
        }
        actions={
          <ActionPanel>
            <ActionPanel.Section>
              <Action.Push
                title="Edit Setting"
                icon={Icon.Pencil}
                shortcut={Keyboard.Shortcut.Common.Edit}
                target={<EditSettingForm row={row} cwd={cwd} onDone={revalidate} />}
              />
              {row.source ? (
                <Action
                  title="Reset Setting"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={Keyboard.Shortcut.Common.Remove}
                  onAction={() => resetSetting(row, cwd, revalidate)}
                />
              ) : null}
            </ActionPanel.Section>
            <ActionPanel.Section>
              <Action.CopyToClipboard title="Copy Key" content={row.key} />
              <Action.CopyToClipboard title="Copy Value" content={text} />
              <Action.OpenInBrowser title="Open Settings Docs" url={settingsDocsUrl(row.key)} />
              {row.source ? <Action.Open title="Open Config File" target={row.source} /> : null}
            </ActionPanel.Section>
            <ActionPanel.Section>
              <Action
                title={isShowingDetail ? "Hide Details" : "Show Details"}
                icon={Icon.Sidebar}
                shortcut={{ macOS: { modifiers: ["cmd"], key: "d" }, Windows: { modifiers: ["ctrl"], key: "d" } }}
                onAction={() => setIsShowingDetail((v) => !v)}
              />
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
  };

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={isShowingDetail}
      searchBarPlaceholder="Filter settings…"
      searchBarAccessory={<ProjectDropdown project={project} projects={projects} onChange={setProject} />}
    >
      {!isLoading && rows.length === 0 ? (
        <StateEmptyView error={error} emptyTitle="No Settings Found" onReload={revalidate} />
      ) : null}
      {configured.length > 0 ? (
        <List.Section title="Configured" subtitle={String(configured.length)}>
          {configured.map(renderRow)}
        </List.Section>
      ) : null}
      {defaults.length > 0 ? (
        <List.Section title="Defaults" subtitle={String(defaults.length)}>
          {defaults.map(renderRow)}
        </List.Section>
      ) : null}
    </List>
  );
}

async function resetSetting(row: SettingRow, cwd: string | undefined, onDone: () => void) {
  // `mise settings unset` can only edit the global config or the nearest project config (--local),
  // so a setting defined anywhere else has to be removed by hand
  const local = !isGlobalConfig(row.source);
  if (local && !(cwd && row.source && isNearestProjectConfig(row.source, cwd))) {
    await showToast({
      style: Toast.Style.Failure,
      title: `Cannot reset ${row.key} here`,
      message: row.source ? `It is set in ${tildify(row.source)}. Open that file to remove it.` : undefined,
      primaryAction: row.source ? { title: "Open Config File", onAction: () => open(row.source as string) } : undefined,
    });
    return;
  }
  const confirmed = await confirmAlert({
    title: `Reset ${row.key}?`,
    message: `This removes ${row.key} from ${local ? "the project config" : "the global config"}, so it falls back to its default.`,
    primaryAction: { title: "Reset Setting", style: Alert.ActionStyle.Destructive },
  });
  if (!confirmed) return;
  const toast = await showToast({ style: Toast.Style.Animated, title: `Resetting ${row.key}` });
  try {
    await unsetSetting(row.key, local, cwd);
    toast.style = Toast.Style.Success;
    toast.title = `Reset ${row.key}`;
    onDone();
  } catch (error) {
    await toast.hide();
    await showFailureToast(error, { title: `Could not reset ${row.key}` });
  }
}

/** A config file of the project folder itself (not a parent folder, not a local or env-specific file). */
function isNearestProjectConfig(source: string, cwd: string): boolean {
  const relative = source.startsWith(cwd + sep) ? source.slice(cwd.length + 1).replace(/\\/g, "/") : "";
  return ["mise.toml", ".mise.toml", ".config/mise.toml", ".config/mise/config.toml", ".mise/config.toml"].includes(
    relative,
  );
}

function isGlobalConfig(source?: string): boolean {
  if (!source) return true;
  const normalized = source.replace(/\\/g, "/");
  return /\/\.config\/mise\/(config(\.[^/]+)?\.toml)$/.test(normalized);
}

function EditSettingForm({ row, cwd, onDone }: { row: SettingRow; cwd?: string; onDone: () => void }) {
  const { pop } = useNavigation();
  const isBoolean = row.type === "boolean";
  // edit the file the value comes from: a setting from the global config defaults to the global target
  const defaultTarget = cwd && !(row.source && isGlobalConfig(row.source)) ? "project" : "global";

  async function submit(values: { value?: string; checked?: boolean; target?: string }) {
    const local = Boolean(cwd) && values.target !== "global";
    const value = isBoolean ? String(Boolean(values.checked)) : (values.value ?? "");
    const toast = await showToast({ style: Toast.Style.Animated, title: `Saving ${row.key}` });
    try {
      await setSetting(row.key, value, local, cwd);
      toast.style = Toast.Style.Success;
      toast.title = `Saved ${row.key}`;
      onDone();
      pop();
    } catch (error) {
      await toast.hide();
      await showFailureToast(error, { title: `Could not save ${row.key}` });
      return false;
    }
  }

  return (
    <Form
      navigationTitle={`Edit ${row.key}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Setting" icon={Icon.Check} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.Description title="Setting" text={`${row.key} (${row.type})\n${row.description}`} />
      {isBoolean ? (
        <Form.Checkbox id="checked" title="Value" label="Enabled" defaultValue={row.value === true} />
      ) : (
        <Form.TextField
          id="value"
          title="Value"
          defaultValue={editableValue(row)}
          info={row.type === "array" ? "Separate items with commas" : undefined}
        />
      )}
      {cwd ? (
        <Form.Dropdown id="target" title="Target" defaultValue={defaultTarget}>
          <Form.Dropdown.Item value="project" title={`Project Config (${tildify(cwd)})`} />
          <Form.Dropdown.Item value="global" title="Global Config" />
        </Form.Dropdown>
      ) : (
        <Form.Description title="Target" text="Global config" />
      )}
    </Form>
  );
}
