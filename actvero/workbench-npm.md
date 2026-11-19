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

## Install Skills for an Agent

New projects include the two workbench Skills. Shared installation also includes expert creation. Install into the shared directory or an Agent-specific directory below; existing names are preserved. After upgrading the kit, use `actvero-workbench skills update --global` to replace only unchanged tool-managed copies. User-authored files remain intact.

```sh
actvero-workbench skills install --global
actvero-workbench skills install "$HOME/.codex/skills"
```

`--global` writes to `~/.agents/skills/`; omitting a path writes to `.agents/skills/` in the current directory. Discovery differs between Agents, so copying does not establish that every Agent loaded the Skills. Supply the resulting SKILL.md path or reload Skills in the Agent when needed. The desktop version owns Skills bundled with ACTVERO.

## Update, debug and deliver

After upgrading the npm kit, run `actvero-workbench bind /absolute/path/project` for existing projects to refresh toolchain binding, Skills and type configuration while retaining business source and DESIGN.md. Do not copy old cache paths to another machine; install a compatible kit there and bind again.

`npm run dev` builds automatically. Attach once with `actvero-workbench attach /project --connection /connection.json` to load development overlays in that Harness. Without an attachment it only builds. `status`, `logs` and `detach` inspect or release the overlay. See the [development guide](workbench-development.md#create) for build, loading and business verification.

Uninstalling the global npm package preserves projects, copied Skills and caches; retain caches still bound by projects. Use info to locate a cache, rebind projects to the new kit, then remove unused old directories. This kit does not automatically upload, publish or call paid models.

## Maintainer packaging

After building the source checkout, run `pnpm run actvero:workbench-npm /absolute/path/new-distribution-directory`. actvero/workbench-npm.json owns the name, version and dist-tag; the command only prepares a directory. Inspect npm pack's file list, install the actual npm archive into an isolated prefix, and verify creation, compilation, packaging and Skill installation before publishing.
