# Workbench npm developer kit

English | [中文](workbench-npm.zh.md)

For developers and Agents building workbenches for an installed ACTVERO desktop. This package supplies scaffolding, pinned compiler tools, API declarations, development commands and three shared Skills (develop-workbench, workbench-frontend and expert-creator) without requiring Harness source. This preview supports macOS Apple Silicon and requires Node 22.19 or 24 and later; other operating systems and architectures are outside this distribution.

## Install and create

```sh
npm install -g @actvero/workbench-development-kit@preview
actvero-workbench --version
actvero-workbench info
actvero-workbench create ./my-workbench @local/my-workbench
cd ./my-workbench
npm run doctor
npm run typecheck
npm run build
npm run check
```

Read the generated project's AGENTS.md, DESIGN.md and .agents/skills/develop-workbench/SKILL.md before implementing confirmed requirements. create defaults to a blank template; append `--template plain` or `--template ai` for examples. dist/*.tgz is the business package imported into the desktop, not this npm developer kit.

The first command needing the compiler verifies and extracts the bundled kit.tgz into `~/.cache/actvero-workbench/`; it neither downloads another toolchain nor runs a postinstall script. info reports its location, DSH baseline and workbench API version. Set `ACTVERO_WORKBENCH_CACHE_DIR` to override the cache parent. The npm version and running desktop must still meet their respective compatibility requirements.

## Command help and automation

Use command-level `--help` for usage, `schema list` to discover commands, and `schema show` for flags, input validation, results, success conditions, and recovery. Help, schemas, and request examples work offline. Replace example connections, IDs, versions, paths, and URLs with your own values. Before running this MCP example, export a development connection from the target Harness and fill in the actual connector configuration.

```sh
actvero-workbench mcp create --help
actvero-workbench schema list
actvero-workbench schema show mcp.create
actvero-workbench example show mcp.create > ./request.json
actvero-workbench mcp create --connection ./connection.json --file ./request.json --json
```

Add `--json` to an execution command for a single JSON result line on stdout. Success has `ok=true` and returns data in `result`. Failures exit with code 1 and return `error.code`, `error.message`, and `error.outcome`, with `recovery` and field-level `issues` where applicable. When `outcome=unknown`, read back the current state before retrying. Help and schema commands print their reference directly. The `dev` command streams build status as JSON lines.

`skill install` writes into the target Harness Skill library. `skills install` copies the kit's three authoring Skills into an Agent Skill directory. The running target Harness owns the private connection file. Export a new file after it restarts.

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

After upgrading the npm kit, run `actvero-workbench bind /absolute/path/project` for existing projects to refresh toolchain binding, Skills and type configuration while retaining business source and DESIGN.md. Do not copy old cache paths to another machine; install a compatible kit there and bind again.

`npm run dev` builds automatically. Attach once with `actvero-workbench attach /project --connection /connection.json` to load development overlays in that Harness. Without an attachment it only builds. `status`, `logs` and `detach` inspect or release the overlay. See the [development guide](workbench-development.md#create) for build, loading and business verification.

Uninstalling the global npm package preserves projects, copied Skills and caches; retain caches still bound by projects. Use info to locate a cache, rebind projects to the new kit, then remove unused old directories. This kit does not automatically upload, publish or call paid models.

## Maintainer packaging

After building the source checkout, run `pnpm run actvero:workbench-npm /absolute/path/new-distribution-directory`. actvero/workbench-npm.json owns the name, version and dist-tag; the command only prepares a directory. Inspect npm pack's file list, install the actual npm archive into an isolated prefix, and verify creation, compilation, packaging and Skill installation before publishing.
