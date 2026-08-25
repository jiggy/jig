# `@jigging/jig`

Private pre-release implementation of Jig. The package checker and first pure
project-authoring slice are development evidence, not a published stable host
interface.

```console
bun run src/cli.ts package check ./path/to/package
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
