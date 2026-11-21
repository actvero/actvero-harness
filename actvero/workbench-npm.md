# Workbench CLI installed with Harness

English | [中文](workbench-npm.zh.md)

Installing ACTVERO Harness supplies the local CLI, workbench compiler kit and authoring Skills. Developers and Agents can scaffold, package and test workbenches and manage local Skills, MCP connections and experts on the target Harness.

## Find and launch the CLI

In a Harness conversation, call `workbench_cli_info`. An external Agent gets the invocation and private development connection file from the Hand off to another Agent action in the workbench or expert creation dialog. Launch the returned executable, append the subcommand to its fixed args, and apply env to that process only. The examples below use actvero-workbench to stand for this invocation prefix.

The first compiler command verifies and extracts the kit.tgz shipped with the application into `~/.cache/actvero-workbench/`. Use `info` to see the cache path, DSH baseline and workbench API version. Run `create` for a new project or `bind` for an existing one. Build and check with the built-in CLI's `pack` and `check` subcommands.

## Command help and automation

Use command-level `--help` for usage, `schema list` to discover commands, and `schema show` for flags, input validation, results, success conditions, and recovery. Help, schemas, and request examples work offline. Replace example connections, IDs, versions, paths, and URLs with your own values. Before running this MCP example, export a development connection from the target Harness and fill in the actual connector configuration.

```sh
actvero-workbench mcp create --help
actvero-workbench schema list
actvero-workbench schema show mcp.create
actvero-workbench example show mcp.create > ./request.json
actvero-workbench mcp create --connection ./connection.json --file ./request.json --json
```

Add `--json` to an execution command for a single JSON result line on stdout. Success has `ok=true` and returns data in `result`. Failures exit with code 1 and return `error.code`, `error.message`, and `error.outcome`, with `recovery` and field-level `issues` where applicable. When `outcome=unknown`, read back the current state before retrying. Help and schema commands print their reference directly.

`skill install` writes into the target Harness Skill library. `skills install` copies the kit's four bundled Skills into an Agent Skill directory. The running target Harness owns the private connection file. Export a new file after it restarts.

## Install Skills for an Agent

New projects include the two workbench Skills. Shared installation also includes expert creation. Install into the shared directory or an Agent-specific directory below; existing names are preserved. After upgrading the kit, use `actvero-workbench skills update --global` to replace only unchanged tool-managed copies. User-authored files remain intact.

```sh
actvero-workbench skills install --global
actvero-workbench skills install "$HOME/.codex/skills"
```

`--global` writes to `~/.agents/skills/`; omitting a path writes to `.agents/skills/` in the current directory. Discovery differs between Agents, so copying does not establish that every Agent loaded the Skills. Supply the resulting SKILL.md path or reload Skills in the Agent when needed. The desktop version owns Skills bundled with ACTVERO.

<a id="local-capabilities"></a>

## Manage local Skills and MCP

In a Harness conversation, ask AI to install or edit the named Skill or MCP. AI uses the built-in `local_capabilities` tool. Writes and connection tests follow the current Session's tool authorization. An external Agent uses the same operations through the connection file copied from Use another Agent in the target Harness.

```sh
actvero-workbench skill list --connection /absolute/path/connection.json
actvero-workbench skill install /absolute/path/skill.zip --connection /absolute/path/connection.json
actvero-workbench mcp create --connection /absolute/path/connection.json --file ./mcp-create.json
```

`skill install` accepts a directory, ZIP, or SKILL.md. Use `skill show` with `{"id":"local Skill ID"}` to read its version and file inventory. Use `skill read` with `id` and the in-package `path`. Use `skill edit` with `id`, `version`, the in-package `path`, and the complete `content` to replace one existing text file. Use `skill update` with an absolute `path` to replace the whole package. Updates retain the Skill ID and previous versions and reject stale versions. `skill enable` accepts `id` and `enabled`.

An example MCP create request is `{"config":{"name":"Document service","transport":"http","url":"https://example.org/mcp"}}`. Stdio and SSE are also supported. New connections are saved disabled. Use `mcp show` for the current `revision`, then submit `id`, `revision`, and a `patch` containing only the changed fields to `mcp update`. An enabled connection reconnects after an update. `mcp test` tests and closes a temporary connection for the given `id`. `mcp enable` persists the `enabled` choice for that `id`. Enter credentials on the Harness connector page. CLI summaries omit credentials, argument values, and the full URL. To change the destination of a credentialed connection, review and edit it on the connector page.

`skill help` and `mcp help` list the available commands. After a cancelled or timed-out write, use list or show to check the actual outcome before retrying. Edit directory-discovered Skills in their original directories. The `skill` command manages packages installed in Harness.

## Update, debug and deliver

After upgrading Harness, run `actvero-workbench bind /absolute/path/project` for existing projects to refresh toolchain binding, Skills and type configuration while retaining business source and DESIGN.md. Do not copy old cache paths to another machine; install a compatible kit there and bind again.

`actvero-workbench update <project> --connection <connection-file> --json` builds, validates and installs one version. For an installed workbench, keep its package name and increase its version. Success means the new version loaded and its Client bundle was published. To check the result, run `actvero-workbench status <package-name> --connection <connection-file> --json`. A successfully applied version opens without a desktop import or restart. Use `pack` and `check` for standalone archives. See the [development guide](workbench-development.md#create) for business verification.

Uninstalling Harness preserves projects, copied Skills and caches; retain caches still bound by projects. Use info to locate a cache, rebind projects to the new kit, then remove unused old directories. This kit does not automatically upload, publish or call paid models.

## Desktop delivery

ACTVERO Desktop packaging copies the CLI and the platform-matched compiler kit into application resources. Package verification uses the installed runtime to read a schema and create and package a workbench in an isolated directory. The CLI upgrades with Harness.
