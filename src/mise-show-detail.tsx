import { Action, ActionPanel, Detail, Icon, LaunchProps } from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import { getDoctor, listTools, MiseToolInstall } from "./lib/mise";

interface DetailContext {
  tool?: string;
  version?: string;
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

export default function Command(props: LaunchProps<{ launchContext?: DetailContext }>) {
  const ctx = props.launchContext;
  const isToolView = Boolean(ctx?.tool);

  const { isLoading, data } = usePromise(
    async (): Promise<string> => {
      if (isToolView && ctx?.tool) {
        const tools = await listTools();
        const installs = tools[ctx.tool] ?? [];
        const install = (ctx.version ? installs.find((i) => i.version === ctx.version) : undefined) ?? installs[0];
        if (!install) return `# ${ctx.tool}\n\n_No installations found._`;
        return toolMarkdown(ctx.tool, install);
      }
      const out = await getDoctor();
      return `# mise doctor\n\n\`\`\`\n${out}\n\`\`\``;
    },
    [],
    {
      onError: (error) => {
        showFailureToast(error, { title: "Failed to load detail" });
      },
    },
  );

  return (
    <Detail
      isLoading={isLoading}
      markdown={data ?? ""}
      actions={
        data ? (
          <ActionPanel>
            <Action.CopyToClipboard title="Copy" content={data} icon={Icon.Clipboard} />
          </ActionPanel>
        ) : null
      }
    />
  );
}
