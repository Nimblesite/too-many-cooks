# Release

A `v*` tag drives the entire release from `.github/workflows/release.yml`. The
tagged commit is built verbatim — no branch detection, no commit, no push, no
tag mutation. Each job stamps the version runner-local from the tag
(`VERSION="${GITHUB_REF_NAME#v}"`) via `npm version --no-git-tag-version`.

## Channels

A single `v*` tag fans out to every channel from one workflow:

- **npm** (`build-mcp`) — publishes `too-many-cooks-core` and `too-many-cooks`
  via npm Trusted Publisher OIDC (`id-token: write`, no `NPM_TOKEN`), with
  `--provenance`.
- **VS Code Marketplace** (`publish-marketplace`) — one `vsce publish` for the
  single universal VSIX via Microsoft Entra OIDC, no stored PAT. See
  [Marketplace OIDC setup](#marketplace-oidc-setup-swr-vsix-publish-oidc).
- **Open VSX** (`publish-openvsx`) — `ovsx publish` with the `OPEN_VSX_PAT`
  secret (Open VSX has no OIDC trusted publishing). Serves the VS Code forks
  (Cursor, Windsurf, Antigravity).
- **GitHub release** (`github-release`) — single owner of the GitHub release;
  creates it once from the build artifacts (npm tarballs + VSIX), no parallel
  `softprops` race.
- **Website** (`deploy-website`) — stable (non-hyphenated) tags deploy the
  Eleventy site to GitHub Pages after the CodeQL gate passes.

The extension bundles **no native binaries** (pure JS that talks to the MCP
server over HTTP), so a single universal VSIX is correct — no per-target build,
and no dependency on `build-mcp`.

## Gates

- **CodeQL release gate** (`codeql` with `gate: true`) — re-scans the tagged SHA
  and FAILS on any High/Critical finding. `build-mcp`, `build-vsix`, and
  `deploy-website` all `needs:` it, so a dirty scan blocks the whole release.

## `@types/vscode` must not exceed `engines.vscode`

`vsce package` rejects a `@types/vscode` range greater than `engines.vscode`
(e.g. `@types/vscode ^1.125.0` with `engines.vscode ^1.85.0`). CI's
Build/Lint/Test does **not** run `vsce package`, so this only surfaces at
release. Keep `@types/vscode` pinned at or below `engines.vscode`; a Dependabot
bump that pushes `@types/vscode` past `engines.vscode` will break the VSIX build.

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
