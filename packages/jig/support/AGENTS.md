# Native support assets

## Purpose

Keep native execution under the trusted host's control without adding operator
setup or package-held authority.

## Ownership

- `codex-requirements.toml` supplies the Linux native client's constrained
  policy. Provider code owns its selection, identity and projection. Mac uses
  the pinned ACP mode and outer boundary rather than that Linux absolute path.
- `macos-exec.c` owns the private Darwin pre-exec boundary. The private host
  owns profile generation, durable admission, supervision, recovery and
  assembly.
- `macos-exec-universal` contains the compiler-produced universal launcher slices
  compiled from that source with the Apple toolchain. Assembly copies it into
  the release. Installed consumers do not compile it.
- `macos-descriptor-bridge.c` and its universal `.dylib` supply fixed-signature
  `openat` and `fcntl` calls and descriptor operations with atomic errno
  capture. Integer failures return negative errno. Pointer operations return
  errno through an explicit output buffer, with `readdir` clearing errno inside
  the native call. The SDK compiler owns Darwin's variadic ABI. Descriptor code
  verifies the packaged bridge digest before loading it.
- `macos-codex-preferences.m` is the native ARM candidate for bounded, value-free
  forced-policy observation. It refreshes the real Codex domain and refuses
  managed keys or unavailable observation. It never changes operator policy.
  Its internal alarm is armed before framework calls and survives caller loss.
  Missing observation or an inherited sandbox must refuse selection.
- `macos-codex-preferences-universal` is the compiler-produced installed observer. Its ARM slice supplies policy observation, while its Intel slice refuses.
  Assembly copies it to executable `libexec/macos-codex-preferences`. The package allowlist and installed smoke require its exact bytes.

## Local Contracts

- Never execute package bytes before applying the selected profile and consuming
  the guardian's admission byte. Close all child control descriptors before
  exec.
- Clear registered and exception Mach rights and every unspecified descriptor
  through spawn attributes. Retain bootstrap only for the explicitly selected
  service-enabled profile. The profile must still restrict Mach service lookup
  to the selected DNS or authenticated Codex preference service. Other isolated scopes retain
  no bootstrap port. Include `EXC_MASK_CRASH` and `EXC_MASK_CORPSE_NOTIFY`
  explicitly: the SDK's `EXC_MASK_ALL` excludes them. Child exit and
  remaining-coalition settlement are separate observations, including after
  native crashes.
- FD 3 carries at most 32 KiB of profile text. FD 4 carries the one-byte
  admission decision. FD 5 carries fixed native readiness and terminal frames,
  separately from payload output. The trusted parent reports waitpid's actual
  termination. It must not recreate payload crashes by signaling itself.
- This helper is unprivileged. It does not install services, create accounts,
  grant admission, or claim that a child exit proves descendant cleanup.
- Compile development fixtures with the Apple toolchain. The qualified installed
  ARM Mac host uses packaged support and requires no consumer compiler.
  Universal asset slices do not authorize Intel or Rosetta execution.

## Work Guidance

- Follow `../src/internal/AGENTS.md` for the host's containment and authority
  contracts. Keep the native code small and use SDK declarations where
  available.
- `../scripts/native-support.mjs` owns the canonical two-architecture Apple
  build. `just jig::build-native-support` regenerates all native binaries, their
  `macos-native-build.json` provenance manifest, and both descriptor digest
  pins. Review all of these together. The manifest records source/recipe/output
  hashes and the compiler, linker and SDK. It is a consistency record, not an
  attestation.
- Private ABI changes require native executable evidence on the selected kernel.

## Verification

- Every ordinary Jig build runs `just jig::check-native-support` before cleaning
  output. This portable check rejects stale sources, recipes, binaries and pins.
- `just jig::verify-native-rebuild` requires the recorded Apple toolchain and
  compares freshly compiled universal bytes with all checked-in native assets.
  Toolchain differences fail explicitly. A portable hash check does not prove
  source-to-binary equivalence. Changed native bytes need native host
  qualification.
- `bun test packages/jig/test/portable/native-support-build.test.ts` checks independent
  source, recipe, binary and runtime-pin corruption refusal, plus a nonzero
  LC_UUID in both slices of each binary (required by newer Darwin loaders).
- `JIG_MACOS_PROCESS_TEST=1 bun test packages/jig/test/macos/macos-execution.test.ts`
  uses the candidate native Bun on the qualified Mac, outside an enclosing
  sandbox. It compiles with warnings as errors and checks admission, inherited
  descriptor closure with a positive control, private-file denial and cleanup.

- `test/macos/macos-preferences-observer.test.ts` checks the actual authenticated
  helper and genuine inherited-sandbox refusal on native ARM hosts.
  `test/macos/macos-preferences-boundary.test.ts` checks populated ordinary
  preferences, denied reads and writes, narrow IPC and bounded read-only shared
  mappings. These checks do not establish a private shared-memory layout.
  Actual forced-policy refusal and stalled-framework alarm expiry still require
  separate native observations. Interposition cannot establish those claims.

## Child DOX Index

- None.
