# Project Authoring Probe/1

This directory defines a repeatable, instruction-restricted campaign for the
first Jig project authoring surface. It is a learnability and composition
probe, not a Starter, product fixture, or operational Jig conformance claim.

The campaign gives a fresh author only the files listed in
[`AUTHOR-DOCUMENTS.txt`](AUTHOR-DOCUMENTS.txt), packed candidate artifacts,
and [`AUTHOR-BRIEF.md`](AUTHOR-BRIEF.md). A separate evaluator receives the
frozen submission and the additional documents in
[`EVALUATOR-DOCUMENTS.txt`](EVALUATOR-DOCUMENTS.txt). Neither participant may
inspect Jig source, private tests, design reviews, historical probes, or edit
the platform to make the assignment pass.

Run [`prepare-packet.ts`](prepare-packet.ts) from a clean named revision to
create an ephemeral packet outside the repository. The packet manifest pins
the supplied bytes and records that no operational Jig host is present. A
missing documented operation is evidence, not permission to invent one.

The campaign tests whether an independent author can discover two Flow
packages, configure exactly one of them through a Binding, connect one exact
child-Flow slot, and use the TypeScript and Python Run SDKs. Runtime execution
is evaluated through a bounded Run/1 harness; it does not claim that the
packed Jig artifact can open or execute a project.

The author is the clean-room consumer. Evaluation is deliberately split: a
second reviewer can inspect the frozen source using only the packet, while the
release owner runs the private capture/link and Run/1 instrumentation from the
source checkout. Those private checks produce bounded evidence for the
reviewer; they are not a supplied or proposed Jig API. A future independently
packaged evaluator is release hardening, not a reason to publish private
linker or host machinery now.

Generated workspaces, installed dependencies, evaluator code, artifacts, and
reports live under `.tmp/` or another disposable directory and are not
committed. A particularly good submission may later inform a Starter, but the
campaign itself never becomes one automatically.
