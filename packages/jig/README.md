# `@jigging/jig`

Private prerelease implementation of Jig. This package is not a published
stable host interface.

Its bare initializer writes only inert user-owned project source:

```console
jig init --bare ./my-project
```

```console
jig package check ./path/to/package
```

`package check` captures and validates one FLOW package. It does not execute
package code, resolve a runtime, or claim that the package is ready to run.

The package root also exports the closed Project Authoring SDK/1 candidate:

```ts
import { defineJig, discover } from "@jigging/jig";

export default defineJig({
  flows: discover("./flows"),
});
```

These helpers construct inert frozen data. They do not discover or admit the
referenced files.

The current packed command surface does not yet open a project or execute a
FLOW package. `jig check` and `jig run` will be added only when the same packed
artifact passes the installed Operational Baseline/1.
