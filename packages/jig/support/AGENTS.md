# Native support assets

## Purpose

Keep native execution under the trusted host's control without adding operator
setup or package-held authority.

## Ownership

- `codex-requirements.toml` supplies the Linux native client's constrained
  policy. Provider code owns its selection, identity and projection. Mac uses
  the pinned ACP mode and outer boundary rather than that Linux absolute path.
- `macos-exec.c` owns the private Darwin pre-exec boundary. The private host
  owns profile generation, durable admission, supervision, recovery and assembly.
- `macos-exec-universal` contains the Intel and Apple Silicon launcher slices
  compiled from that source with the Apple toolchain. Assembly copies it into
  the release; installed consumers do not compile it.
- `macos-descriptor-bridge.c` and its universal `.dylib` supply fixed-signature
  `openat` and `fcntl` calls and descriptor operations with atomic errno capture.
  Integer failures return negative errno; pointer operations return errno through
  an explicit output buffer, with `readdir` clearing errno inside the native call.
  The SDK compiler owns Darwin's variadic ABI;
  descriptor code verifies the packaged bridge digest before loading it.
- `macos-codex-preferences.m` and its universal executable supply a bounded,
  trusted, value-free managed-policy observation. Synchronize the Codex domain,
  check both native managed keys and every forced key in the public suite search
  list, and return only absence, unsupported policy, or unavailable observation.
  Never change preferences or expose keys/values. Ordinary preferences need not
  be empty; the payload cannot read them. Its native deadline survives parent
  loss. Only native Intel execution is qualified; reject Rosetta and arm64.

## Local Contracts

- Never execute package bytes before applying the selected profile and consuming
  the guardian's admission byte. Close all child control descriptors before exec.
- Clear registered and exception Mach rights and every unspecified descriptor
  through spawn attributes. Retain bootstrap only for the explicitly selected
  service-enabled profile; the profile must still restrict Mach service lookup
  to selected DNS or Codex notification services. Other isolated scopes retain
  no bootstrap port.
  Include `EXC_MASK_CRASH` and `EXC_MASK_CORPSE_NOTIFY` explicitly: the SDK's
  `EXC_MASK_ALL` excludes them. Child exit and remaining-coalition settlement
  are separate observations, including after native crashes.
- FD 3 carries at most 32 KiB of profile text; FD 4 carries the one-byte admission
  decision. FD 5 carries fixed native readiness and terminal frames, separately
  from payload output. The trusted parent reports waitpid's actual termination;
  it must not recreate payload crashes by signaling itself.
- This helper is unprivileged. It does not install services, create accounts,
  grant admission, or claim that a child exit proves descendant cleanup.
- Compile development fixtures with the Apple toolchain. The qualified
  installed Mac host uses packaged universal support and requires no consumer
  compiler.

## Work Guidance

- Follow `../src/internal/AGENTS.md` for the host's containment and authority
  contracts. Keep the native code small and use SDK declarations where available.
- `../scripts/native-support.mjs` owns the canonical two-architecture Apple
  build. `just jig::build-native-support` regenerates all native binaries, their
  `macos-native-build.json` provenance manifest, and both descriptor digest pins.
  Review all of these together. The manifest records source/recipe/output hashes
  and the compiler, linker and SDK; it is a consistency record, not an attestation.
- Private ABI changes require native executable evidence on the selected kernel.

## Verification

- Every ordinary Jig build runs `just jig::check-native-support` before cleaning
  output. This portable check rejects stale sources, recipes, binaries and pins.
- `just jig::verify-native-rebuild` requires the recorded Apple toolchain and
  compares freshly compiled universal bytes with all checked-in native assets.
  Toolchain differences fail explicitly; a portable hash check does not prove
  source-to-binary equivalence. Changed native bytes need native host qualification.
- `bun test packages/jig/test/native-support-build.test.ts` checks independent
  source, recipe, binary and runtime-pin corruption refusal, plus a nonzero
  LC_UUID in both slices of each binary (required by newer Darwin loaders).
- `macos-preferences-observer.test.ts` exercises the actual observer asset on
  native Intel 23E224: caller-sandbox refusal, synthetic forced-policy and sync
  failures, and expiry after parent loss. Injection never changes operator
  preferences and is not actual MDM qualification. Cleanup uses the live
  post-exec PID version, with evidence retained if settlement is unconfirmed.

- `JIG_MACOS_PROCESS_TEST=1 bun test packages/jig/test/macos-execution.test.ts`
  uses the candidate native Bun on the qualified Mac, outside an enclosing
  sandbox. It compiles with warnings as errors and checks admission, inherited
  descriptor closure with a positive control, private-file denial and cleanup.

## Child DOX Index

- None.
