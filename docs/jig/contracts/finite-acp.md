---
title: Finite ACP contract
description: Connect a replaceable Agent Flow to a narrowly authorized native client.
---

# Finite ACP contract

Finite ACP lets ordinary Flow code conduct one native Agent task without
receiving credentials or unrestricted process access. The Flow owns the
conversation and checks its answer. Jig independently enforces the approved
client, finite dispatch policy, lifetime and cleanup.

`https://jig.md/contracts/finite-acp` names an interface, not a permission or
discovery service. A package includes its
[invocation descriptor](https://jig.md/contracts/finite-acp/contract.json) and
descriptor-relative [request](https://jig.md/contracts/finite-acp/requests.json)
and [response](https://jig.md/contracts/finite-acp/responses.json) agreements.
Resolution matches that complete identity offline.

- [Finite ACP specification](../spec/finite-acp.md): grant, framing, authority,
  failure and settlement.
- [Choose an Agent](../guide/agents.md): use a replaceable implementation.

Channel receipt does not prove a prompt ran, and a completed prompt does not
prove process cleanup. The resource returns actual termination evidence;
the Agent Flow separately returns the checked application result.
