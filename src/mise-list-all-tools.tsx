import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Icon,
  launchCommand,
  LaunchType,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import { listTools, MiseToolInstall, uninstallTool } from "./lib/mise";

interface ToolRow {
  name: string;
  install: MiseToolInstall;
}

export default function Command() {
  const { isLoading, data, revalidate } = usePromise(async (): Promise<ToolRow[]> => {
    const tools = await listTools();
    return Object.entries(tools).flatMap(([name, installs]) => installs.map((install) => ({ name, install })));
  });

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter installed tools…">
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
                <Action
                  title="Show Details"
                  icon={Icon.Sidebar}
                  onAction={async () => {
                    try {
                      await launchCommand({
                        name: "mise-show-detail",
                        type: LaunchType.UserInitiated,
                        context: { tool: name, version: install.version },
                      });
                    } catch (error) {
                      await showFailureToast(error, { title: "Failed to open detail" });
                    }
                  }}
                />
                {install.install_path ? (
                  <Action.CopyToClipboard
                    title="Copy Install Path"
                    content={install.install_path}
                    shortcut={{ modifiers: ["cmd"], key: "." }}
                  />
                ) : null}
                <Action
                  title="Uninstall"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
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
                      await showFailureToast(error, { title: "Uninstall failed" });
                      toast.hide();
                    }
                  }}
                />
                <Action title="Reload" icon={Icon.ArrowClockwise} onAction={revalidate} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
