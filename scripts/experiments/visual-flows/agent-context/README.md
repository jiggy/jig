# Textual application context screening

Help coding agents understand application handoffs and locate changes with less repository exploration.
This experiment compares Mermaid sequence source, DOT source, and prose using one audited support-case packet.
It defines no public Jig command or FLOW interface.

## Evidence and representation

`support-case.json` contains fourteen maintainer-interpreted source facts and their exact source anchors.
Full file digests bind the context, including contracts and helper code.
Digest checks establish freshness, not correctness of the interpretation.
The packet describes selected source relationships without claiming local approval or observed execution.
Cancellation, reporting, detailed validation branches, and other components remain outside its scope.

Every representation contains each fact once and the same source references.
Sequence syntax groups caller reactions under explicit alternatives.
DOT edges carry relationship kinds and textual conditions, rather than implying chronological order.
Prose preserves the same endpoints and relationship kinds.
The renderers are specific to this frozen packet, not source analyzers.

Generate inspectable text into a new directory:

```sh
node scripts/experiments/visual-flows/agent-context/experiment.mjs .tmp/context-reading
node --test scripts/experiments/visual-flows/agent-context.test.mjs
```

## Screening protocol

The opt-in runner makes six successful requests, comprising two blocks across three representations.
The second block reverses arm order.
Failures try other authorized endpoints and remain in the receipt.
Requests are serial with at least 3.2 seconds between starts.
Credentials come from environment variables and never enter receipts.

```sh
node scripts/experiments/visual-flows/agent-context/run.mjs .tmp/context-screen
```

The runner prefers direct Mistral, then the configured Google and Mistral BYOK identifiers, then OpenRouter's shared free pool.
The selected endpoint and returned model remain recorded for each request.
Each request has a 60-second deadline and a bounded completion budget.
The runner writes exact prompts, bounded credential-screened HTTP bodies, model responses, usage, durations, failures, and scores into the selected directory.
Summary output separates schema validity, answer omissions, and edit results, and discloses provider/model identities per sample.
Use `node scripts/experiments/visual-flows/agent-context/summarize.mjs RECEIPT_DIRECTORY` to report wrong and omitted answers separately.
Existing destinations refuse reuse.

Eight closed questions test caller identity, data forwarding, outcome handling, decision fields, source location, and missing evidence.
The same original policy module accompanies every representation.
The modification task changes the eligibility cap from 5000 to 7500 cents.
Only that exact numeric replacement is accepted.
Nine assertions execute the original policy with that validated edit in a disposable directory.
Provider-generated code is never executed.
These checks cover boundary values, amount mismatch, ambiguous requests, and unknown charges.
They establish application-policy behavior, not Jig admission or native containment.

## Interpretation limits

This is a small communication screening, not a general coding benchmark or independent product adoption probe.
Providers receive only public example facts and source, without tools, platform internals, or prior conversation.
The coordinator authored the packet, questions, and scorer.
Questions directly target supplied facts, and the edit is deliberately narrow.
A perfect score can expose a ceiling effect rather than establish a winning representation.

Compare correctness before token counts or latency.
Report schema failures separately from wrong answers.
Provider token usage includes the common policy source and questions.
The second block may benefit from provider caching.
Temperature zero and repeated prompts do not create independent samples.

The initial packet and semantic interpretations require a human source audit before each deliberate refresh.
Do not automatically update hashes to conceal changed meaning.
Preserve every failed or superseded run under `.tmp/`.
Record protocol corrections before rerunning.
Future extraction and modification studies need unseen applications, broader edits, and a source-only baseline.
Their design must distinguish information supplied from its textual encoding.

## Behavioral overview study

`behavior-study.mjs` freezes public source and existing CLI context for software-factory, support-case, and contact-import.
The committed behavioral briefs are maintainer interpretations. Their complete source basis must match before generation.
Refresh `behavior-basis.json` only after auditing changed source and the affected interpretations.
The generator invokes ordinary `jig inspect --flow`, including its contained declaration evaluation.
It neither approves projects nor executes their methods.

```sh
node --test scripts/experiments/visual-flows/behavior-study.test.mjs
node scripts/experiments/visual-flows/agent-context/behavior-study.mjs .tmp/behavior-packets
node scripts/experiments/visual-flows/agent-context/behavior-run.mjs .tmp/behavior-packets .tmp/behavior-results
```

The opt-in runner compares source-only, existing inspection, and inspection with an audited behavioral overview.
Agents receive bounded read-only source tools. Proposed edits remain inert data and are never imported or executed.
Tasks change batch conflicts, propagate a new child refusal, and stop preview export at a specific decision.
Scope validity, syntax, contract-data checks, and semantic review establish separate properties.

The runner first records current-behavior answers, then reveals the modification task.
It records unknown answers separately from proposed edits. Consumers can abstain without reading source.
A factory negative control supplies false overlap and timer claims with otherwise valid references.
Receipts identify that control. Consumer-visible prompts do not disclose its assigned arm.

Each run permits at most 90 provider requests, with 90-second request deadlines and 3.2-second spacing.
Each consumer has seven turns and a combined 256 KiB source-read allowance.
Generation costs appear separately from consumer costs. Model identities, failures, raw bounded responses, and conversations remain in receipts.
`JIG_BEHAVIOR_GENERATION_RECEIPT` reuses recorded generation evidence without spending another generation call.
Reused evidence does not become a fresh generation result.

The first run combined current questions with future edits. Its answers can mix temporal states and cannot establish comprehension differences.
The corrected run records answers first. Some consumers abstained before reading source, which limits comparisons with supplied summaries.
Both runs remain evidence of those protocols. Neither establishes a winning representation, general coding benefit, or reliable automatic brief generation.
Reference integrity and matching hashes never certify the behavior described by a brief.
