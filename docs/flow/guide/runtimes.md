---
title: Runtimes and Language Support
description: Language support matrix, runtime environments, and how to implement new FLOW SDKs.
---

# Runtimes and Language Support

FLOW is runtime-neutral. Any language capable of reading standard input and
writing standard output can execute as a Flow component or serve as a FLOW host.

This guide provides the current language and runtime support matrix, clarifies
the boundaries between language runtimes and host support, and outlines how
to implement a FLOW SDK for a new language.

---

## Language & Runtime Support Matrix

To evaluate compatibility honestly, distinguish between the authoring language,
the process runtime, SDK availability, and host platform support:

| Language / Format | Runtime Engine | Official SDK / Interpreter | Registry Distribution | Host Execution Support |
| --- | --- | --- | --- | --- |
| **Markdown** | Host reasoning interpreter | Markdown/0 interpreter | Built into host | Supported on Jig & compatible hosts |
| **TypeScript** | Node.js (20+), Bun (1.1+) | `@jigging/flow` | npm: `@jigging/flow@alpha` | Supported |
| **JavaScript** | Node.js (20+), Bun (1.1+) | `@jigging/flow` | npm: `@jigging/flow@alpha` | Supported |
| **Python** | CPython (3.11+) | `jiggy-flow` | PyPI: `jiggy-flow` (`--pre`) | Supported |
| **Other Languages**<br>*(Go, Rust, etc.)* | Native executable | Community / Custom Run/0 | Implement against Run/0 | Any Run/0 compliant host |

### Key Boundaries to Understand

1. **SDK Availability ≠ Host Support**:
   An SDK (such as `@jigging/flow` or `jiggy-flow`) provides protocol serialization
   and handler bindings in that language. Running that code requires a host that
   supports the matching runtime engine.
2. **Runtime Engine ≠ Operating System Matrix**:
   Node.js or Python may run across many platforms (Windows, Linux, macOS),
   while a specific host (such as Jig) may provide native sandboxing and process
   containment on specific operating systems (e.g. Linux x86_64/aarch64, macOS).
3. **Markdown Execution Requires a Reasoning Interpreter**:
   Unlike TypeScript or Python which run deterministically on their engines,
   `FLOW.md` files require a host equipped with a Markdown interpreter and
   an admitted Agent/model provider to interpret instructions and select recipes.

---

## Implementing a FLOW SDK for a New Language

If you are developing a FLOW SDK in Go, Rust, Ruby, or another language,
follow the normative [Run SDK/0 specification](/spec/run-sdk).
The SDK's primary job is to provide an ergonomic `handle()` function that wraps
the underlying [Run/0 wire protocol](/spec/run-protocol).

### Core Responsibilities of an SDK

A standard SDK implements four core tasks:

```text
┌────────────────────────────────────────────────────────┐
│                   FLOW SDK (handle)                    │
│                                                        │
│  1. Transport Ownership (redirect stdout/logging)      │
│  2. Handshake & Input Dispatch                         │
│  3. Slot Invocation Helper (call)                      │
│  4. Result Serialization & Signal Cancellation         │
└────────────────────────────────────────────────────────┘
```

#### 1. Transport Ownership & Stdout Discipline
Standard output (`stdout` or file descriptor 1) belongs exclusively to the
Run/0 JSON-RPC protocol. Any unexpected text (such as unformatted log messages)
corrupts the protocol frame.
- When `handle()` initializes, divert standard application logging
  (e.g. `console.log` in JS, `print()` in Python, or standard loggers in Go/Rust)
  to standard error (`stderr` / fd 2).
- Keep `stdout` dedicated strictly to newline-delimited JSON-RPC frames.

#### 2. Run Invocation & Context Dispatch
Read the single `run` request from standard input:
```json
{ "jsonrpc": "2.0", "id": 1, "method": "run", "params": { "input": ... } }
```
Construct a `RunContext` passed to the user's handler function containing:
- `input`: The deserialized input data.
- `signal`: A cancellation token/signal triggered when a `cancel` notification
  or process termination signal is received.
- `call`: A method for invoking child dependency slots.

#### 3. Servicing Child Calls (`call`)
When the user's handler calls a child slot:
1. Generate a unique request ID (e.g. `c1`, `c2`).
2. Write a JSON-RPC request to stdout:
   ```json
   {
     "jsonrpc": "2.0",
     "id": "c1",
     "method": "call",
     "params": {
       "slot": "summarizer",
       "operationId": "summary:1",
       "input": "..."
     }
   }
   ```
3. Await the host's response on stdin matching that ID:
   ```json
   {
     "jsonrpc": "2.0",
     "id": "c1",
     "result": { "outcome": "done", "output": { "summary": "..." } }
   }
   ```
4. Return the outcome and output to the user's code.

#### 4. Result Serialization
When the user's handler returns:
1. Validate that the returned value contains an `outcome` string (e.g., `"done"`).
2. Write the final response to stdout:
   ```json
   {
     "jsonrpc": "2.0",
     "id": 1,
     "result": {
       "outcome": "done",
       "output": { ... }
     }
   }
   ```
3. Flush stdout and exit cleanly with code `0`.

---

## Verifying Conformance

Do not rely on ad-hoc testing alone. Verify your SDK or host against the
implementation-independent conformance suite:

- Use the test cases in `conformance/run-0` to validate frame formatting,
  error codes (`-32600` for invalid request, `-32602` for invalid params),
  and slot routing.
- Test failure conditions: ensure your SDK surfaces host errors as distinct
  exceptions rather than silent failures.
- Validate cancellation: ensure in-flight child calls abort when cancellation
  notifications are received.
