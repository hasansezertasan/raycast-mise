import { Action, ActionPanel, Icon, List, openExtensionPreferences } from "@raycast/api";
import { MiseNotFoundError } from "./mise";

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

  return <List.EmptyView icon={Icon.Tray} title={emptyTitle} description={emptyDescription} />;
}
