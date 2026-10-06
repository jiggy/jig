# Jig standard library

Jig includes a small library of agreements for common Flow tasks. Browse them
offline with `jig import-contract --list`, then copy the agreement you need:

```sh
mkdir -p contracts
jig import-contract jig:user-updates contracts/user-updates
```

For an invocation collaborator, `jig new worker --use agent=jig:agent-run`
copies the complete agreement and declares the slot in the new Flow. Edit its
implementation and configure the selected Agent before review and execution.
Channel agreements such as user-updates belong under `channels`, rather than `uses`.

| Agreement | Kind | Use it to |
| --- | --- | --- |
| [jig:agent-run](agent-run.md) | Invocation | Ask an operator-selected AI assistant for a bounded response. |
| [jig:project-command](project-command.md) | Invocation | Run a reviewed project command and collect evidence. |
| [jig:http-request](http-request.md) | Invocation | Make a request through a reviewed HTTP grant. |
| [jig:run-checkpoint](run-checkpoint.md) | Invocation | Save settled results while other work continues. |
| [jig:finite-acp](finite-acp.md) | Invocation | Use one bounded ACP conversation. |
| [jig:acp-public-updates](acp-public-updates.md) | Channel | Observe public updates supplied by an AI client. |
| [jig:user-updates](user-updates.md) | Channel | Report complete messages and current activity. |

The `jig:` name selects the exact agreement bundled with your installed Jig
version. Import preserves its descriptor, referenced files and license in a new
directory. Your copy remains a project-owned snapshot when Jig is upgraded.
Use its local path in the Flow declaration; its full contract URL, version and
digest still identify the portable agreement. Other FLOW hosts can use the same
files. No runtime `jig:` resolution or network fetch is involved.

An agreement does not supply an implementation or grant permissions. Agent
implementations remain ordinary dependencies, and commands, HTTP access and
storage still require their reviewed operator configuration. Language helpers
such as the scoped user-updates publishers remain independently usable libraries.

For contracts from other libraries, use `npm:package` or a local descriptor
with the same importer. Each agreement keeps its own license; user-updates is
MPL-2.0, while the other bundled agreements follow Jig's license.
