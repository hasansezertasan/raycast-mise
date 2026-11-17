# Mise Toolchain Inspector

Browse your [mise](https://mise.jdx.dev/) toolchain from Raycast.

## Commands

- **List Installed Tools**: Shows each installed tool version, which versions are active, and the requested version when it differs. Open a tool's details, copy its install path, or uninstall a version (asks for confirmation first).
- **Show Settings**: Shows the current mise settings. Copy a key or a value.
- **Run Doctor**: Shows the output of `mise doctor`, so you can check your setup.
- **Show Environment Variables**: Shows the environment variables that mise exports from your global config. Copy a value, a name, or an `export` line.

Raycast does not run these commands inside a project folder. They show your global and default mise config, not a project's `mise.toml`.

## Setup

Install mise first. The extension looks for the `mise` executable in these places:

- `~/.local/bin/mise`
- `/opt/homebrew/bin/mise`
- `/usr/local/bin/mise`
- `/usr/bin/mise`

If mise is somewhere else, set **Mise Executable Path** in the extension preferences. To find the path, run `which mise` in a terminal.
