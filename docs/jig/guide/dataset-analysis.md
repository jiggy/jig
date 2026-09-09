# Let running Flows exchange data

Find the first temperature at or above a threshold without giving the analysis
Flow the entire dataset. It requests one sample, uses the answer to choose the
next, and returns the crossing. Two named channels connect it to a dataset Flow;
ordinary child calls still start the work and return each result.

With [Jig installed](index.md), use the
[dataset-analysis source example](https://github.com/jiggy/jig/tree/main/examples/dataset-analysis).
After [workspace setup](dependencies.md#local-workspace-packages), run from that directory:

```sh
jig review
jig run binding:analysis --input @input.json
```

No Agent or credentials are needed. The included eight-sample dataset crosses
30°C at `s4` (31°C). The analysis requests `s4`, `s2`, then `s3`; the parent
checks that transcript and the crossing against its original input.

## Wire the conversation

The parent creates two direct channels with local contract descriptors and
passes opposite endpoints to its exact child slots:

| Channel | Analysis | Dataset | Message |
| --- | --- | --- | --- |
| `requests` | Send | Receive | `{ sample: "s4" }` |
| `replies` | Receive | Send | `{ sample: "s4", celsius: 31 }` |

Each child accesses its declared endpoints through `run.channels`. The
[parent source](https://github.com/jiggy/jig/blob/main/examples/dataset-analysis/flows/investigate/investigate.ts)
shows the complete wiring and cleanup using `run.channel()` and
`run.runChildFlow()`. There is no callback registry or new conversation API.

Named contracts agree on meaning as well as message shape. Both sides must
accept the same descriptor identity, version, and digest. A same-shaped
Fahrenheit contract is not interchangeable with the Celsius contract. The
illustrative identities use `example.org`; they are not fetched from the web.
Correlation and search policy remain application checks, not schema features.

## Bound the work and interpret the result

Input contains `threshold` and 1–128 `samples`, each with a unique `sample` ID
and a finite `celsius` value, in nondecreasing temperature order. Edit
`input.json` to try another dataset. The analysis makes at most eight unique
requests, one at a time, using one receiver iterator throughout.

After the search, it closes the request writer and drains readings to EOF.
The dataset closes its writer after request EOF. Unknown, duplicate, missing,
or extra replies make the analysis unsuccessful; they do not become a guessed
crossing. The parent retains each child's result and any validated observations,
and independently checks the claimed answer. A `null` crossing means no sample
qualifies only when verification was accepted.

Inspect the terminal Run outcome, `output.verification`, and the separate
`output.children` results. EOF establishes that a stream ended, not that a child
succeeded. An unresolved branch failure cancels its sibling and joins both;
Ctrl-C cancels the root and its owned work.

For a local array, an ordinary function is simpler. This example teaches the
same protocol for independently implemented participants; it does not claim
that splitting this small calculation is faster. Jig currently runs these
TypeScript Flows with Bun. Separate FLOW conformance fixtures exercise the
conversation between TypeScript and Python; that is not Python runtime support
in Jig. See [channels](channels.md) for live progress and broadcast subscriptions.
