# Mise Dev Environment

Work with [mise](https://mise.jdx.dev/) per project, from Raycast: tools, tasks, environment variables, settings, daemons and config trust.

mise gives each project its own tools, environment and tasks. This extension lets you pick the project first, so every command shows what mise sees in that folder, not only your global config.

## Choose a Project

Every list has a project dropdown in the search bar. It contains:

- **Global**: your global mise config only.
- **Added**: folders you add in **Manage Projects**.
- **Tracked by Mise**: folders whose config mise has already loaded.

The choice is shared by all commands and remembered between launches.

## Commands

- **Manage Tools**: The tools of the project, including missing and outdated ones. Install, install all missing, upgrade, use a version in the project or globally, remove a tool from the config, uninstall a version. Open the config file that requests a tool, open its repository, copy its install path or bin paths.
- **Use Tool**: Search the mise registry, pick a version, and add it to the project or your global config.
- **Run Task**: Search the tasks of the project, grouped by source file. Run a task and see its output stream in Raycast. Tasks with arguments get a form built from their usage spec. Also: force run, run without cache, watch mode, dry run, dependency tree, task cache, open the task definition.
- **Create Task**: Create a TOML task (`mise tasks add`) or an executable file task in `mise-tasks/`.
- **Show Environment Variables**: The variables mise sets for the project, with the config file or tool each one comes from. Values are hidden until you reveal them. Set and unset variables, copy as `export` lines, and see each `PATH` entry.
- **Manage Settings**: Every mise setting with its effective value. Configured settings come first. Edit or reset a setting in the global or project config, and open its documentation.
- **Manage Projects**: Choose and add projects. See each config file and whether it is trusted, then trust, untrust or ignore it. Run `mise install`, `mise fmt`, `mise lock`, project checks and `mise bootstrap` (plan, dry run, or apply).
- **Manage Daemons**: The [daemons](https://mise.jdx.dev/daemons.html) of the project with their status. Start, stop and restart them, show their logs, open them in the browser.
- **Run Doctor**: The output of `mise doctor` for the project, plus project checks and `PATH` directories.
- **Mise Menu Bar**: Missing tools, outdated tools and daemon status of the current project, with quick actions.

Long-running commands (install, tasks, bootstrap) run in the background and stream their output into a Raycast view. Closing the view stops the command; this is also how you end watch mode.

## Setup

Install mise first. The extension looks for the `mise` executable in the usual places:

- macOS and Linux: `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `~/.cargo/bin`, Nix profiles
- Windows: WinGet links, Scoop shims, `%LOCALAPPDATA%\mise\bin`, `~\.local\bin`

If mise is somewhere else, set **Mise Executable Path** in the extension preferences. To find it, run `which mise` (macOS) or `where mise` (Windows) in a terminal.

Daemons are an experimental mise feature. **Manage Daemons** offers to turn on `experimental` in your global config when it is off.

## Privacy

Environment variable values can contain secrets, so they are hidden by default. To show them without revealing each one, turn on **Show values by default** in the extension preferences. The extension stores only the list of projects you added and your current project choice, on your machine.
