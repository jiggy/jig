# Handle a disputed charge

An Agent interprets a customer's request. Code checks account records and
credit policy, then returns a decision another application can consume.
A persuasive answer cannot raise the credit limit or create a duplicate payment.

The included `grants/agent.json` selects Codex as an example choice. Choose
`codex`, `claude`, or `pi` with `jig agent --grant grants/agent.json --client codex`
before review, and complete its
[Agent configuration](../../docs/jig/guide/agents.md#local-clients).
`jig.ts` routes the assessor's Agent slot to this configured Binding.

After [workspace setup](../../docs/jig/guide/dependencies.md#local-workspace-packages),
run here on a [supported host](../../docs/jig/guide/index.md#supported-host):

```sh
jig review --allow-resolution-network
jig run binding:support --input @fixtures/duplicate.json --timeout 2m --display tui
```

For the intended assessment (`ch-102`, 2400 cents), `done` returns
`disposition: "credit_eligible"` and `credit: {chargeId: "ch-102", amountCents: 2400}`.
The reply says the payment is eligible; it does not claim that money moved.
An Agent can return a different assessment, which the policy checks in turn.

Try `fixtures/not-duplicate.json` and `fixtures/over-limit.json`. Even if the
Agent follows their requests for an improper credit, code cannot produce an
eligible credit: the first has no duplicate, the second exceeds the USD 50 ceiling.
All fixtures are synthetic; no payments or messages are sent.

Two Flows divide the work:

- `assess` proposes a disputed charge and amount through one Agent call.
- `resolve` calls its configured `assessment` slot, checks the proposal against
  supplied records and reviewed policy, and constructs the decision and reply.

`done` means the decision completed: `credit_eligible`, `no_credit`, or
`manual_review`. `blocked` and `limit` mean the assessment could not complete.
Execution errors and cancellation propagate without retries.

The caller supplies authenticated, complete account records in chronological
order. Customer text must never populate those facts. A consuming billing
service must recheck current state and own authorization and idempotency before
acting; the example returns eligibility, not a reusable payment authorization.
This policy does not prove that the Agent identified the customer's intent correctly.

## Follow the work

**Case** follows the request, proposed charge and code-owned eligibility decision.
**Charges** keeps the supplied chronological records available for comparison; long
lists explicitly show their retained excerpt. The assessor's own Case view stops at a
proposal. An eligible decision never claims that a credit was issued.

Choose `--display web` instead of `--display tui` to use the same views in a
browser. Open the private link printed after execution starts. The completed inspector
stays open until you explicitly close it; leaving a live display does not cancel work.
Blocking causes remain reachable from every view. Plain output and `--json` remain
available.

Read the [walkthrough](../../docs/jig/guide/support-case.md), then run:

```sh
bun test examples/support-case/test
```

Run tests from the repository root. Deterministic Agent substitutes cover a
wrong but well-formed proposal, policy bounds, refunded and unknown charges,
malformed results, failure, and cancellation. They do not measure model accuracy.
