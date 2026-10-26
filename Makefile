# agent-pmo:795a9c2
# =============================================================================
# Standard Makefile — too-many-cooks
# Cross-platform: Linux, macOS, Windows (via GNU Make)
# Multi-package TypeScript repo: too-many-cooks (MCP), VS Code extension, website.
# See REPO-STANDARDS-SPEC [MAKE-TARGETS] and [MAKE-TEMPLATE].
# =============================================================================

.PHONY: build test lint fmt clean ci setup help \
        vsix website-dev rebuild-install-vsix

# ---------------------------------------------------------------------------
# OS Detection
# ---------------------------------------------------------------------------
ifeq ($(OS),Windows_NT)
  SHELL := powershell.exe
  .SHELLFLAGS := -NoProfile -Command
  RM = Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  MKDIR = New-Item -ItemType Directory -Force
  HOME ?= $(USERPROFILE)
else
  RM = rm -rf
  MKDIR = mkdir -p
endif

# ---------------------------------------------------------------------------
# Coverage — single source of truth is coverage-thresholds.json
# See REPO-STANDARDS-SPEC [COVERAGE-THRESHOLDS-JSON].
# ---------------------------------------------------------------------------
COVERAGE_THRESHOLDS_FILE := coverage-thresholds.json

MCP_DIR := too-many-cooks
EXT_DIR := too_many_cooks_vscode_extension
WEB_DIR := website
SHIPWRIGHT_REV := 369a32556f44c8db581b5886bc47756d3ad660a4
# This machine as a Shipwright/VSIX target (darwin-arm64, linux-x64, ...).
HOST_TARGET := $(shell node -p "process.platform + '-' + process.arch")
# Source version (0.0.0-dev; only release runners stamp a real one).
SOURCE_VERSION := $(shell node -p "require('./too-many-cooks/packages/too-many-cooks/package.json').version")

# =============================================================================
# Standard Targets
# =============================================================================

## build: Compile/assemble all artifacts across MCP server, VS Code extension, website
build:
	@echo "==> Building MCP server..."
	cd $(MCP_DIR) && npm run build
	@echo "==> Compiling VS Code extension..."
	cd $(EXT_DIR) && npm run pretest
	@echo "==> Building website..."
	cd $(WEB_DIR) && npm run build

## test: Fail-fast tests + coverage + threshold enforcement.
##       See REPO-STANDARDS-SPEC [TEST-RULES] and [COVERAGE-THRESHOLDS-JSON].
test:
	@echo "==> Testing MCP server (fail-fast + coverage)..."
	cd $(MCP_DIR) && npm run build && npm run test:coverage -w packages/too-many-cooks
	@echo "==> Staging the bundled single-executable server for $(HOST_TARGET) ([SWR-VSIX-BUNDLE])..."
	bash scripts/stage-vsix-server.sh $(HOST_TARGET)
	bash scripts/verify-bundled-server.sh $(HOST_TARGET) $(SOURCE_VERSION)
	@echo "==> Testing VS Code extension (E2E + coverage)..."
	cd $(EXT_DIR) && npm run test:coverage:integration
	@echo "==> Testing website (Playwright + coverage)..."
	cd $(WEB_DIR) && npm run test:coverage
	@$(MAKE) _coverage_check

## lint: Run all linters/analyzers (read-only). Does NOT format.
lint:
	@echo "==> Validating shipwright.json ([SWR-GATE-CI]; schema vendored from Shipwright@$(SHIPWRIGHT_REV))..."
	$(MCP_DIR)/node_modules/.bin/shipwright-validate-manifest --schema scripts/shipwright.schema.json shipwright.json
	@echo "==> Linting MCP server..."
	cd $(MCP_DIR) && npm run lint
	@echo "==> Linting VS Code extension..."
	cd $(EXT_DIR) && npm run lint
	@$(MAKE) _no_suppressions

## fmt: Format all code in-place. Pass CHECK=1 for read-only check (CI use).
fmt:
	@echo "==> Formatting$(if $(CHECK), (check mode),)..."
	cd $(MCP_DIR) && npx prettier$(if $(CHECK), --check, --write) .
	cd $(EXT_DIR) && npx prettier$(if $(CHECK), --check, --write) .
	cd $(WEB_DIR) && npx prettier$(if $(CHECK), --check, --write) .

## clean: Remove all build artifacts
clean:
	@echo "==> Cleaning build artifacts..."
	$(RM) $(MCP_DIR)/build $(MCP_DIR)/coverage
	$(RM) $(MCP_DIR)/packages/core/build
	$(RM) $(MCP_DIR)/packages/too-many-cooks/build $(MCP_DIR)/packages/too-many-cooks/coverage
	$(RM) $(EXT_DIR)/out $(EXT_DIR)/coverage $(EXT_DIR)/coverage-integration
	$(RM) $(EXT_DIR)/bin $(EXT_DIR)/shipwright.json
	$(RM) $(WEB_DIR)/_site

## ci: lint + test + build (full CI simulation)
ci: lint test build

## setup: Post-create dev environment setup (used by devcontainer)
setup:
	@echo "==> Installing MCP server dependencies..."
	cd $(MCP_DIR) && npm ci
	@echo "==> Installing VS Code extension dependencies..."
	cd $(EXT_DIR) && npm ci
	@echo "==> Installing website dependencies..."
	cd $(WEB_DIR) && npm ci && npx playwright install --with-deps chromium
	@echo "==> Setup complete. Run 'make ci' to validate."

