---
title: Host and Platform Integration
description: Implement FLOW execution in coding agents, ACP clients, and agent platforms.
---

# Host and Platform Integration

FLOW is an open, host-neutral standard. Any developer tool, agent runtime,
or application platform can become a FLOW host—giving software the ability to
call, combine, and compound executable know-how.

This guide is for maintainers integrating FLOW execution into their systems.
It explains the core responsibilities of a FLOW host, maps how FLOW fits
alongside protocols like the Agent Client Protocol (ACP), and outlines the
minimal complete path to running a Flow.

---

## Architectural Roles: FLOW and ACP

FLOW and ACP address complementary, orthogonal concerns in agentic architecture:

| Protocol | Connects | Purpose | Wire boundary |
| --- | --- | --- | --- |
| **FLOW** | Host ↔ Component | Callable execution of discrete know-how packages (`FLOW.*`) | JSON-RPC 2.0 over standard I/O (Run/0) |
| **ACP** | Client ↔ Agent | Interactive collaboration between editors/clients and coding agents | Client/Agent JSON-RPC sessions |

Because these roles are orthogonal, there are two primary integration shapes
when combining them:

```text
Shape 1: FLOW Host inside an ACP Agent (Agent-hosted)
┌────────────────┐     ACP      ┌───────────────────────────────────┐
│   ACP Client   │ ───────────► │             ACP Agent             │
│ (Editor / IDE) │              │  (FLOW Host)                      │
└────────────────┘              │       │ Run/0                     │
                                │       ▼                           │
                                │  ┌──────────────┐                 │
                                │  │ FLOW Package │                 │
                                │  └──────────────┘                 │
                                └───────────────────────────────────┘

Shape 2: FLOW Host in an ACP Client / Platform (Platform-hosted)
┌───────────────────────────────────┐     ACP      ┌────────────────┐
│      ACP Client / Orchestrator    │ ───────────► │   ACP Agent    │
│  (FLOW Host)                      │ ◄─────────── │ (Specialist)   │
│       │ Run/0                     │   (slot)     └────────────────┘
│       ▼                           │
│  ┌──────────────┐                 │
│  │ FLOW Package │                 │
│  └──────────────┘                 │
└───────────────────────────────────┘
```

### Shape 1: Embedded inside an ACP Agent

In this placement, the coding agent (the ACP Agent) also acts as an internal
FLOW host. When performing user tasks, the agent discovers and invokes Flow
packages locally as reusable methods or specialized tools.

- **Responsibilities**: The agent process prepares the Flow package, spawns
  the runtime process, feeds input via stdin, receives structured outcomes
  via stdout, and presents or utilizes the result within its reasoning loop.
- **Benefit**: The agent acquires structured, deterministic procedures without
  converting every multi-step recipe into ad-hoc prompt instructions or
  uncontrolled bash commands.

### Shape 2: Coordinated by an ACP Client or Platform

In this placement, the coordinating application or platform (the ACP Client)
acts as the FLOW host. The platform executes Flows that may declare child
dependencies (slots). When a Flow requires agent reasoning or interactive
judgment, the host delegates that slot call across ACP to one or more ACP
Agents.

- **Responsibilities**: The platform manages the outer workflow lifecycle,
  sandboxes Flow processes, and routes slot calls (`call`) to the appropriate
  ACP Agent session.
- **Benefit**: Agent workflows become modular, testable packages whose
  composition and control remain governed by application code rather than
  opaque, unconstrained agent loops.

---

## Minimal Complete Host Implementation

A compliant FLOW host implements the [Run/0 protocol](/spec/run-protocol).
A complete lifecycle involves nine operational duties:

```text
1. Inspect Package ──► 2. Prepare Sandbox ──► 3. Send Run Request
                                                       │
6. Process Exit    ◄── 5. Receive Outcome ◄── 4. Service Child Calls
```

### 1. Package Inspection

Inspect the directory to locate the single executable entrypoint:
- Look for exactly one file matching `FLOW.<suffix>` (e.g. `FLOW.md`,
  `FLOW.ts`, `FLOW.py`). If zero or multiple entrypoints exist, reject the
  package with format error.
- Check optional `FLOW.meta.json` for declared dependencies and slots.
- Check optional `FLOW.contract.json` for input/result schemas, custom
  domain outcomes, and channel declarations.

### 2. Sandbox and Process Preparation

Spawn the appropriate interpreter or runner:
- Pipe standard input (`stdin`) and standard output (`stdout`).
- Direct standard error (`stderr`) to diagnostic logging.
- Set an explicit working directory and clean environment. Never pass
  ambient API tokens or credentials unless explicitly admitted for that Flow.

### 3. Protocol Framing (Run/0)

