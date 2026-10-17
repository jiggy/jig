# Photo organisation

## Purpose

Make useful Agent judgment visible through a before-and-after photo collection,
while application checks and operator authority control file effects.

## Ownership

- `flows/organise` owns the short coordinating method, `catalogue.ts` source
  capture, `plan.ts` proposal/child-result acceptance and path checks, and
  `view.ts` Photo box projection. It calls grouping and both independent file
  Flows. It writes no files.
- `flows/group` owns the caption-only grouping contract, one Agent call and its
  provisional grouping view in `view.ts`. It returns assignments or an explicit
  cause. It neither imports the organiser nor acquires file access.
- `flows/copy-photos` owns independent catalogue/image and assignment
  validation, byte-preserving copies, CSV manifest and its optional public copy
  view. Its declared attachments are `source: read` and `files: read-write`.
- `flows/contact-sheet` owns independent catalogue/image and assignment
  validation, readable SVG rendering and its optional public sheet view. It uses
  original bytes through the same two attachment modes, without reading copied
  output.
- `bindings`, `grants` and `jig.ts` select the ordinary ACP provider, explicit
  operator grant, complete child attachment maps and reviewed default
  entrypoint.
- `fixtures/photos` owns twelve visually distinct labelled synthetic
  illustrations and caption/date sidecars. Tests construct invalid proposals.
- `test` owns deterministic application and channel checks. `README.md` owns the
  user walkthrough.

## Local Contracts

- Scope cap: twelve images, one Agent proposal, checked copies and one visual
  contact sheet. Flow count is not capped. No vision adapter, EXIF library,
  destructive rename, image editing or custom viewer.
- The grouping Flow and Agent see captions, dates and IDs only. It cannot select
  paths or receive source attachments.
- Read every bounded source image before paid work. Validate the entire proposal
  before output effects. Reject duplicate, missing or unknown IDs and normalized
  group conflicts.
- Preserve source bytes and write only to the output attachment with exclusive
  creation. Interrupted writes are not a completed collection. Propagate
  uncertainty and cancellation without replay.
- Each file method accepts only complete `{assignments: [{id, event}]}` input,
  rechecks every original and derived destination, and returns paths relative to
  its own `files` attachment. Each file method rejects caller assertions and
  supplied paths.
- `bindings/organise.ts` lends `source` to each file Flow and authorizes fresh
  operation-owned `files` outputs. The coordinator checks complete results and
  forwards their sealed artifacts as `copies` and `overview`, without a writable
  organiser attachment or copy/broker slot. Final names supply packet prefixes.
  Leaf paths and manifest rows stay relative to the leaf output. Independent
  file methods keep the same contracts when called as standalone root Flows.
- `jig run` uses the reviewed source fixture and receives a fresh temporary
  packet. Retained `--out` paths must be new.
- TUI and web share the exact public reporting contract and artifact references.
  Each Flow uses `withReporting`/`Reporter` from `@jigging/reporting` and
  carries the complete current `jig:reporting` descriptor and license under
  `contracts/reporting`. Image previews await runtime qualification. Open the
  result packet's contact sheet in an ordinary browser or image viewer. Do not
  introduce an example-only viewer.
- Fixture SVGs are inert synthetic illustrations. Supported user inputs are
  bounded PNG/JPEG files with explicit sidecars. No claim of pixel understanding
  or general image decoding.

## Work Guidance

- Optimise this cookbook for reading and modification, not line count. Use
  descriptive names, braces on conditionals, separate declarations and explicit
  intermediate values. Split validation by the rule it checks and explain the
  few non-obvious bounds and escaping rules. Avoid dense expression chains.
- `flows/group/proposal.schema.json` defines the Agent answer shape. Flow
  invocation contracts bound inputs/results. Organiser `plan.ts` owns
  coordinator acceptance, and each independent file method owns its own
  `assignments.ts` boundary checks.

- Follow the examples' high-modularity standard: give each cohesive capability a
  focused, independently callable Flow. Grouping, copying and rendering have
  separate packages with their own checks. Keep mechanical helpers inside their
  owning Flow and never import another Flow's private source.

- Keep the before/after result obvious, and distinguish filename checks from
  semantic grouping quality.
- Keep transient plans and verification receipts in `.tmp/`.

## Verification

- `bun test examples/photo-organiser/test` includes the public Agent preparation
  validator, so substitutes cannot bypass response-schema compatibility.
- Verify four-Flow composition through actual protocol processes or the installed
  host. Check final prefixes, child acceptance and failure without replay.
  Never replace invocation, artifact grants or export with a test double.
- `test/file-methods.test.ts` checks independent copy/sheet results, byte
  preservation, input/source rejection before writes, cancellation, exclusive
  creation and the exact optional public views. Those application checks do not
  establish native containment or standalone/mapped host execution.
- Agent response schemas declare FLOW Schema/0 and use its bounded Agent subset.
  Length and filename constraints remain in application code.
- Reporting checks compare all four offline descriptor/license copies with the
  installed public package and use its derived `REPORTING_CONTRACT` identity.
- Packed application checks belong to `scripts/test-release.sh`. Admitted host
  evidence and live Agent evidence stay separate from test substitutes.

## Child DOX Index

- None.