## help: List all available targets
help:
	@echo "Standard targets:"
	@echo "  build  - Compile/assemble all artifacts"
	@echo "  test   - Fail-fast tests + coverage + threshold enforcement"
	@echo "  lint   - All linters/analyzers (read-only, no formatting)"
	@echo "  fmt    - Format all code in-place (CHECK=1 for read-only CI check)"
	@echo "  clean  - Remove build artifacts"
	@echo "  ci     - lint + test + build (full CI simulation)"
	@echo "  setup  - Install dependencies for all sub-packages"
	@echo ""
	@echo "Repo-specific targets:"
	@echo "  vsix                 - Package the VS Code extension to a .vsix file"
	@echo "  rebuild-install-vsix - Clean rebuild + reinstall the extension locally"
	@echo "  website-dev          - Run the website locally"

# Internal: lint suppressions are banned (AGENTS.md). oxlint honours eslint/oxlint
# disable comments, so without this guard a suppression silently passes lint.
SUPPRESSION_DIRS := $(MCP_DIR)/packages $(EXT_DIR)/src $(EXT_DIR)/test $(WEB_DIR)/src $(WEB_DIR)/tests $(WEB_DIR)/scripts
_no_suppressions:
	@if grep -rnE "(eslint|oxlint)-disable|@ts-(ignore|expect-error|nocheck)" $(SUPPRESSION_DIRS) \
	  --include=*.ts --include=*.js --include=*.mjs --include=*.cjs --exclude-dir=node_modules --exclude-dir=build --exclude-dir=out --exclude-dir=coverage --exclude-dir=coverage-integration; then \
	  echo "FAIL: lint suppressions are banned — fix the code instead"; exit 1; \
	fi; echo "OK: no lint suppressions"

# Internal: coverage threshold enforcement reading coverage-thresholds.json.
# Not a public target; never invoked outside `_test`.
_coverage_check:
	@if [ ! -f "$(COVERAGE_THRESHOLDS_FILE)" ]; then echo "FAIL: $(COVERAGE_THRESHOLDS_FILE) not found"; exit 1; fi; \
	for entry in "too-many-cooks:$(MCP_DIR)/packages/too-many-cooks/coverage" "too_many_cooks_vscode_extension:$(EXT_DIR)/coverage-integration" "website:$(WEB_DIR)/coverage"; do \
	  name=$${entry%%:*}; dir=$${entry#*:}; summary="$$dir/coverage-summary.json"; \
	  THRESHOLD=$$(jq -r --arg n "$$name" '.projects[$$n].threshold // .default_threshold' "$(COVERAGE_THRESHOLDS_FILE)"); \
	  if [ ! -f "$$summary" ]; then echo "FAIL: $$summary missing — coverage was not computed for $$name"; exit 1; fi; \
	  PCT=$$(jq -r '.total.lines.pct' "$$summary"); \
	  PCT_INT=$$(awk "BEGIN{printf \"%d\", $$PCT}"); \
	  echo "$$name line coverage: $${PCT}% (threshold: $${THRESHOLD}%)"; \
	  if [ "$$PCT_INT" -lt "$${THRESHOLD}" ]; then echo "FAIL: $$name $${PCT}% < $${THRESHOLD}%"; exit 1; fi; \
	done; \
	echo "OK: coverage thresholds satisfied"

# =============================================================================
# Repo-Specific Targets
# Repo-specific helpers below this line. Do NOT shadow any of the 7 above.
# =============================================================================

## vsix: Package the VS Code extension to a .vsix file
vsix: _vsix_package

## rebuild-install-vsix: Clean rebuild + reinstall of the VS Code extension ([MAKE-IDE-EXT])
##                       uninstall -> clean -> compile -> package -> install
rebuild-install-vsix: _vsix_uninstall _vsix_clean _vsix_build _vsix_package _vsix_install
	@echo "==> VS Code extension rebuilt and reinstalled."

## website-dev: Run the website locally
website-dev:
	cd $(WEB_DIR) && npm run dev

# Internal VSIX sub-recipes (chained by vsix / rebuild-install-vsix). Not public.
_vsix_uninstall:
	@echo "==> Uninstalling Nimblesite.too-many-cooks (ignored if absent)..."
	-code --uninstall-extension Nimblesite.too-many-cooks

_vsix_clean:
	@echo "==> Cleaning extension build output..."
	$(RM) $(EXT_DIR)/out
	cd $(EXT_DIR) && $(RM) too-many-cooks-*.vsix

_vsix_build:
	@echo "==> Compiling extension..."
	cd $(EXT_DIR) && npm run pretest

_vsix_package:
	@echo "==> Packaging the $(HOST_TARGET) extension (bundled server) to .vsix..."
	cd $(MCP_DIR) && npm run build
	bash scripts/stage-vsix-server.sh $(HOST_TARGET)
	cd $(EXT_DIR) && npx --yes @vscode/vsce@3.9.2 package --target $(HOST_TARGET) --out too-many-cooks-$(HOST_TARGET)-$(SOURCE_VERSION).vsix
	bash scripts/verify-vsix.sh $(EXT_DIR)/too-many-cooks-$(HOST_TARGET)-$(SOURCE_VERSION).vsix $(HOST_TARGET) $(SOURCE_VERSION)

_vsix_install:
	@echo "==> Installing freshly packaged .vsix..."
	cd $(EXT_DIR) && code --install-extension $$(ls -t too-many-cooks-*.vsix | head -1)
