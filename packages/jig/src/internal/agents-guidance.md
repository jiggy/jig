# Private native Agent resources

Apply these rules when the parent reading map selects this domain.
Read the [shared host contracts](AGENTS.md) before changing its implementation.

## Find a module

These links locate module rules. All selected domain requirements still apply.

- [private-acp-resources](#private-acp-resources)
- [acp-setup-diagnostics](#acp-setup-diagnostics)
- [finite-acp-policy](#finite-acp-policy)

## Ownership

- Admission storage retains private native-session snapshots under exact
  recipient scopes. It permits at most sixteen 8 MiB UTF-8 rollouts, with
  24-hour logical expiry. Atomic single-use claims delete the payload. Access
  requires the current coordinator and an active prepared root Run. Run-scoped
  snapshots additionally bind to that root. Successors inherit their lifetime.

  Terminal commit atomically removes temporary state, including through
  recovery. Storage failure prevents terminal completion. Cross-Run snapshots
  retain their separate expiry policy. Native collectors own clean-close,
  content and current-grant validation. A reference grants no authority. Storage
  or ownership uncertainty must not become successful retention.

  Expected retention loss reports a closed reason. Only recognized
  content-profile rejection is optional. Unexpected collector/I/O errors remain
  execution failures.

- Native client launchers, reviewed runtime policy, private authentication and
  bounded process ownership. Ordinary Agent packages own method preparation,
  response interpretation and optional updates. No Agent method runs inside the
  coordinator. `codex-installation.ts` resolves the current official npm Codex
  launcher and Volta's recorded Npm installation to the declared native platform
  package. Read only bounded regular metadata, at most 64 KiB per record and 32
  package ancestors. Never execute a dispatcher, JavaScript launcher or package
  manager.

  Metadata and inferred native paths stay outside project routes even with an
  explicit wrapper override. An existing invalid nearest package cannot fall
  back to another installation. Only native executable/support bytes enter the
  provider identity and execution projection. Launch never rediscovers metadata.

### private-acp-resources

- `private-acp-resources.ts` captures operator configuration before project
  loading and resolves only each target's exact granted clients. Selected
  runtime identities enter the recipe and review. Launch revalidates their bytes
  and authentication. SDK unavailable clients retain per-target readiness. CLI
  review's typed selected-ACP refusal stops before avoidable target preparation.
  Reject native destinations under sandbox-reserved paths during selection with
  the closed location diagnostic.

  Share sealing's path predicate. Preflight neither mounts files nor replaces
  launch-time validation. Cache selected configurations by client and granted
  model together. A grant model does not change authentication mode or mutate
  the operator snapshot.

### acp-setup-diagnostics

- `acp-setup-diagnostics.ts` owns closed client/stage setup diagnostics and
  corrective hints. Preserve known failures through planning and CLI rendering.
  Raw exceptions, private paths and credentials never become recovery text. Keep
  cause separate from guidance. Installation and sandbox-helper advice follows
  the installed Linux or qualified macOS host. Rendering does not probe clients,
  choose another installation, or change containment authority.

  Codex helper discovery and runtime inspection preserve the sandbox stage,
  distinct from inspection of the selected client's installation. Planning
  locates a verified client literal in immutable captured Binding or
  named-policy source. Imported/computed selections use verified context or an
  honest captured file/slot fallback. The bounded lexical recognizer is owned by
  `src/project/agent-source-location.ts` under the package instructions. Never
  infer literal provenance from equal evaluated values or text matches.
  Executable discovery failures do not imply an absent installation: preserve
  rejected override facts without its value, retain selected-client repair and
  detect alternatives passively.

### finite-acp-policy

- `finite-acp-policy.ts` authorizes each native write for one finite ACP
  conversation. `native-agent-turn-policy.ts` owns Jig's default and allowed
  turn range for grant validation, controller dispatch and finite ACP
  enforcement. Only omission uses the default. Explicit invalid values remain
  refusals. Independent Agent transport contracts retain their own wire
  validation. `finite-acp-resource.ts` owns bounded framing, private startup and
  authentication, and essential channel delivery.

  Credentialed providers supply private literal rejection patterns outside provider identity.
  Nonempty credentials shorter than eight UTF-8 bytes are refused before launch, with or without a Bearer prefix.
  Codex subscription output patterns include only nonempty access, ID and refresh tokens.
  Retained-history screening additionally includes credential-bearing environment values, gateway headers and all startup-token strings.

  The resource checks every projected string, including restored-session ready records, before public channel delivery.
  A match immediately fails the root Run through its private fatal-operation callback, including from nested Flows.
  This stops application delivery before publishing a match-dependent channel or operation failure.
  Native termination and owned cleanup still complete, and diagnostics use fixed text.
  Launch copies are cleared after completion, failure or cancellation.
  Matching covers literal values and JSON escapes, not arbitrary encodings or values split across ACP messages.

  Ordinary Agent Flows own protocol dialogue and answer interpretation. The
  resource reports actual termination only. `root-finite-acp-controller.ts` owns
  its durable lifetime, cancellation, fencing and recovery. Negotiate typed
  native diagnostics without adding client authority. Project warnings as closed
  notices, never answer chunks or raw private metadata. Authoritative errors
  remain failures even before session creation or after a turn.

  Preserve closed native-session/protocol failure explanations after possible
  dispatch without exposing exception text or weakening uncertainty and cleanup.
  Failed finite ACP operations identify the last host execution phase using
  fixed text. Starting a client does not establish remote dispatch. Native error
  text/data remain private. The authentic runtime retains its host-selected
  client identity. Only Codex's demonstrated `session/new` managed preference
  error shape maps to the closed reason specified in `finite-acp.md`.

  Build a fresh constant projection and discard raw fields/private guidance. The
  reason is an attributed native report, never permission to retry or a
  diagnosis of sandbox policy, credentials, effects, or cleanup.

## Local Contracts

- The finite resource enforces native protocol and prompt bounds before writes.
  ACP grants default to one turn. `maxTurns` explicitly permits up to eight
  serial turns without resetting aggregate limits. Consume cancellation racing
  idle settlement without native dispatch. Missing interruption settlement
  fences the resource after five seconds. A notification alone cannot authorize
  another turn.

  Reject leading-slash prompts because clients interpret them as control
  commands. A method's prefix is not the authority safeguard.

- The finite ACP peer refuses permission requests with the protocol's cancelled
  outcome, never a peer-supplied option ID. Permission refusal does not issue
  session control against an identity supplied by the request. Run cancellation
  remains tied to the owned session and host fencing.

- Native Codex subscription access comes from the current operator's file-backed
  Codex login. Project only its short-lived bearer. Never embed a development
  login, retain its refresh token, mount `CODEX_HOME`, or expose a host keyring
  to Agent execution. The private native launcher passes subscription
  bearer/account state through a one-use in-memory bootstrap to the pinned
  adapter. Its app-server login uses `chatgptAuthTokens` and ephemeral
  credential storage. Never write `auth.json` inside the execution volume.

  Qualify this unstable native operation against the genuine selected client.
  Never substitute fabricated authentication or protocol success for native evidence.
  Startup evidence does not qualify online subscription routing or model execution.
  Its constrained profile disables Code
  Mode and its helper host. Unsupported optional tool startup must not inject
  private-path warnings into Agent answers.

- Codex's nested sandbox uses an unprivileged Bubblewrap. Selection uses its
  declarative binary wrapper's PATH prefix and operator PATH, excluding project
  routes. If no eligible PATH helper exists, selection uses the matching bundled
  helper. `JIG_BWRAP_PATH` selects only outer containment. Never substitute a
  system helper at the vendor bundle path. Keep bundled fallback off PATH to
  preserve Codex's vendor digest check.

- Codex, Claude Code, and Pi inspect supported ELF metadata without executing
  it. Codex and Claude also support the bounded declarative binary wrapper. Pi
  retains its unwrapped standalone layout and project-excluded sibling assets.
  Resolve loader-owned libraries through the interpreter's canonical location.
  Retain individual executable, loader, and library files at installation paths.
  Identify them under the selected verification policy.

  Revalidate before launch. Identify each native file before reading its
  metadata, open nonblocking and verify the opened file is regular before
  parsing. Pathname substitution must not wait for a pipe writer. Inspection
  remains provisional until provider construction checks that interval under the
  same policy. The exported ELF reader is a private static inspection seam, not
  a provider, runtime validation or public API. Every native factory must verify
  the complete inspection against its authentic provider before returning it.

  Do not add an intermediate full-file hash pass or claim metadata reuse
  establishes fresh byte evidence. This comparison never replaces launch-time
  filesystem eligibility and installation verification. Reject unsupported or
  project-selected dependencies. Never mount a whole installation/store or
  import ambient loader variables. Each native launcher removes Bun's private
  loader override before starting its client.

## Work Guidance

- A provider adapter may narrow common Agent authority, never widen it.

- API-backed Agent behavior belongs to the ordinary Agent package and its exact
  HTTP grant. Native Codex, Claude Code, and Pi retain constrained ACP launch
  and authentication support. An endpoint, credential, provider, or model used
  in development must not become a product default.

- Native Codex, Claude Code, and Pi use a snapshot of the operator environment
  captured before project loading. Absolute client overrides are authoritative.
  Otherwise search absolute PATH entries in order, excluding the actual project
  tree and ancestor dependency directories through every symlink hop. Review may
  show the resolved operator executable path, never credentials or private
  retained paths. Launch revalidates the selected executable and support against
  reviewed identity under installation verification policy. It never repeats
  PATH discovery.

- Keep each native client a thin profile over the common ACP lifecycle. A new
  client must not require FLOW changes, and a public provider/customization SPI
  requires independent installed consumers to earn its shape.

- Close missing evidence with focused tests. Do not remove a selected client
  solely because prerelease live coverage lags.

## Verification

- Native installation regressions cover discovery, environment snapshots,
  missing/project-selected support, byte replacement, and credential expiry.
  `JIG_NATIVE_AGENT_STARTUP=1` with absolute `JIG_CODEX_STARTUP_PATH`,
  `JIG_CLAUDE_STARTUP_PATH`, and `JIG_PI_STARTUP_PATH` enables
  `test/native-agent-startup.test.ts` after building. It tests genuine native
  ACP startup on the real selected clients. Authentication and subscription evidence
  require actual operator-provided credentials through the ordinary private configuration.
  Never record those credentials or substitute dummy login success.

  Codex subscription startup separately checks the in-memory login handshake.
  missing selections fail instead of silently skipping. This is startup
  evidence, separate from live model calls and the hostile-host gate.

- Finite ACP failures report their private preparation, sealing, admission,
  protocol, settlement or cleanup phase through the existing closed host-test
  observer, including nested Flow calls. Observer exceptions cannot change the
  terminal or interrupt cleanup. Post-protocol collection, session storage and
  receipt cancellation report settlement. Output descriptor-close failures
  report cleanup. Lifecycle repeat-success checks assert the Agent result as
  well as the outer Flow terminal. Project-session host-test causes distinguish
  fixed Mac cleanup refusals behind an unconfirmed fence.

  Storage recovery retains its guardian's closed failure step and cause behind
  the unconfirmed-cleanup error. The exported classifier remains a private test
  seam. Raw messages and unreadable message getters cannot become evidence.
  These codes change neither the public terminal nor recovery authority. The
  same exact-message classifier recognizes six fixed native output collection,
  cleanup, missing-capture, deadline and finite-file-profile causes. Nested
  secret canaries and message near-matches must remain absent from its bounded
  class/code projection.

  Contained repair host tests observe guardian recovery per invocation. They
  retain a fixed `output-capture` failure phase for actual snapshot failures.
  Preserve the same error even if observation fails.
  Capture, delivery and cleanup limits and outcomes stay unchanged. Successful
  diagnostic reruns do not explain an earlier failure.
