import { Action, ActionPanel, Icon, List, openExtensionPreferences, showToast, Toast } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { MiseNotFoundError, runMise } from "./mise";

/** mise refuses to load an untrusted config: "Config files in <path> are not trusted." */
export function untrustedConfigPath(error?: Error): string | undefined {
  return error?.message.match(/Config files? in (.+?) (?:are|is) not trusted/)?.[1];
}

async function trustConfig(path: string, onDone?: () => void) {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Trusting config…" });
  try {
    await runMise(["trust", path]);
    toast.style = Toast.Style.Success;
    toast.title = "Config trusted";
    onDone?.();
  } catch (error) {
    toast.hide();
    await showFailureToast(error, { title: "Could not trust the config" });
  }
}

interface StateEmptyViewProps {
  error?: Error;
  emptyTitle: string;
  emptyDescription?: string;
  onReload?: () => void;
}

/**
 * Distinct empty states for a mise-backed list: mise missing, command failed, or no rows.
 * Raycast only shows it once loading has finished and the list has no items.
 */
export function StateEmptyView({ error, emptyTitle, emptyDescription, onReload }: StateEmptyViewProps) {
  if (error instanceof MiseNotFoundError) {
    return (
      <List.EmptyView
        icon={Icon.ExclamationMark}
        title="Mise Not Found"
        description={error.message}
        actions={
          <ActionPanel>
            <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
          </ActionPanel>
        }
      />
    );
  }

  const untrusted = untrustedConfigPath(error);
  if (untrusted) {
    return (
      <List.EmptyView
        icon={Icon.Lock}
        title="Config Not Trusted"
        description={`mise does not load ${untrusted} until you trust it. Trust it only if you know what it runs.`}
        actions={
          <ActionPanel>
            <Action title="Trust Config" icon={Icon.CheckCircle} onAction={() => trustConfig(untrusted, onReload)} />
            <Action.Open title="Open Config File" target={untrusted} />
          </ActionPanel>
        }
      />
    );
  }

  if (error) {
    return (
      <List.EmptyView
        icon={Icon.XMarkCircle}
        title="Mise Command Failed"
        description={error.message}
        actions={
          onReload ? (
            <ActionPanel>
              <Action title="Reload" icon={Icon.ArrowClockwise} onAction={onReload} />
            </ActionPanel>
          ) : undefined
        }
      />
    );
  }

  return (
    <List.EmptyView
      icon={Icon.Tray}
      title={emptyTitle}
      description={emptyDescription}
      actions={
        onReload ? (
          <ActionPanel>
            <Action title="Reload" icon={Icon.ArrowClockwise} onAction={onReload} />
          </ActionPanel>
        ) : undefined
      }
    />
  );
}
