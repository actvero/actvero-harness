# Short names for the Web and Desktop application commands. The package.json
# scripts they call stay the source of truth; docs/development.md documents both.
.DEFAULT_GOAL := help
.PHONY: help build web desktop dev-web dev-desktop package package-check builder actvero-builder

PNPM ?= pnpm
ARGS ?=

# Export values rather than inserting user input into shell commands.
export ACTVERO_BUILD_CONFIG = $(CONFIG)
export ACTVERO_BUILD_PROFILE = $(PROFILE)
export ACTVERO_BUILD_TARGET = $(TARGET)
export ACTVERO_BUILD_FORMAT = $(FORMAT)
export ACTVERO_BUILD_OUT = $(OUT)
export ACTVERO_BUILD_NAME = $(NAME)
export ACTVERO_BUILD_VERSION = $(VERSION)
export ACTVERO_BUILD_ICON = $(ICON)
export ACTVERO_BUILD_LOGO = $(LOGO)
export ACTVERO_BUILD_TRAY_ICON = $(TRAY_ICON)
export ACTVERO_BUILD_PLATFORM_URL = $(PLATFORM_URL)
export ACTVERO_BUILD_DOWNLOAD_BASE_URL = $(DOWNLOAD_BASE_URL)
export ACTVERO_BUILD_RELEASE_DATE = $(RELEASE_DATE)
export ACTVERO_BUILD_NOTES = $(NOTES)
export ACTVERO_BUILD_MIN_SYSTEM = $(MIN_SYSTEM)
export ACTVERO_BUILD_DIR = $(DIR)
export ACTVERO_BUILD_SKIP_PREPARE = $(SKIP_PREPARE)

help:
	@echo "make build        pnpm run build           complete repository build"
	@echo "make web          pnpm run start:web       serve the built Web artifacts from source"
	@echo "make desktop      pnpm run start:desktop   launch the built Desktop artifacts"
	@echo "make dev-web      pnpm run dev:web         build, serve, and rebuild Web on source edits"
	@echo "make dev-desktop  pnpm run dev:desktop     build, then launch Desktop"
	@echo "ARGS='--no-open --port 3081' forwards options to the launched application;"
	@echo "the Web commands accept dsh web flags, the Desktop launcher accepts none."
	@echo "make package      build branded installers and download-page metadata"
	@echo "make package-check validate brand, target, format, output and toolchain"
	@echo "make builder       start the visual Actvero Harness package builder"
	@echo "make actvero-builder same as make builder (explicit name)"
	@echo "PROFILE=.actvero-builder/presets/name.json applies one shared Build Profile to package/check."
	@echo "TARGET=mac-arm64|mac-x64|win-x64 FORMAT=dmg|zip|exe|all CONFIG=actvero/product.json OUT=dist"
	@echo "NAME VERSION ICON LOGO TRAY_ICON PLATFORM_URL override public build defaults."
	@echo "DOWNLOAD_BASE_URL RELEASE_DATE NOTES MIN_SYSTEM populate the release metadata."

package:
	$(PNPM) run actvero:package

package-check:
	$(PNPM) run actvero:package --check

builder actvero-builder:
	$(PNPM) run actvero:builder -- $(ARGS)

build:
	$(PNPM) run build

web:
	$(PNPM) run start:web $(ARGS)

desktop:
	$(PNPM) run start:desktop $(ARGS)

dev-web:
	$(PNPM) run dev:web $(ARGS)

dev-desktop:
	$(PNPM) run dev:desktop $(ARGS)
