---
title: Agent Exchange contract
description: The exact bounded prepared-prompt interface used by reusable Agent methods.
---

# Agent Exchange contract

Agent Exchange lets a reusable method send one prepared prompt to an
operator-selected Agent and receive its final text and stop reason. The method
interprets the answer; the host supplies provider authority and settles the work.

`https://jig.md/contracts/agent-exchange` identifies that interface. You may
encounter it in a package-local invocation descriptor. It is an explanatory
address, not an Agent endpoint. Matching uses the exact ID, version and
canonical descriptor/closure digest offline; hosts do not fetch this page to
resolve a call. Copying the descriptor grants no permission to use a provider.

- Read the [Agent Exchange specification](../spec/agent-exchange.md) for exact
  values, limits, failure behavior and independent host obligations.
- [Reuse the Agent method](../guide/agent-method.md) as a pure library or an
  ordinary Flow, with its complete source candidate artifact.
- Get the [invocation descriptor](https://jig.md/contracts/agent-exchange/contract.json)
  and its [referenced channel descriptor](https://jig.md/contracts/agent-exchange/contracts/acp-public-updates.json).
  Preserve the latter's `contracts/acp-public-updates.json` path beside the
  invocation descriptor when copying the bundle.
- [Choose an Agent](../guide/agents.md) in the host's operator configuration.
- Read [Agent Run](agent-run.md) for the method interface that accepts explicit
  instructions and Skill contents and returns a checked structured answer.

This interface is a prerelease source candidate. Its `done` result reports
completed transport; the returned text and stop reason still need the method's
interpretation and the application's checks.
