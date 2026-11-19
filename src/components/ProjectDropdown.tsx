import { Icon, List } from "@raycast/api";
import { GLOBAL_PROJECT, Project, projectLabel } from "../lib/projects";

interface ProjectDropdownProps {
  project: string;
  projects: Project[];
  onChange: (project: string) => void;
}

/** Search-bar dropdown for choosing the project a command works on. */
export function ProjectDropdown({ project, projects, onChange }: ProjectDropdownProps) {
  const added = projects.filter((p) => p.kind === "added");
  const tracked = projects.filter((p) => p.kind === "tracked");
  // keep the current choice visible even before the list has loaded
  const known = projects.some((p) => p.id === project);

  return (
    <List.Dropdown tooltip="Project" value={project} onChange={onChange} storeValue={false}>
      <List.Dropdown.Item title="Global" value={GLOBAL_PROJECT} icon={Icon.Globe} />
      {!known && project !== GLOBAL_PROJECT ? (
        <List.Dropdown.Item title={projectLabel(project)} value={project} icon={Icon.Folder} />
      ) : null}
      {added.length > 0 ? (
        <List.Dropdown.Section title="Added">
          {added.map((p) => (
            <List.Dropdown.Item key={p.id} title={p.name} value={p.id} icon={Icon.Star} />
          ))}
        </List.Dropdown.Section>
      ) : null}
      {tracked.length > 0 ? (
        <List.Dropdown.Section title="Tracked by Mise">
          {tracked.map((p) => (
            <List.Dropdown.Item key={p.id} title={p.name} value={p.id} icon={Icon.Folder} />
          ))}
        </List.Dropdown.Section>
      ) : null}
    </List.Dropdown>
  );
}
