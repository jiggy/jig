# Get a patch you can inspect

Give this application a small TypeScript bug and the files it needs. It asks
your configured Agent for a repair, runs independent acceptance checks, and
saves a patch with evidence. Your original files remain unchanged.

## Try it

Follow the [Jig installation instructions](https://jig.md/guide/).
Copy this directory, configure
your [Agent](https://jig.md/spec/agent-run#alpha-host-implementations), and inspect
the issue in `issue.json` and acceptance cases in `flows/repair/checks.json`.
Then run from your copy:

```sh
jig review
jig run binding:repair --input @issue.json --attach source=fixtures/utf8 --out ../utf8-repair --timeout 5m
```

Open `../utf8-repair/files/summary.txt`. A `review.patch` appears beside it
only after the proposed replacement passed the unchanged checks. Failed
proposals are named `proposal-N.patch`; `../utf8-repair/result.json` contains
the execution record and file identities. Review the patch before applying it.

The destination must be new. Ctrl-C requests cancellation; operational failures
export no partial Flow files. Provider charges may apply even to unsuccessful
or interrupted calls. Jig prepares the locked SDK during review, so running
this example needs no separate Bun launcher or local dependency installation.

This is a deliberately narrow example: one synchronous TypeScript function,
JSON arguments/results, one editable file, and at most two Agent calls. Its
two Flows separate candidate execution from acceptance policy. It is not a
general coding terminal or a promoted Starter.

The [public guide](https://jig.md/guide/tested-patch) explains the evidence,
failure outcomes, and adaptation to another utility.
