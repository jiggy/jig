# Kanban board

The `kanban` FLOW Service writes one card to `cards/<card-id>.json`.

These files are application data, not Jig policy or runtime state. They remain
ordinary and inspectable so a later CLI or GUI can render the same board.
