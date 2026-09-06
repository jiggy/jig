# Get a patch you can inspect

Give this application a small TypeScript bug and the files it needs. It asks
your configured Agent for a repair, executes independent acceptance checks,
and saves a patch with evidence. It never applies the patch or writes to your
original repository.

This is a narrow authored example, not a general coding assistant: one
existing synchronous function, JSON arguments/results, one editable file,
and at most two Agent calls. The acceptance cases belong to you, not the model.

## Start here

Use the Jig source candidate from the same checkout, Bun 1.3.3, and a
[supported Linux host](https://jig.md/guide/). Copy this directory, including
its two `bun.lock` files, to your own application directory. No local package
installation is needed to use it; Jig prepares the locked SDK during review.

Configure your Agent, inspect the application and `flows/repair/checks.json`,
then run from that copy:

```sh
jig review
bun --no-env-file --no-install --config=/dev/null repair.ts \
  --repo fixtures/utf8 --edit src/truncate-utf8.ts --file README.md \
  --issue 'Fix UTF-8 byte truncation without splitting a code point. Preserve invalid-budget rejection.' \
  --out ../utf8-repair
```

The output directory must not already exist. Read `summary.txt` first. A
`review.patch` appears only when the replacement passed the checks; unsuccessful
proposals remain explicitly named `proposal-N.patch`. Review any passing patch
before deciding to apply it. Ctrl-C asks Jig to cancel and waits for settlement.

The [public guide](https://jig.md/guide/tested-patch) covers provider setup,
source-candidate availability, limits, failure interpretation, and adapting
the acceptance cases to your utility. This example is not a claim of reliable
general repair or an independently established advantage over a coding Agent.
