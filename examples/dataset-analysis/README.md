# Investigate a dataset through a conversation

Find the first temperature at or above a threshold without giving the analysis
Flow all the readings. It requests a sample, uses the reply to choose its next
sample, and returns a finding supported by the observations it received.

With Jig on a [supported host](https://jig.md/guide/), run from this directory:

```sh
jig review --allow-resolution-network
jig run binding:analysis --input @input.json
```

The included dataset reaches 30°C at `s4` (index 4, 31°C). Analysis asks for
`s4`, then `s2`, then `s3`: the next question depends on the previous answer.
The root checks that finding against the original input and returns both
participants' results and the observed readings. No Agent configuration is needed.

Edit `input.json` to supply 1–128 nondecreasing readings, a threshold, and
unique sample identifiers. A dataset entirely below the threshold produces
a verified `null` crossing. `blocked` means no verified finding; inspect
`children`, `failures`, and any preserved observations. Ctrl-C stops the work.

The three ordinary Flows communicate through two direct channels with named
request and Celsius-reply contracts. Matching JSON shape alone does not make
a Fahrenheit reader compatible. The root's exact child slots let a different
implementation participate without changing the analysis method.

This deliberately small example teaches a finite structured conversation,
not general statistical analysis, guaranteed delivery, or a database service.
Review resolves the declared dependencies and retains their exact bytes.
