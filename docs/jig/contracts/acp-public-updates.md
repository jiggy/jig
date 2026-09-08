# ACP public updates contract

This identity names the meaning of selected public updates from one Agent turn.
It is not an ACP endpoint, subscription URL or request for session access.

The [canonical descriptor](https://jig.md/contracts/acp-public-updates.json)
defines text fragments that append to the current message and complete plan
replacements. Thoughts, tools, permissions and raw ACP payloads are excluded.
Its exact identity, version and digest are checked offline.

Copy the descriptor into `contracts/acp-public-updates.json` beside the Agent
Run descriptor in a Flow package. Use the package-local reference to create a
named channel, then pass its send endpoint to Agent Run's optional `events`
channel. A generic text stream cannot impersonate this named agreement merely
because its values look similar.

See [live Agent progress](../guide/channels.md) for ordinary usage and
[Jig channels](../spec/channels.md) for limits and failure behavior. Updates and
EOF do not replace the Agent's final result.
