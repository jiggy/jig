# `@jigging/jig`

Private pre-release implementation of Jig's inert FLOW package checker. The
current package is development evidence, not a published or stable interface.

```console
bun run src/cli.ts package check ./path/to/package
```

`package check` captures and validates one FLOW package. It does not execute
package code, resolve a runtime, or claim that the package is ready to run.