Run/0 uses newline-delimited JSON-RPC 2.0 messages over standard I/O.
The host initiates execution by sending a single `run` request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "run",
  "params": {
    "input": "Ada"
  }
}
```

### 4. Servicing Child Calls (Slot Delegation)

If the executing Flow calls a child dependency, it writes a `call` request:

```json
{
  "jsonrpc": "2.0",
  "id": "c1",
  "method": "call",
  "params": {
    "slot": "greeter",
    "operationId": "greet:1",
    "input": "Ada"
  }
}
```

The host intercepts this request, resolves the configured slot (to another
Flow, an ACP Agent, or internal logic), executes it, and replies with a
matching JSON-RPC response:

```json
{
  "jsonrpc": "2.0",
  "id": "c1",
  "result": {
    "outcome": "done",
    "output": { "message": "Hello, Ada!" }
  }
}
```

### 5. Outcome vs Failure

When the method finishes, it returns a terminal JSON-RPC result:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "outcome": "done",
    "output": { "result": "Success" }
  }
}
```

Hosts must distinguish between three distinct categories of outcomes:
- **Successful protocol execution with domain outcome**: The result contains
  `outcome` (e.g., `"done"`, `"blocked"`, `"not-found"`). Domain outcomes are
  normal data; they are not protocol failures.
- **Operational protocol failure**: The response contains a JSON-RPC `error`
  object (e.g., code `-32602` for invalid parameters, `-32000` for execution
  failure).
- **Process crash or timeout**: The process exits non-zero, writes unparseable
  stdout framing, or exceeds deadline.

### 6. Cancellation and Lifecycle Cleanup

- If the caller cancels work or a deadline expires, the host sends a JSON-RPC
  notification:
  ```json
  { "jsonrpc": "2.0", "method": "cancel", "params": {} }
  ```
- Give the process a bounded grace period to flush diagnostics and exit cleanly.
- If the process fails to exit within the grace window, terminate it (`SIGTERM`,
  then `SIGKILL`).
- Reclaim temporary files, fifos, and allocated OS resources.

---

## Minimal Host Skeleton (Node.js / TypeScript)

Below is a minimal host runner in TypeScript demonstrating standard process
spawning, framing, and result extraction:

```ts
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

interface FlowRunResult {
  outcome: string;
  output?: unknown;
}

export async function runFlow(
  command: string,
  args: string[],
  cwd: string,
  input: unknown
): Promise<FlowRunResult> {
  const child = spawn(command, args, {
    cwd,
    stdio: ["pipe", "pipe", "inherit"], // stderr flows to host console
    env: { ...process.env, NODE_ENV: "production" },
  });

  const lines = createInterface({ input: child.stdout });

  return new Promise((resolve, reject) => {
    let completed = false;

    // 1. Send the initial Run request
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "run",
      params: { input },
    });
    child.stdin.write(`${request}\n`);

    // 2. Handle incoming lines from stdout
    lines.on("line", (line) => {
      try {
        const msg = JSON.parse(line);

        // Check for terminal result
        if (msg.id === 1) {
          completed = true;
          if (msg.error) {
            reject(new Error(`Flow error [${msg.error.code}]: ${msg.error.message}`));
          } else {
            resolve(msg.result as FlowRunResult);
          }
          child.stdin.end();
        }
      } catch (err) {
        reject(new Error(`Malformed protocol frame: ${line}`));
      }
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (!completed) {
        reject(new Error(`Flow process exited prematurely with code ${code}`));
      }
    });
  });
}
```

---

## Production Sandboxing vs. Protocol Conformance

The protocol framing above confirms wire compatibility. It does **not**
provide security or multi-tenant containment.

A production host is responsible for:
1. **Filesystem Isolation**: Restricting writes to declared output targets or
   ephemeral workspaces (e.g. using Bubblewrap, Landlock, or container cgroups).
2. **Network Policy**: Denying arbitrary outbound network requests unless
   explicitly authorized.
3. **Resource Quotas**: Enforcing maximum resident memory, CPU time, and wall-clock
   execution timeouts.
4. **Credential Safeguards**: Keeping API keys outside the process environment
   and passing credentials only through scoped host calls.

FLOW components cannot grant themselves system permissions or bypass host
controls. The authority model remains strictly local to your host.

---

## Conformance and Next Steps

To verify your host implementation against the standard test suite:

- Read the normative [Run/0 Specification](/spec/run-protocol).
- Read the [Package/0 Specification](/spec/package-format) and [Invocation Contracts](/spec/invocation-contracts).
- Run the executable conformance test suite under `conformance/run-0`.
- Join technical discussions on [GitHub Discussions](https://github.com/jiggy/jig/discussions) to share feedback or ask implementation questions.
