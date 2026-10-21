# Release intent

Run `just changeset` when a PR changes a package's published or built inputs.
Select each directly changed npm package and describe its change.
The release command includes packages that bundle those inputs automatically.

Add a new note for each PR. Existing pending notes cannot cover another PR.
Agent archives include their tests and documentation, so those changes need notes.
Unshipped tests, ordinary documentation, and site changes need no release note.
Copied contracts, licenses, and shared build inputs can affect several packages.

Use `just release-plan` to inspect the combined plan.
Do not edit package versions or generated release metadata manually.
Automation runs `just release-version` in the release PR.
That command applies Changesets and synchronizes dependent, example, fixture, and generated-project pins.

Versions remain independent alphas. FLOW versions remain external adoption choices.
Reporting and display versions identify qualification artifacts. Their version changes do not enable publication.
The protected publisher still selects only Agent method, ACP Agent, and Jig.

Changesets moves consumed alpha notes into `pre/`.
The generated `release.json` binds the plan to its exact versioned source.
CI replays the version command to validate release PRs.
Later source changes cannot reuse that release authorization.
