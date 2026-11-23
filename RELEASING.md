# Releasing

**Release PR creation uses GitHub's built-in token by default.**
No App secrets are required for this path.
An administrator must enable GitHub's PR-creation setting once.
Changesets then generate package versions and maintain one release PR.

## One-time setup

1. Open [Settings → Actions → General](https://github.com/jiggy/jig/settings/actions).
   Under **Workflow permissions**, enable **Allow GitHub Actions to create and approve pull requests**.
   If organization policy disables this setting, ask an organization administrator to enable it.
2. Keep `test`, `affected-linux`, and `affected-macos` required in the merge policy.
3. Configure npm trusted publishing for `@jigging/agent-method`, `@jigging/agent-acp`, and `@jigging/jig`.
   Use repository `jiggy/jig`, workflow `npm-publish.yml`, and protected environment `npm`.
   No npm token is required.
4. Keep `OPENROUTER_API_KEY` in the protected `native-agent-api` environment when qualifying Codex or Claude through OpenRouter.

   For reliable first-party qualification, the environment may explicitly
   configure either or both key/model pairs below. These are **opt-in paid
   inference paths**; adding the credentials and model constitutes the operator's
   decision to incur provider API usage. No first-party request is sent unless
   both values for that client are present.

   | Protected environment secret | Protected environment variable | Provider |
   | --- | --- | --- |
   | `JIG_NATIVE_CODEX_OPENAI_API_KEY` | `JIG_NATIVE_CODEX_OPENAI_MODEL` | OpenAI Responses API |
   | `JIG_NATIVE_CLAUDE_ANTHROPIC_API_KEY` | `JIG_NATIVE_CLAUDE_ANTHROPIC_MODEL` | Anthropic Messages API |

   A missing half of either pair fails qualification before executing an
   Agent. Each native client receives only the selected key, model and
   fixed HTTPS endpoint.
   Release readiness still requires **both** live native clients, the
   full Mac/Linux host gates, and the exact candidate archives.

### Optional: automatic PR checks and merge

To start release PR checks without manual approval, install a GitHub App on this repository.
Grant only `Contents: write` and `Pull requests: write`.
In [repository Actions settings](https://github.com/jiggy/jig/settings/secrets/actions), add:

| Type | Name | Value |
| --- | --- | --- |
| Variable | `RELEASE_APP_ID` | The App ID |
| Secret | `RELEASE_APP_PRIVATE_KEY` | The App's private key |

For automatic merge requests, also enable repository auto-merge and set variable `RELEASE_AUTO_MERGE=true`.
Required checks and reviews still apply.

## Everyday changes

After installing repository dependencies, run:

```sh
just changeset
```

Select every directly affected package and describe the user-visible change.
Choose `patch` for fixes, `minor` for features, or `major` for breaking changes.
Commit the generated note with your PR. CI rejects missing package coverage.
Do not edit package versions, generated changelogs, or release metadata manually.
Unshipped tests and documentation need no note unless they change package output.

After the feature PR merges:

1. **Release versions** creates or updates **Release Jig packages**.
2. Open that PR. If GitHub shows **Approve workflows to run**, click it.
3. Review the generated changes and merge after required checks pass.
   With the default token, a maintainer must merge so the main-push workflows start.

Feature PRs retain the applicable host checks. After merge, Linux main qualification remains complete for native diagnostic lineage.
Verified nonrelease main commits omit automatic Apple Silicon qualification. Generated releases and uncertain sources retain complete host qualification.
Manual host dispatch retains complete diagnostics for other sources. Omitted Mac jobs create no qualification evidence.

The merged release must pass CI, complete Linux and Apple Silicon qualification,
and native Agent qualification. Automatic native qualification runs only for exact eligible generated release sources after successful Linux qualification.
Explicit manual dispatch on main retains diagnostics for other sources. Omitted automatic calls create no qualification evidence.

Apple Silicon release qualification covers complete macOS 15 and macOS 26 host inventories, installed consumers, and cleanup.
PRs retain the complete inventory across parallel workers selected from macOS 15 and macOS 26.
Each shard fixes its winner before tests and requires complete native enforcement and cleanup checks.
PR coverage does not establish complete independent coverage of both majors and cannot qualify publication.
Intel execution support is retired. Patch-build observations remain evidence without becoming exact-build admission rules.

The publisher then publishes the exact tested archives, followed by source tags and GitHub prereleases.
Current releases use `alpha`. Installation uses `@alpha`, not `@latest`.
Reporting, display, and Python artifacts remain qualification inputs.
FLOW releases independently from [jiggy/flow](https://github.com/jiggy/flow).

To preview and check your committed changes locally:

```sh
git fetch origin main
just release-plan
just release-check "$(git merge-base origin/main HEAD)"
```

## Test release changes before merge

Run `just test-tooling` for registry fault cases and qualification policy checks.
These checks use genuine npm commands and a disposable Verdaccio registry without production credentials.

Run `just test-release-rehearsal` from a clean committed checkout with the normal development tools installed.
It creates a disposable checkout, generates versions, builds canonical archives, publishes locally, retries and installs the CLI.
The **Release rehearsal** PR workflow runs this complete path automatically for release and package changes.
Rehearsal results establish neither production authentication nor native host qualification.

Linux's example shard also tests genuine Codex against an ordinarily trusted local HTTPS endpoint.
It reuses the live first-turn and installed-conversation harness, including immediate interruption and settlement.
Controlled provider errors and process loss must fail visibly and leave no native work.

For live provider diagnostics, dispatch **Native Agent PR preflight** from `main`.
Supply an open same-repository PR number, its exact reviewed merge SHA, and that source's canonical CI run ID.
An independent maintainer with repository write permission must approve the current PR head. Resolve outstanding change requests first.
The protected `native-agent-api` job rechecks approval after archive acquisition and immediately before exposing the key.
It runs provisioning, builds and client harnesses only from the trusted workflow revision, without checking out PR source.
The installed conversation consumes the reviewed archives through the existing bounded Agent credential channel.
Updated PR sources or producer attempts require a fresh dispatch.
These diagnostics create no release qualification receipts.

To check production npm authentication independently, dispatch **Publish npm prereleases** with mode `authentication`.
Leave `source_revision` empty in this mode.
The existing npm workflow and environment perform package-specific OIDC exchange for all three production packages.
Results contain only acceptance and HTTP status. Returned tokens are never written or displayed.
This check publishes nothing and does not establish provenance or release readiness.

## Mac qualification

The hosted Mac workflow generates a complete shard plan within a bounded capacity setting.
Whole files run sequentially on isolated Mac workers.
The PR planner can assign a fourth worker when three workers exceed the planning target.
Each planned PR shard may queue two candidates.
Nightly and release qualification run every shard on both majors with three concurrent workers.
This cap can grow with measured workload and available concurrency. It does not change test membership.

Nightly diagnostics test both supported qualification majors against fresh scheduled canonical inputs.
They discover compatibility regressions but cannot replace fresh main-push release evidence.
Hosted runner queues and allocation failures remain visible. A queue does not establish test execution or cleanup.

After a PR workflow settles, **Re-run failed jobs** may retain verified successful shards within that original run.
Source, canonical artifact identity, runtime policy, and complete plan must remain unchanged.
A later actual failure cannot inherit earlier success. Unknown or incomplete execution remains blocking.
These receipts never resume a Jig Run or reuse a consumer installation.
Main and release qualification require a fresh complete workflow rerun.

## If a release stops

Open [Publish npm prereleases](https://github.com/jiggy/jig/actions/workflows/npm-publish.yml).
Its readiness summary links the current source and qualification attempts.
Candidate versions appear after canonical CI validation.
**Waiting for qualification** means required work is queued, running or missing.
**Blocked** means qualification failed or evidence could not be verified.
Manual reconciliation fails until the exact source is ready.

Version generation can succeed while publication remains blocked.
Completion events check readiness again when qualification finishes.
**Ready for publication** permits a publication attempt and does not establish registry success.
The publication summary reports newly published, byte-verified or superseded versions separately.

For native Agent failures, inspect the failed client and selected qualification
model. A native-session `limit` diagnostic does not identify the underlying
provider cause. Inspect provider availability and quota without exposing secrets.
OpenRouter's free routing has account-wide request limits. Claude Code gateway
compatibility is guaranteed by OpenRouter only for Anthropic first-party models;
non-Anthropic BYOK models can fail at startup.
Use the opt-in protected first-party key/model pairs above to qualify those
clients on their native APIs. The operator owns any resulting API charges.

Provider readiness never substitutes for a successful complete native
qualification. Do not downgrade ACP, omit a client, reuse partial passes or
publish an artifact that failed its original source-bound checks.

- **Release versions fails:** Read its run summary and failed step.
  An opaque GitHub GraphQL error from the version action may be a GitHub
  commit-on-branch service failure. The action uses a scoped Git push instead;
  do not weaken write permissions or release-source checks in response.
  After fixing the cause, choose **Re-run all jobs**, or run the workflow again
  on current `main`. **Re-run failed jobs** cannot reuse prepared version
  changes from an earlier attempt.
- **Qualification fails:** Fix the failing check before publishing.
  A transient failure requires a complete workflow rerun. Partial runs cannot qualify a release.
- **Publication fails:** Choose **Re-run failed jobs** while the original archives remain available for seven days.
  The publisher verifies already-published bytes before continuing. Never rebuild archives during a publication retry.
  Expired artifacts require fresh complete qualification.

Release generation and publication details belong to the
[workflow contracts](.github/AGENTS.md) and [release scripts](scripts/release/AGENTS.md).

## Build a source release

Download the matching GitHub release's **Source code (tar.gz)** or zip and extract it.
On Linux x64/glibc, use Bun 1.4.4 and Just 1.43.1.
The Bun revision is `38afee6c84fcf48c0edb2466aa4b27d287a59c30`.
From the extracted repository root:

```sh
bun install --filter @jigging/jig --filter @jigging/display-model --filter @jigging/display-web --filter @jigging/display-tui --ignore-scripts --config=/dev/null
just --justfile packages/jig/justfile build
```

Edit `packages/jig/src` and repeat the build. The launcher is `packages/jig/bin/jig`.
To package your build:

```sh
just --justfile packages/jig/justfile pack --destination /absolute/output/directory
```

Installation needs registry access and resolves transitive dependencies.
This does not promise offline or byte-identical reproduction.
Running Jig also requires the supported host configuration in its [README](packages/jig/README.md).
The npm archive retains the license, pricing, and applicable notices.
Its matching GitHub release supplies source and links these build instructions.
