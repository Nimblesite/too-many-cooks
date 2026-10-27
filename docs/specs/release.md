# Release

A `v*` tag drives the entire release from `.github/workflows/release.yml`. The
tagged commit is built verbatim — no branch detection, no commit, no push, no
tag mutation. Source versions are always `0.0.0-dev`; each job stamps the tag's
version runner-local with `scripts/stamp-version.sh` (every `package.json` and
the `shipwright.json` product version) — the same script the tests exercise
([SWR-VERSION-BUILD-STAMPING]).

## Channels

A single `v*` tag fans out to every channel from one workflow:

- **npm** (`build-mcp`) — publishes `too-many-cooks-core` and `too-many-cooks`
  via npm Trusted Publisher OIDC (`id-token: write`, no `NPM_TOKEN`), with
  `--provenance`.
- **VS Code Marketplace** (`publish-marketplace`) — `vsce publish` for each of
  the four per-platform VSIXs via Microsoft Entra OIDC, no stored PAT. See
  [Marketplace OIDC setup](#marketplace-oidc-setup-swr-vsix-publish-oidc).
- **Open VSX** (`publish-openvsx`) — `ovsx publish` with the `OPEN_VSX_PAT`
  secret (Open VSX has no OIDC trusted publishing). Serves the VS Code forks
  (Cursor, Windsurf, Antigravity).
- **GitHub release** (`github-release`) — single owner of the GitHub release;
  creates it once from the build artifacts (npm tarballs + four VSIXs + SBOMs)
  with a cosign keyless-signed `SHA256SUMS`, no parallel `softprops` race.
- **Website** (`deploy-website`) — stable (non-hyphenated) tags deploy the
  Eleventy site to GitHub Pages after the CodeQL gate passes.

## Per-platform VSIX ([SWR-VSIX-PACKAGE], [SWR-VSIX-BUNDLE])

The extension ships the server inside it: one VSIX per target
(`darwin-arm64`, `darwin-x64`, `linux-x64`, `win32-x64`), each carrying
`bin/<target>/too-many-cooks[.exe]` — a Node single-executable application built
by `scripts/build-server-sea.mjs` from a pinned, SHA-256-verified Node runtime —
plus the better-sqlite3 Node-API addon, the schema and DataProviderMigrate.
The extension launches only that binary (or an explicit `tooManyCooks.serverPath`
/ `TMC_SERVER_PATH` override) and refuses to start a server whose `--version`
differs from its own ([SWR-IDE-RESOLUTION], [SWR-VERSION-MATCHING]).

`.github/workflows/vsix-platforms.yml` builds each target on its native runner,
boots the binary from an empty environment (`scripts/verify-bundled-server.sh`),
packages it with `vsce package --target`, and inspects every package
(`scripts/verify-vsix.sh`). CI runs it on every PR at `0.0.0-dev`; `release.yml`
runs the same workflow with the tag's version, then attests provenance + SBOM.

## Gates

- **CodeQL release gate** (`codeql` with `gate: true`) — re-scans the tagged SHA
  and FAILS on any High/Critical finding. `build-mcp`, `build-vsix`, and
  `deploy-website` all `needs:` it, so a dirty scan blocks the whole release.
- **CI gate** (`ci`) — the full `ci.yml` (lint, tests with coverage thresholds,
  build, vulnerability scan, supply-chain lint) on the tagged SHA.

## `@types/vscode` must not exceed `engines.vscode`

`vsce package` rejects a `@types/vscode` range greater than `engines.vscode`
(e.g. `@types/vscode ^1.125.0` with `engines.vscode ^1.85.0`). Keep
`@types/vscode` pinned at or below `engines.vscode`. The PR-time
`vsix-platforms` job runs `vsce package`, so a Dependabot bump that breaks this
fails the PR instead of the release.

## Marketplace OIDC setup ([SWR-VSIX-PUBLISH-OIDC])

`publish-marketplace` runs in the protected `release` environment with
`id-token: write`, signs in to the shared **`Nimblesite-VSCode-Marketplace`**
Entra app via `azure/login`, mints a short-lived Azure DevOps token, and passes
it to pinned `@vscode/vsce@3.9.2` as `VSCE_PAT`. No Marketplace PAT is stored.

For this repo to publish, the Entra app must trust it and the `release`
environment must carry the (non-secret) Azure IDs:

1. **Federated credential** on `Nimblesite-VSCode-Marketplace`, subject
   `repo:Nimblesite/too-many-cooks:environment:release`, audience
   `api://AzureADTokenExchange`. A wildcard `claimsMatchingExpression` over the
   org covers every repo at once; otherwise add one credential per repo.
2. The app's service principal added as a **Contributor** publisher member of
   the `Nimblesite` Marketplace publisher (User Id = the SP's Azure DevOps
   profile Identity GUID).
3. `AZURE_CLIENT_ID` (the app's client/application ID) and `AZURE_TENANT_ID`
   (the `Nimblesite` directory/tenant ID) as secrets on the **`release`**
   environment — the same values Nimblesite/Deslop and Nimblesite/Basilisk use.

A missing-credential symptom is
`azure/login ... Not all values are present. Ensure 'client-id' and 'tenant-id'
are supplied.` — that means the two `release`-env secrets are absent.

Re-runs use `--skip-duplicate`, so once the above is configured, re-running the
failed job is idempotent and needs no new tag:

```bash
gh run rerun <release-run-id> --failed
```

See the Shipwright deployment standard `[SWR-VSIX-PUBLISH-OIDC]` for the
canonical contract.

## Release readiness

Already in place (verified):

- `release` environment with `AZURE_CLIENT_ID` / `AZURE_TENANT_ID`; org secret
  `OPEN_VSX_PAT`; `NPM Deployment` and `github-pages` environments.
- npm Trusted Publishing works: `too-many-cooks@0.15.1` and
  `too-many-cooks-core@0.15.1` carry SLSA provenance attestations.

Outstanding (needs an account owner):

- **macOS notarization** ([SWR-SIGN-*]) — darwin binaries are ad-hoc signed
  (`codesign --sign -`), which runs fine from a VSIX install but is not
  notarized. Notarizing needs an Apple Developer ID certificate and an App Store
  Connect API key as `release`-environment secrets.
- **Windows** binaries are unsigned; Shipwright treats native Authenticode as an
  open problem ([SWR-SIGN-WINDOWS]) — integrity comes from the cosign-signed
  `SHA256SUMS` and build provenance.

## Dry run before tagging

Prove the stamped path locally (no publish, nothing committed):

```bash
D=$(mktemp -d) && git archive HEAD | tar -x -C "$D" && cd "$D"
bash scripts/stamp-version.sh 9.9.9-rc.1
(cd too-many-cooks && npm ci --ignore-scripts && npm run build)
T=$(node -p 'process.platform + "-" + process.arch')
bash scripts/stage-vsix-server.sh "$T"
bash scripts/verify-bundled-server.sh "$T" 9.9.9-rc.1
(cd too_many_cooks_vscode_extension && npm ci && \
  npx --yes @vscode/vsce@3.9.2 package --target "$T" --out "../tmc-$T.vsix")
bash scripts/verify-vsix.sh "tmc-$T.vsix" "$T" 9.9.9-rc.1
```

Then tag the version in `too-many-cooks/CHANGELOG.md` (next: `v0.16.0`; a
hyphenated tag such as `v0.16.0-rc.1` publishes as a prerelease and skips the
website deploy).
