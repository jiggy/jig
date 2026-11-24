# Codex ACP 2.6.0 Jig authority patch

The pinned upstream adapter implements ACP v2 negotiation and prompt insertion.
Jig applies the following restrictions to its private build.

- The trusted launcher supplies the subscription credential through a private startup descriptor.
  The adapter consumes the one-use in-memory bootstrap before app-server initialization completes.
  The finite connection receives no account-identity notifications.
- Suppress model-generated titles and prompt suggestions.
  The reviewed Agent grant authorizes only the requested turns.
- Compare the optional reviewed reasoning effort with each outgoing app-server
  turn. Refuse a mismatch before writing the turn, including after recovery.
- Wait for the matching native start event before interrupting the owned turn.
  Preserve completion that arrives before the start reply.
  Retry interruption only while the same prompt owns the same native turn.
  Publish cancelled idle before rejecting a prompt cancelled during native work before insertion.
- Propagate failed or forced app-server exit as adapter failure.
  Clear shutdown timers when the child settles.
- Preserve numeric HTTP statuses from 400 through 599 in the existing native failure metadata.
  Jig projects the bounded status without native error text.

The recorded app-server tests verify insertion, exact turn counts, cancellation order, failure projection, and cleanup.
Keep each restriction until upstream supplies equivalent behavior and the installed host tests confirm it.
