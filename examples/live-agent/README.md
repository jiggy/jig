# See your Agent work

Run one Agent and display its public text as it arrives. The Flow owns the
filter: it ignores plan records, can suppress progress, and keeps the final
Agent result separate from progress delivery.

With Jig installed on a [supported host](https://jig.md/guide/) and a configured
[native Agent](https://jig.md/guide/agents) supporting public updates:

```sh
jig review
jig run flow:flows/chat --input @input.json
```

Text appears live on diagnostic stderr. The final result records the Agent's
outcome and whether progress delivery completed. Ctrl-C requests cancellation.
Provider configuration and credentials remain with the operator.

For structured subprocess output:

```sh
jig run flow:flows/chat --input @input.json --receive progress
```

The same Flow sends text through its selected output instead of printing it.
Stdout contains channel records followed by the terminal execution result.
An incomplete stream is not proof that the Agent failed; the terminal result
remains necessary.

Set `"suppress": true` in the input to stop progress presentation. This does
not redact the returned answer or prevent the configured provider receiving
the instructions. The example makes one Agent call and supplies no tools,
attachments, network policy, or automatic retry of its own.
