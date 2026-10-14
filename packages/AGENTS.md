# Package workspace

## Purpose

Contains Jig-specific reusable Agent methods, the Jig host,
semantic display model and renderers, and their qualification inputs.

## Ownership

- Package directories own source, tests, manifests, release READMEs, licenses,
  notices, and package-local justfiles.
- The TypeScript packages are Bun workspaces. Bun generates the ignored root
  `bun.lock` during installation. It is disposable, not maintained by hand or
  committed. Python retains its own packaging.
- `docs/flow/spec/` and `docs/jig/spec/` own normative contracts.
- Repository scripts and workflows own cross-package release automation.

## Local Contracts

- Sibling packages are independent release units. Never import sibling source or
  generated output.
- Run `bun install` at the repository root to install all package workspaces.
  Keep Bun's isolated workspace layout. Clean installs regenerate the lock from
  manifests. Do not restore per-workspace Bun locks. Example applications and
  their Flows are workspace members. Examples pin matching SDK versions so Bun
  can substitute the local workspaces.

  Application-only method packages may use `workspace:*` for explicit source
  composition.
- Use the root Just modules (`just display_model::build`,
  `just display_web::build`, `just display_tui::build`, `just jig::build`) or
  run package recipes locally. `pack` builds explicitly. Manifests have no build
  or packing lifecycle scripts. Just is development tooling, not an installed
  Jig or FLOW dependency.
- FLOW SDKs and independent authoring are versioned external dependencies.
  Build and test without a FLOW checkout.
- Flavored Flows and reporting profiles remain Jig-owned despite runtime portability.
- Only manifest-declared exports are public. Test seams and exported internal
  symbols do not create an API.
- Generated, installed, cache, and packaging-output directories are not source
  and must not be edited.
- Keep manifests, lockfiles, versions, packed allowlists, licenses, notices, and
  release READMEs aligned with the actual artifact.

## Work Guidance

- Start with the narrow package check, then test packed artifacts rather than
  relying only on workspace resolution.
- Shared wire changes require coordination with the FLOW SDK, conformance, and specification owners.
  Adopt exact released artifacts after that review.

## Verification

- Cross-package gate:
  `FLOW_NODE="$(command -v node)" PYTHON="$(command -v python3)" scripts/test-release.sh`

## Child DOX Index

- [reporting/AGENTS.md](reporting/AGENTS.md) — Portable reporting agreement,
  semantic validation and scoped TypeScript publishing.
- [jiggy-reporting/AGENTS.md](jiggy-reporting/AGENTS.md) — Independently
  packaged Python reporting publisher using the same canonical agreement.

- [agent-method/AGENTS.md](agent-method/AGENTS.md) — Shared Agent procedure,
  bounded Skill reader, and complete ordinary Flow artifact.
- [agent-acp/AGENTS.md](agent-acp/AGENTS.md) — Ordinary finite native Agent
  dialogue and public ACP resource framing, without credentials or launch
  authority.

- [jig/AGENTS.md](jig/AGENTS.md) — Public Jig authoring package and installed
  secure host, with required scoped implementation and qualification guidance.
- [display-model/AGENTS.md](display-model/AGENTS.md) — Readonly semantic
  snapshots and pure display meaning, independent of Jig and renderer state.
- [display-web/AGENTS.md](display-web/AGENTS.md) — Browser rendering, bounded
  observation client, viewer navigation and fixed bundled assets.
- [display-tui/AGENTS.md](display-tui/AGENTS.md) — Independent terminal and
  inline rendering, viewer input/navigation, lazy native support and bounded
  frames.
