# Game mode plugin integration

English | [中文](README.zh.md)

This reference helps ACTVERO desktop maintainers update the independent plugin and its host integration. Source lives in [actvero-game-mode](https://github.com/heyjianhang/actvero-game-mode). This directory retains the `0.1.0-alpha.4` archive consumed by the current desktop composition; the root `pnpm-lock.yaml` pins its integrity.

## Loading

The desktop and Web bundle resolvers consume the same archive through `file:` dependencies. The plugin manager inserts the Host row through the packaged `dsh.bundle` declaration; DSH Loader loads the Client. The base Web composition does not insert a duplicate row. Electron Main and the trusted main-frame preload provide the window bridge. The matching desktop ships this bundle, which can be enabled in Plugins without adding its GitHub URL again. The shipped version takes precedence over profile-installed copies; game UI updates require a desktop release containing the updated bundle. Without activation there is no entry; an installed plugin on a host missing the window bridge or expert service shows a persistent requirement for the matching desktop build in settings. Experts and voice use their native Client services without creating another conversation or recognizer.

For updates, run `pnpm check` and `pnpm pack` in the independent repository, then update the versioned archive, both resolver dependencies and the root lockfile together. Desktop packaging selects the archive named in `source.json`, verifies its SHA512, private package identity and version, then includes it in the runtime package set; adjacent older archives are not selected. This directory does not contain plugin source; do not deliver changes by editing unpacked `node_modules`.

## Verification

The browser scenario `apps/web/tests/actvero-game-mode.e2e.ts` uses the real Loader, native conversations, settings and UI, with credential-free substitutes for system windows, accounts and external expert resources. It boots through the installed bundle and checks the older-host compatibility message, draft retention, expert selection, settings persistence, both themes, narrow-window controls, numeric slot selection, shortcut recording, opaque dialogs and exit restoration; screenshots use isolated `.artifacts/game-mode/run-*` directories. Native voice component tests cover holding, cancellation, delayed permission, stale-operation isolation and draft protection.

System materials on macOS/Windows, fullscreen games, real microphones and hardware controllers still require device verification. Controller input currently works only in the foreground window and cannot summon the app from a background game. A passing build does not imply an installer, signing or passed hardware acceptance.
