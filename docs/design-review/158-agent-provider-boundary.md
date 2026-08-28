# Agent provider boundary disposition

**Status:** blocked on 2026-08-28 after three independent design audits. The
logical Agent Run and Flow-local skill projection checkpoint in review 157
remains complete. No contained provider, provider registration, Agent Binding,
or durable Agent effect is claimed.

## 1. The missing prerequisite

The current host authenticates retained Bun and Python runtime support. It
does not install, retain, authenticate, or admit an Agent-provider artifact.
Project packages cannot fill that role: provider trust and lifetime belong to
the operator, outside FLOW source and project authority.

The next required object is one protected operator-owned registration which
pins an exact provider artifact, Agent Run contract, authority ceiling,
runtime support, and containment plan. That object must be reacquirable after
coordinator restart and must become exactly unavailable when any retained
evidence is absent or changed. The repository has no host-policy schema,
registration token/origin model, or provider-management boundary from which
to derive it honestly.

A mutable checkout fixture, ambient executable, project-installed package, or
caller-injected callback is not a substitute. Creating a generic registry or
module ABI from one deterministic fixture would repeat the failed design-probe
mistake.

## 2. What the audits established

All three audits agreed that a credible provider operation must:

- run one fresh out-of-process provider inside the existing cgroup-v2 and
  Bubblewrap envelope;
- expose only the selected skill subtrees through one operation-scoped,
  read-only projection;
- expose no caller package root, sibling skills, project files, ambient
  environment, network, credentials, cgroup controls, KVM, or TUN;
- validate the exact Agent Run request and result, including response
  Schema/1;
- fence the complete provider process tree before publishing any terminal;
  and
- record possible dispatch durably so loss is uncertain rather than replayed.

They did not agree that one private fixture should establish a transport.
Plausible implementations reuse a one-operation Run/1 process, a one-operation
Service/1 incarnation, or a deliberately private one-shot exchange. That
disagreement is further evidence that the provider boundary has not earned a
public SPI. Transport selection should follow a real operator registration and
a second genuinely different integration, not precede them.

## 3. Deliberate stop

The Agent vertical stops at review 157. The next Agent work requires an
administrator-owned retained provider substrate or an independently specified
host-policy/registration milestone. It must not be smuggled into FLOW
metadata, project Bindings, a test fixture, or the Runtime Adapter/Sandbox
Backend vocabulary.

This stop does not block deterministic Semantic Choice. A closed chooser can
be implemented and tested without an Agent. An Agent-backed chooser remains
blocked by this same provider boundary.

