# Native support assets

## Purpose

Keep native execution under the trusted host's control without adding operator
setup or package-held authority.

## Ownership

- `codex-requirements.toml` supplies the installed native client's constrained
  policy. Provider code owns its selection, identity and projection.
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

## Local Contracts

- Never execute package bytes before applying the selected profile and consuming
  the guardian's admission byte. Close all child control descriptors before exec.
- Clear registered and exception Mach rights and every unspecified descriptor
  through spawn attributes. Retain bootstrap only for the explicitly selected
  DNS-enabled profile; the profile must still restrict Mach service lookup.
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
  build. `just jig::build-native-support` regenerates both binaries, their
  `macos-native-build.json` provenance manifest, and both descriptor digest pins.
  Review all of these together. The manifest records source/recipe/output hashes
  and the compiler, linker and SDK; it is a consistency record, not an attestation.
- Private ABI changes require native executable evidence on the selected kernel.

## Verification

- Every ordinary Jig build runs `just jig::check-native-support` before cleaning
  output. This portable check rejects stale sources, recipes, binaries and pins.
- `just jig::verify-native-rebuild` requires the recorded Apple toolchain and
  compares freshly compiled universal bytes with both checked-in binaries.
  Toolchain differences fail explicitly; a portable hash check does not prove
  source-to-binary equivalence. Changed native bytes need native host qualification.
- `bun test packages/jig/test/native-support-build.test.ts` checks independent
  source, recipe, binary and runtime-pin corruption refusal.

- `JIG_MACOS_PROCESS_TEST=1 bun test packages/jig/test/macos-execution.test.ts`
  uses the candidate native Bun on the qualified Mac, outside an enclosing
  sandbox. It compiles with warnings as errors and checks admission, inherited
  descriptor closure with a positive control, private-file denial and cleanup.

## Child DOX Index

- None.
