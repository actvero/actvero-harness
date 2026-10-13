# ACTVERO development

Scope: ACTVERO-owned configuration, scripts and business integrations in this fork. Read the root [AGENTS.md](../AGENTS.md) and [product reference](README.md) before changing these files.

- Keep the official history, package names, license and notices. ACTVERO plugin packages use `@actvero/dsh-*`; integrations belong under `packages/actvero/` only when they have executable responsibilities. Do not create placeholder packages or rename official packages in bulk.
- Use official Cordis services, Host Remotes, Client Slots and `commandUi`. Registrations must dispose correctly. Keep Electron Main responsible for native callbacks and encrypted credentials; renderer state contains no access or refresh tokens.
- `product.json` owns build defaults and application identity. Runtime address overrides survive upgrades. Changing an address continues the normal login flow without platform selection or service recognition pages. Remote branding does not change application identity, user-data paths, signing or updates.
- One eligible organization is selected automatically; startup restores the saved device session and shows account confirmation before entering the workspace; multiple require selection when no valid selection exists. Valid device sessions restore their selected organization. Models, quota, connections, installations and thread snapshots retain explicit platform and organization ownership.
- Baseline commands use isolated development data. Do not read or mutate the old desktop's real profiles, import credentials automatically, or replace an installed application during baseline verification.
- `plugins.lock.json` records exact versions and npm integrity. Pending migrations are not compatible or preinstalled plugins. Product preparation emits public metadata only; release work must connect and verify the real artifact before claiming delivery.
- Follow the DSH documentation and testing standards for affected files. Preserve bilingual pairs and run focused validation. Record baseline evidence separately from product runtime acceptance.
- Keep platform code in its own repository. Consume generated API snapshots; build/runtime code must not read sibling repositories. Preserve uncommitted work and do not publish, push, sign or deploy without applicable authorization.

## Desktop release workflow

- The release baseline is [upstream.lock.json](upstream.lock.json): currently the officially published `dsh-v0.2.0-rc.2` tag and its pinned commit. This is a release candidate, not a final stable version. Keep the tag, commit, DSH workspace versions and workspace plugin pins consistent. Do not change version labels alone or bypass plugin compatibility checks. Upgrade this baseline only as an explicit, separately verified change.
- Maintain `main` as the only local and origin branch. Integrate completed, verified changes into `main`; after an authorized push, verify the remote commit before removing any temporary branches. Dependency upgrades are reviewed manually; do not restore scheduled Dependabot version-update branches without a new user decision.
- Before editing or building, inspect `git status`, the current branch/commit and both lock files. Multiple chats must use isolated detached worktrees; do not checkout, reset, merge or build concurrently in one shared checkout. Preserve unrelated work. Before integrating, compare against the current `main` and resolve any new changes; never merge the upstream alpha branch to recover ACTVERO work.
- `actvero/product.json` owns the installer version; it is independent of the DSH runtime version. Keep the default product version aligned with the delivered installer. Record the exact source commit and any uncommitted changes used for a build. Commit authorized source changes locally; push, signing and publication remain separate actions requiring applicable authorization.
- Install the locked dependencies with `pnpm install --frozen-lockfile`. After switching runtime baselines, run `pnpm run clean` before building. This removes generated output, including the internal `.desktop-build` directory; preserve needed internal installers first. Never copy another checkout's `lib` files. Immutable downloads may be reused only for the same pinned artifact; do not reuse another build's application runtime.
- Use the branded commands below from this repository, not upstream release scripts. Replace `mac-arm64` with `mac-x64` or `win-x64` when requested; Windows uses `FORMAT=exe` and the Windows packaging toolchain. Detailed options and prerequisites live in [building/README.md](building/README.md).

```sh
pnpm install --frozen-lockfile
make package-check TARGET=mac-arm64 FORMAT=dmg CONFIG=actvero/product.json OUT=dist
make package TARGET=mac-arm64 FORMAT=dmg CONFIG=actvero/product.json OUT=dist
```

- `package-check` is configuration/toolchain validation, not a successful build. `make package` must complete runtime preparation, packaging and archived-runtime smoke checks. Do not use `SKIP_PREPARE=1` or `--skip-prepare` after source, dependency, baseline or client changes. Fix the failing stage and retain its log; do not deliver an older cached installer under the new version.
- Run focused regression tests for changed behavior. Baseline checks: `pnpm exec vitest run scripts/actvero-baseline.spec.ts`. Card menus and selectors, after the host/client/web build: `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/actvero-capabilities.e2e.ts`. For UI changes, verify actual hover, click and keyboard behavior in light/dark themes. A button's presence in source or the DOM is not visibility evidence. Expert, Skill and MCP auxiliary menus belong immediately left of Summon or the enable switch.
- Before delivery, verify the DSH version inside the application archive, compare affected archived client bundles with the browser-tested build, and confirm the installer hash matches `release.json`. Use isolated test profiles; do not replace the user's installed app or mutate real credentials/conversations as a smoke test.
- Output is `dist/<product.id>/<product.version>/<target>/` for `OUT=dist`. Return the exact installer path, product version, DSH version, source commit, verification results and any limitations. Never equate successful packaging with signing, publication, installation or a passed real-account/model integration test.
