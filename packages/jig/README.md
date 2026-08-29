# `@jigging/jig`

Private pre-release implementation of Jig. The package checker and first pure
project-authoring slice are development evidence, not a published stable host
interface.

This artifact does not open projects, issue Root Administration authority,
plan or apply projects, or execute FLOW packages.

The `@jigging/jig/administration` path also exports the inert
Project Administration/1 and Root Administration/1 value/type candidates for
trusted-host injection and packed-consumer testing. It exports no project
opener or host implementation.

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
