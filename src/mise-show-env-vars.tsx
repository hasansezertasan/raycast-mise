import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getEnv } from "./lib/mise";

export default function Command() {
  const { isLoading, data, revalidate } = usePromise(getEnv);

  const entries = data ? Object.entries(data).sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter environment variables…">
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
              <Action title="Reload" icon={Icon.ArrowClockwise} onAction={revalidate} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
