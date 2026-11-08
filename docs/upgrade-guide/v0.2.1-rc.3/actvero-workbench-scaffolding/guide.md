---
kind: upgrade-guide
description: "ACTVERO workbench creation now defaults to a blank project and packaging requires type checks."
---
# ACTVERO workbench project initialization

English | [中文](guide.zh.md)

## Change

`actvero:workbench create` now defaults to a blank view, with project commands, DESIGN.md and two separate development and frontend Skills. Omitting the package name generates a local identity saved in package.json. `pack` now checks TypeScript before producing an archive and therefore requires declarations from the current source toolchain build. A failed type check retains the previous artifact.

## Migration

Use `--template plain` to retain the checklist example or `--template ai` for the AI example. Existing package names and business data need no migration. Run `pnpm run build:artifacts` in the source checkout before checking or packaging workbench code. Fix reported author type errors instead of treating successful transpilation as validation.

New projects use `npm run doctor`, `npm run typecheck`, `npm run build` and `npm run check` inside their directory. After moving the source checkout or changing machines, run `node scripts/workbench.mjs bind <source-root>` to refresh local settings and guidance. Existing projects may continue using the repository commands. See the [development guide](../../../../actvero/workbench-development.md#create) for business design, installation and actual acceptance.
