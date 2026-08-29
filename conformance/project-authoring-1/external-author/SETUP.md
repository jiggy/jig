# Offline campaign setup

These commands install only the artifacts named by the sealed
`CAMPAIGN.json`. They create all generated state outside the frozen author
submission. Run them with `/bin/sh` after setting three absolute paths:

```sh
PACKET=/absolute/path/to/project-authoring-probe-1-packet
WORK=/absolute/path/to/empty-campaign-work
PROJECT="$WORK/submission/project"
```

Set `BUN` and `PYTHON` to the exact executable paths recorded in
`CAMPAIGN.json`. Do not substitute an executable found through `PATH`:

```sh
BUN=/absolute/path/recorded-at-runtimes.bun.executable
PYTHON=/absolute/path/recorded-at-runtimes.python.executable
```

The setup is intentionally fail-closed. In addition to `jig`, `flowTypeScript`,
`flowPython`, `typescript`, and `yaml`, the manifest must contain a
`packages.typescriptPlatform` entry for the exact platform package required by
TypeScript 7. The compiler launcher alone is not an offline compiler. A packet
without that entry is incomplete and must not use a registry or ambient cache
to repair itself.

Verify those prerequisites without writing the submission:

```sh
test -d "$PACKET"
test ! -e "$WORK"
test -x "$BUN"
test -x "$PYTHON"
"$BUN" -e '
  const manifest = await Bun.file(process.argv[1]).json();
  if (manifest.campaign !== "project-authoring-probe-1" || manifest.format !== 1) {
    throw new Error("wrong campaign manifest");
  }
  for (const key of ["jig", "flowTypeScript", "flowPython", "typescript", "typescriptPlatform", "yaml"]) {
    const entry = manifest.packages?.[key];
    if (!entry || typeof entry.name !== "string" || typeof entry.version !== "string" || typeof entry.artifact !== "string") {
      throw new Error(`missing sealed package entry: ${key}`);
    }
    const artifact = `${process.argv[2]}/${entry.artifact}`;
    if (!Bun.file(artifact).size) throw new Error(`missing sealed artifact: ${key}`);
  }
' "$PACKET/CAMPAIGN.json" "$PACKET"
```

Create the disposable work root and copy only the author's editable source
there. The author creates the required `project/` tree under `submission/`:

```sh
mkdir -m 700 "$WORK"
mkdir -m 700 "$WORK/submission"
```

The following helper prints one manifest field and rejects path-like package
names. It is used only to resolve sealed packet metadata, never project input:

```sh
campaign_field() {
  "$BUN" -e '
    const manifest = await Bun.file(process.argv[1]).json();
    const fields = process.argv[2].split(".");
    let value = manifest;
    for (const field of fields) value = value?.[field];
    if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("..")) {
      throw new Error(`invalid campaign field: ${process.argv[2]}`);
    }
    process.stdout.write(value);
  ' "$PACKET/CAMPAIGN.json" "$1"
}
```

Resolve each local artifact and require the exact candidate versions:

```sh
JIG_TGZ="$PACKET/$(campaign_field packages.jig.artifact)"
FLOW_TS_TGZ="$PACKET/$(campaign_field packages.flowTypeScript.artifact)"
FLOW_PY_WHEEL="$PACKET/$(campaign_field packages.flowPython.artifact)"
TYPESCRIPT_TGZ="$PACKET/$(campaign_field packages.typescript.artifact)"
TYPESCRIPT_PLATFORM_TGZ="$PACKET/$(campaign_field packages.typescriptPlatform.artifact)"
TYPESCRIPT_PLATFORM_NAME="$(campaign_field packages.typescriptPlatform.name)"
YAML_TGZ="$PACKET/$(campaign_field packages.yaml.artifact)"

test "$(campaign_field packages.jig.version)" = 0.0.0
test "$(campaign_field packages.flowTypeScript.version)" = 0.0.0
test "$(campaign_field packages.flowPython.version)" = 0.0.0
test "$(campaign_field packages.typescript.version)" = 7.0.2
test "$(campaign_field packages.typescriptPlatform.version)" = 7.0.2
test "$(campaign_field packages.yaml.version)" = 2.9.0
case "$TYPESCRIPT_PLATFORM_NAME" in
  @typescript/typescript-*) ;;
  *) echo "unexpected TypeScript platform package" >&2; exit 1 ;;
esac
```

Install the four npm package archives and the platform compiler archive by
extracting their standard `package/` roots. This avoids registry resolution,
ambient package caches, install scripts, and lockfile mutation. `tar` is host
tooling for this campaign, not a Jig or FLOW interface.

```sh
install_tgz() {
  archive=$1
  destination=$2
  test -f "$archive"
  test ! -e "$destination"
  mkdir -p "$destination"
  tar -xzf "$archive" --strip-components=1 -C "$destination"
}

install_tgz "$JIG_TGZ" "$WORK/node_modules/@jigging/jig"
install_tgz "$FLOW_TS_TGZ" "$WORK/node_modules/@flowmd/sdk"
install_tgz "$TYPESCRIPT_TGZ" "$WORK/node_modules/typescript"
install_tgz "$TYPESCRIPT_PLATFORM_TGZ" "$WORK/node_modules/$TYPESCRIPT_PLATFORM_NAME"
install_tgz "$YAML_TGZ" "$WORK/node_modules/yaml"
```

Create the disposable Python environment and install only the sealed wheel:

```sh
"$PYTHON" -m venv "$WORK/python"
"$WORK/python/bin/python" -m pip install --no-index --no-deps "$FLOW_PY_WHEEL"
"$WORK/python/bin/python" -I -c '
import importlib.metadata
import flowmd_sdk
assert importlib.metadata.version("flowmd-sdk") == "0.0.0"
'
```

After the author has created the complete project, run the exact static
checks. `node_modules`, the Python environment, caches, and compiler output
remain siblings of `submission/`, never children of it.

```sh
test -d "$PROJECT"
"$BUN" "$WORK/node_modules/typescript/bin/tsc" -p "$PROJECT/tsconfig.json" --noEmit
PYTHONPYCACHEPREFIX="$WORK/pycache" \
  "$WORK/python/bin/python" -m py_compile "$PROJECT/flows/normalizer/flow.py"
"$BUN" "$WORK/node_modules/@jigging/jig/dist/cli.js" package check "$PROJECT/flows/normalizer"
"$BUN" "$WORK/node_modules/@jigging/jig/dist/cli.js" package check "$PROJECT/flows/reviewer"
```

Evaluate only the inert authoring modules and assert that their exported values
are frozen. These imports do not open, plan, apply, or run a project:

```sh
cd "$PROJECT"
"$BUN" -e '
  const project = (await import("./jig.ts")).default;
  const binding = (await import("./bindings/reviewer.ts")).default;
  if (!Object.isFrozen(project) || !Object.isFrozen(binding)) {
    throw new Error("authoring helper returned a mutable value");
  }
'
```

After the author surrenders the tree, the campaign runner returns to the work
root and freezes it with the evaluator-only tool:

```sh
cd "$WORK"
"$BUN" "$PACKET/evaluator/freeze-submission.ts" "$WORK/submission"
```

The author does not receive the evaluator directory. The freezer writes its
inventory to stdout, and the campaign runner stores that stdout outside
`submission/`; redirecting it into the submission would change the tree being
measured.
