import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getSettings } from "./lib/mise";

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export default function Command() {
  const { isLoading, data, revalidate } = usePromise(getSettings);

  const entries = data ? Object.entries(data).sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter settings…">
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
                <Action title="Reload" icon={Icon.ArrowClockwise} onAction={revalidate} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
