# See your Agent work

Run one Agent and display its public text as it arrives. The Flow owns the
filter: it ignores plan records, can suppress progress, and keeps the final
Agent result separate from progress delivery.

With Jig on a [supported host](https://jig.md/guide/) and a configured
[native Agent](https://jig.md/guide/agents) supporting public updates, run from
this directory:

```sh
jig review
jig run flow:flows/chat --input @input.json
```

The example uses the checkout's SDK workspace. Complete the
[workspace setup](https://jig.md/guide/dependencies#local-workspace-packages)
once; review captures the local dependency bytes.

Text fragments appear continuously on diagnostic stderr, preserving spaces and
paragraph breaks rather than adding a line break for every update. The final result records the Agent's
outcome and whether progress delivery completed. Ctrl-C requests cancellation.
Provider configuration and credentials remain with the operator.

For structured subprocess output:

```sh
jig run flow:flows/chat --input @input.json --receive progress --json
```

The same Flow sends text through its selected output instead of printing it.
Stdout contains channel records followed by the terminal execution result.
Omit `--json` in a terminal for continuous text under a channel heading and a
readable final result. Redirected output always retains the machine records.
An incomplete stream is not proof that the Agent failed; the terminal result
remains necessary.

Set `"suppress": true` in the input to stop progress presentation. This does
not redact the returned answer or prevent the configured provider receiving
the instructions. The example makes one Agent call and supplies no tools,
attachments, network policy, or automatic retry of its own.
