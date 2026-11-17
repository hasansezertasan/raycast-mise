import { Action, ActionPanel, Icon, Keyboard, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { StateEmptyView } from "./lib/empty-view";
import { getEnv } from "./lib/mise";

export default function Command() {
  const { isLoading, data, error, revalidate } = usePromise(getEnv);

  const entries = data ? Object.entries(data).sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter environment variables…">
      {!isLoading && (
        <StateEmptyView
          error={error}
          emptyTitle="No Environment Variables"
          emptyDescription="Add variables under `[env]` in your global mise config."
          onReload={revalidate}
        />
      )}
      {entries.map(([key, value]) => (
        <List.Item
          key={key}
          icon={Icon.Terminal}
          title={key}
          accessories={[{ text: value }]}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard title="Copy Value" content={value} />
              <Action.CopyToClipboard title="Copy as Export" content={`export ${key}=${JSON.stringify(value)}`} />
              <Action.CopyToClipboard title="Copy Name" content={key} />
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
