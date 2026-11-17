import { Action, ActionPanel, Detail, Icon, Keyboard } from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import { getDoctor } from "./lib/mise";

export default function Command() {
  const { isLoading, data, error, revalidate } = usePromise(getDoctor, [], {
    onError: (error) => {
      showFailureToast(error, { title: "Failed to run mise doctor" });
    },
  });

  let markdown = "";
  if (data) markdown = `# Mise Doctor\n\n\`\`\`\n${data}\n\`\`\``;
  else if (error) markdown = `# Mise Doctor Failed\n\n${error.message}`;

  return (
    <Detail
      isLoading={isLoading}
      markdown={markdown}
      actions={
        <ActionPanel>
          {data ? <Action.CopyToClipboard title="Copy Output" content={data} icon={Icon.Clipboard} /> : null}
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
}
