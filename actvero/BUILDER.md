# Actvero Harness Builder

English | [中文](BUILDER.zh.md)

`make builder` starts a loopback-only browser interface for the existing ACTVERO package command. The explicit `make actvero-builder` and `pnpm run actvero:builder` forms are also available. The form writes local presets and uploaded artwork under `.actvero-builder/`; that directory is ignored by Git and is never included in a release artifact.

The builder currently exposes the package targets already supported by the repository: `win-x64`, `mac-arm64`, and `mac-x64`. It does not offer `win-arm64` because the desktop runtime and packaging target have not been qualified for that architecture.

The page can save a preset, check its configuration, start a package run, and stream the child process output. It delegates packaging to `pnpm run actvero:package`, so the same product configuration, runtime preparation, smoke checks, output layout, and release metadata apply to command-line and visual builds.

Saved presets use the shared `Build Profile` format. A profile references a base product file and keeps only public overrides for product identity, platform, branding and package output. The same profile can be used without the browser:

```bash
make package PROFILE=.actvero-builder/presets/my-profile.json
make package-check PROFILE=.actvero-builder/presets/my-profile.json
```

Command-line values still override profile values. The profile never contains credentials, and the original `actvero/product.json` is never rewritten.

Run the command from the repository root. The server binds only to `127.0.0.1` and prints its randomly allocated URL. To choose a fixed port, use `ARGS="--port 3081" make builder`. Stop it with `Ctrl-C`.
