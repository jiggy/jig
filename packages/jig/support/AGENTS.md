# Native support assets

## Purpose

Keep native execution under the trusted host's control without adding operator
setup or package-held authority.

## Ownership

- `codex-requirements.toml` supplies the installed native client's constrained
  policy. Provider code owns its selection, identity and projection.
- `macos-exec.c` owns the private Darwin pre-exec boundary. The private host
  owns profile generation, durable admission, supervision, recovery and assembly.

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
- Mac assembly and installed support remain unpromoted until the complete host
  is qualified. Compile development fixtures with the Apple toolchain; a consumer
  compiler is not part of the intended installation experience.

## Work Guidance

- Follow `../src/internal/AGENTS.md` for the host's containment and authority
  contracts. Keep the native code small and use SDK declarations where available.
- Private ABI changes require native executable evidence on the selected kernel.

## Verification

- `JIG_MACOS_PROCESS_TEST=1 bun test packages/jig/test/macos-execution.test.ts`
  uses the candidate native Bun on the qualified Mac, outside an enclosing
  sandbox. It compiles with warnings as errors and checks admission, inherited
  descriptor closure with a positive control, private-file denial and cleanup.

## Child DOX Index

- None.
