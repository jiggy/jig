# Expected defaults-only failures

- Adding a required setting makes `{}` invalid and removes the proposed
  default. An explicit Binding is required.
- Adding `uses`, `attachments`, instruction-only execution, or instruction
  fallback removes the default. Jig never guesses providers, roots, or Agents.
- Changing the package to Service mode never derives or mounts a Service.
- A second configured Flow root containing an otherwise eligible `greet/`
  makes the unowned default ambiguous. Jig derives neither and reports that an
  explicit Binding is required; filesystem order and semantic choice do not
  decide.
- `bindings/greet.ts` owns `greet` and suppresses every proposed default under
  that ID, whether it uses `flows/greet` or deliberately points elsewhere. No
  merge occurs.
- `bindings/formal-greet.ts` creates an additional variant while `greet`
  remains available.
- Adding or changing the package creates only a pending candidate. Without
  aggregate apply, the active generation does not change.
- Missing or ambiguous Bun Adapter or Sandbox Backend evidence admits the
  structurally valid default as unavailable; it does not invoke instructions.
- Final-Run attempts to access project files, raw network, environment, host
  IPC, or children fail at the enforcing boundary. Preparation is a different
  owner with its own independently reviewed authority envelope.
- Revoking `greet` writes the same local tombstone used for explicit Bindings;
  re-derivation cannot bypass it.
- Removing an authored `greet` may propose the eligible default in a later
  candidate generation. It remains inert until that generation is applied.
