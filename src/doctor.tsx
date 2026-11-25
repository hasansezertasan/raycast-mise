import { Action, ActionPanel, Detail, Icon, Keyboard } from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import { StreamedRun } from "./components/StreamedRun";
import { checkMiseUpdate, getDoctor, MISE_CHANGELOG_URL, MISE_UPDATE_DOCS_URL } from "./lib/mise";
import { GLOBAL_PROJECT, projectLabel } from "./lib/projects";
import { useProject } from "./lib/use-project";

export default function Command() {
  const { project, cwd } = useProject();
  const { isLoading, data, error, revalidate } = usePromise(getDoctor, [cwd], {
    onError: (error) => {
      showFailureToast(error, { title: "Failed to run mise doctor" });
    },
  });

  const { data: update } = usePromise(() => checkMiseUpdate().catch(() => undefined));

  const notice = update
    ? `\n\n> mise ${update.latest} is available (you have ${update.current}).` +
      (update.canSelfUpdate ? "" : " A package manager installed this mise, so update it there.")
    : "";
  const heading = `# Mise Doctor\n\nProject: \`${projectLabel(project)}\`${notice}`;
  let markdown = heading;
  if (data) markdown = `${heading}\n\n\`\`\`\n${data.replace(/```/g, "ʼʼʼ")}\n\`\`\``;
  else if (error) markdown = `${heading}\n\n**Failed:** ${error.message}`;

  return (
    <Detail
      isLoading={isLoading}
      markdown={markdown}
      actions={
        <ActionPanel>
          {data ? <Action.CopyToClipboard title="Copy Output" content={data} icon={Icon.Clipboard} /> : null}
          {update?.canSelfUpdate ? (
            <Action.Push
              title="Update Mise"
              icon={Icon.ArrowUpCircle}
              target={<StreamedRun title="mise self-update" args={["self-update", "--yes"]} project={GLOBAL_PROJECT} />}
            />
          ) : null}
          {update && !update.canSelfUpdate ? (
            <Action.OpenInBrowser title="How to Update Mise" icon={Icon.ArrowUpCircle} url={MISE_UPDATE_DOCS_URL} />
          ) : null}
          {update ? <Action.OpenInBrowser title="Show Changelog" url={MISE_CHANGELOG_URL} /> : null}
          <Action.Push
            title="Run Project Checks"
            icon={Icon.CheckCircle}
            target={
              <StreamedRun title="mise doctor project" args={["doctor", "project"]} cwd={cwd} project={project} />
            }
          />
          <Action.Push
            title="Show PATH Directories"
            icon={Icon.List}
            target={<StreamedRun title="mise doctor path" args={["doctor", "path"]} cwd={cwd} project={project} />}
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
}
