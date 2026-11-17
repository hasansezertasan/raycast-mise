import { Action, ActionPanel, Icon, Keyboard, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { StateEmptyView } from "./lib/empty-view";
import { getSettings } from "./lib/mise";

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export default function Command() {
  const { isLoading, data, error, revalidate } = usePromise(getSettings);

  const entries = data ? Object.entries(data).sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter settings…">
      {!isLoading && <StateEmptyView error={error} emptyTitle="No Settings Found" onReload={revalidate} />}
      {entries.map(([key, value]) => {
        const text = formatValue(value);
        return (
          <List.Item
            key={key}
            icon={Icon.Cog}
            title={key}
            accessories={[{ text }]}
            actions={
              <ActionPanel>
                <Action.CopyToClipboard title="Copy Value" content={text} />
                <Action.CopyToClipboard title="Copy Key" content={key} />
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
