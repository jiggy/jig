# Entrypoint decision under review

## The standards fact

There is no “strict POSIX shebang” profile to adopt. POSIX documents `#!` as a
historical implementation strategy and says the result is unspecified when a
shell-command file begins with it. `/usr/bin/env -S` is also not POSIX. A FLOW
specification may adopt a de facto Unix convention, but it must not call that
choice POSIX portability.

## Information an executable declaration must convey

Before running code, Jig needs to know:

1. the one package entry file;
2. the runtime family or an explicit decision to delegate runtime choice;
3. whether the host has a compatible runtime adapter;
4. the protocol generation;
5. that launch will not pass through a shell.

Runtime flags, dependency preparation, permissions, environment, settings, and
platform selection are separate concerns. Putting all of them in the launcher
would recreate runner profiles.

## Competing designs

### A. `entry` argv in `FLOW.md`

This is explicit and sufficient, but makes the semantic document and the source
file jointly authoritative. It permits arbitrary paths and package-specific
runtime flags. Renaming the implementation without changing frontmatter breaks
the package.

### B. `flow.json` argv

This is equally explicit and even better separated from prose, but requires a
third special artifact (`FLOW.md`, descriptor, implementation) and provides two
places to inspect before one knows how the package starts.

### C. root `flow[.ext]` plus OS shebang

This is local and visually obvious, but its exact parsing and direct execution
are platform-dependent. It cannot be the normative portable rule.

### D. root `flow[.ext]` plus a FLOW runtime directive

The candidate rule is:

```text
flow.ts
first line: #!flow deno
```

- Exactly one root file named `flow` or `flow.<single-extension>` may exist.
- A text implementation MAY start with `#!flow <runtime-id>`.
- Jig, not the OS, parses this line. It is a FLOW directive using familiar
  hashbang syntax, not a claim about POSIX execution.
- The directive contains one runtime-adapter ID and no command, shell syntax,
  flags, interpolation, substitutions, or paths.
- The adapter owns the conventional argv needed to execute that file. Language
  config files own language-specific behavior. Jig's grant policy owns
  authority.
- If the directive is present, the runtime is pinned. An unavailable runtime is
  a preflight incompatibility; a Deno Flow is never tried with Bun.
- If absent, the extension delegates to the project's configured source-family
  runtime. This is a deliberate portability claim by the package author, not a
  guarantee that all runtimes accept the source.
- Native `flow` binaries are recognized by the runtime registry/package
  artifact and do not contain a directive.
- The runtime registry resolves IDs to approved absolute executables and always
  launches with `shell: false` inside the selected sandbox.

Protocol generation can remain the Package/1 default. A future incompatible
entry protocol requires explicit package metadata rather than overloading the
runtime directive.

## Current recommendation

Option D currently has the best locality-to-precision ratio. It preserves the
one-obvious-entrypoint convention while matching argv metadata on the disputed
fact—runtime choice. It intentionally does not try to be directly executable by
the host kernel.

This is not settled until prototypes show:

1. the directive is accepted as an ignorable first-line comment by the initial
   supported source runtimes or is safely removed by their adapter;
2. a runtime adapter can launch Deno, Bun, Node/tsx, Python, shell, WASI, and a
   native binary without package-specific command fields;
3. `jig check` catches multiple candidates, malformed directives, unknown
   runtimes, and Deno-on-Bun before code runs;
4. language-native config can replace package-controlled launch flags without
   hiding permissions or dependency installation;
5. the runtime-ID namespace can evolve without a mandatory centralized package
   registry.

If those tests fail, prefer an `entry` argv in `FLOW.md`, not `flow.json`: one
additional authoritative location is less harmful than two.
