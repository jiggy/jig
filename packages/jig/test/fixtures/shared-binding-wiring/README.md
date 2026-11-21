# Test a shared producer Binding

The book and offer Bindings start by calling the same producer Binding.
The scoped edit creates an offer producer Binding and changes only the offer caller's selection.
The new Binding selects the specialist for post-edit chapters.
The standard reviewer still handles developmental chapters and whole books.

A fresh call reviews a draft chapter and a post-edit chapter.
A resumed call starts at the post-edit chapter.
Both calls review the entire manuscript before delivery.

Copy this directory to an empty location outside the Jig checkout.
Use Bun supported by the installed Jig release and Node 22 or later.
Use a Jig archive that includes the `types --project` command.
Run these commands from the copy.

```sh
bun add --dev --ignore-scripts /absolute/path/to/jig.tgz
node --test wiring.mjs
```

The type-check scenario generates a project declaration and specializes the offer's typed producer from a typed caller.
It checks the edited Bindings with standard `tsc` and Jig's contained evaluator.
It also checks that `tsc` identifies an unknown slot and a mistyped setting in their Binding declarations.
The diff and review preview show the scoped edit and the preserved book, shared producer, and direct Flow selectors.

The test installs a Flow dependency lock in each temporary project before review.
It needs registry access for installation and no provider credentials.
The test invokes ordinary review without granting dependency resolution access to Jig.
It retains failing projects and removes successful projects.
To retain every review, native receipt, and artifact packet, set `JIG_WIRING_EVIDENCE_DIRECTORY` to an existing private directory outside the checkout.

The public attempt client identifies the approved targets and slot selections.
The review report gives the actual scope, purpose, excerpt, and decision returned by each reviewer.
Each test joins the accepted Run and checks its retained terminal and exported report.
The wrong-scope case edits the shared producer itself and verifies that the preserved book assertion rejects the changed result.
