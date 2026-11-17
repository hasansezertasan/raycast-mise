import { Action, ActionPanel, Alert, confirmAlert, Detail, Icon, Keyboard, List, showToast, Toast } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { StateEmptyView } from "./lib/empty-view";
import { listTools, MiseToolInstall, uninstallTool } from "./lib/mise";

interface ToolRow {
  name: string;
  install: MiseToolInstall;
}

function toolMarkdown(name: string, install: MiseToolInstall): string {
  const lines = [`# ${name}@${install.version}`, ""];
  if (install.requested_version) lines.push(`- **Requested:** \`${install.requested_version}\``);
  if (install.active !== undefined) lines.push(`- **Active:** ${install.active ? "yes" : "no"}`);
  if (install.installed !== undefined) lines.push(`- **Installed:** ${install.installed ? "yes" : "no"}`);
  if (install.install_path) lines.push(`- **Install path:** \`${install.install_path}\``);
  if (install.symlinked_to) lines.push(`- **Symlinked to:** \`${install.symlinked_to}\``);
  if (install.source) {
    lines.push(`- **Source:** \`${install.source.type}\` (\`${install.source.path}\`)`);
  }
  return lines.join("\n");
}

function ToolDetail({ name, install }: ToolRow) {
  const markdown = toolMarkdown(name, install);
  return (
    <Detail
      navigationTitle={`${name}@${install.version}`}
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action.CopyToClipboard title="Copy Details" content={markdown} />
          {install.install_path ? (
            <Action.CopyToClipboard
              title="Copy Install Path"
              content={install.install_path}
              shortcut={Keyboard.Shortcut.Common.CopyPath}
            />
          ) : null}
        </ActionPanel>
      }
    />
  );
}

export default function Command() {
  const { isLoading, data, error, revalidate } = usePromise(async (): Promise<ToolRow[]> => {
    const tools = await listTools();
    return Object.entries(tools).flatMap(([name, installs]) => installs.map((install) => ({ name, install })));
  });

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter installed tools…">
      {!isLoading && (
        <StateEmptyView
          error={error}
          emptyTitle="No Tools Installed"
          emptyDescription="Install a tool with `mise use -g <tool>` and reload."
          onReload={revalidate}
        />
      )}
      {data?.map((row, idx) => {
        const { name, install } = row;
        const accessories: List.Item.Accessory[] = [];
        if (install.requested_version && install.requested_version !== install.version) {
          accessories.push({ tag: install.requested_version, tooltip: "Requested version" });
        }
        if (install.active) accessories.push({ icon: Icon.Checkmark, tooltip: "Active" });
        if (install.symlinked_to) accessories.push({ icon: Icon.Link, tooltip: install.symlinked_to });

        return (
          <List.Item
            key={`${name}@${install.version}@${idx}`}
            icon={Icon.Box}
            title={name}
            subtitle={install.version}
            accessories={accessories}
            actions={
              <ActionPanel>
                <Action.Push title="Show Details" icon={Icon.Sidebar} target={<ToolDetail {...row} />} />
                {install.install_path ? (
                  <Action.CopyToClipboard
                    title="Copy Install Path"
                    content={install.install_path}
                    shortcut={Keyboard.Shortcut.Common.CopyPath}
                  />
                ) : null}
                <Action
                  title="Uninstall"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={Keyboard.Shortcut.Common.Remove}
                  onAction={async () => {
                    const confirmed = await confirmAlert({
                      title: `Uninstall ${name}@${install.version}?`,
                      message: "This runs `mise uninstall` and cannot be undone.",
                      primaryAction: { title: "Uninstall", style: Alert.ActionStyle.Destructive },
                    });
                    if (!confirmed) return;
                    const toast = await showToast({
                      style: Toast.Style.Animated,
                      title: `Uninstalling ${name}@${install.version}…`,
                    });
                    try {
                      await uninstallTool(name, install.version);
                      toast.style = Toast.Style.Success;
                      toast.title = `Uninstalled ${name}@${install.version}`;
                      revalidate();
                    } catch (error) {
                      toast.style = Toast.Style.Failure;
                      toast.title = "Uninstall failed";
                      toast.message = error instanceof Error ? error.message : String(error);
                    }
                  }}
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
