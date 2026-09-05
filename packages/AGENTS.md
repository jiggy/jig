# Package workspace

## Purpose

Contains the independently built and distributed FLOW SDKs and Jig host.

## Ownership

- Package directories own source, tests, manifests, release
  READMEs, licenses, and notices.
- The TypeScript packages are Bun workspaces. Bun generates the ignored root
  `bun.lock` during installation; it is disposable, not maintained by hand or
  committed. Python retains its own packaging.
- `docs/flow/spec/` and `docs/jig/spec/` own normative contracts.
- Repository scripts and workflows own cross-package release automation.

## Local Contracts

- Sibling packages are independent release units; never import sibling source
  or generated output.
- Run `bun install` at the repository root to install all package workspaces.
  Keep Bun's isolated workspace layout; clean installs regenerate the lock
  from manifests. Do not restore per-workspace Bun locks. Example Flows remain
  independently installed application packages, outside the workspace.
- TypeScript and Python FLOW SDKs implement the same Run SDK/1 and Run/1 wire
  semantics. Language ergonomics may differ only where the specifications
  allow it.
- Only manifest-declared exports are public. Test seams and exported internal
  symbols do not create an API.
- Generated, installed, cache, and packaging-output directories are not
  source and must not be edited.
- Keep manifests, lockfiles, versions, packed allowlists, licenses, notices,
  and release READMEs aligned with the actual artifact.

## Work Guidance

- Start with the narrow package check, then test packed artifacts rather than
  relying only on workspace resolution.
- Shared wire changes require both SDKs, Jig, conformance, and specifications
  to be reviewed together.

## Verification

- Cross-package gate: `FLOW_NODE="$(command -v node)" PYTHON="$(command -v python3)" scripts/test-release.sh`

## Child DOX Index

- [flow-sdk/AGENTS.md](flow-sdk/AGENTS.md) — Public TypeScript Run SDK/1
  package.
- [flowmd-sdk/AGENTS.md](flowmd-sdk/AGENTS.md) — Python Run SDK/1 candidate.
- [jig/AGENTS.md](jig/AGENTS.md) — Public Jig authoring package and installed
  secure host.
