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
The published Jig version in the manifest accepts Bun 1.3.3 locks on Linux and macOS.
Run these commands from the copy.

```sh
bun install --ignore-scripts
node --test wiring.mjs
```

To test a locally packed Jig archive, use its qualified Bun release and replace the install command.

```sh
bun add --dev --ignore-scripts /absolute/path/to/jig.tgz
node --test wiring.mjs
```

The test installs a Flow dependency lock in each temporary project before review.
It needs registry access for installation and no provider credentials.
The test invokes ordinary review without granting dependency resolution access to Jig.
It retains failing projects and removes successful projects.
To retain every review, native receipt, and artifact packet, set `JIG_WIRING_EVIDENCE_DIRECTORY` to an existing private directory outside the checkout.

The public attempt client identifies the approved targets and slot selections.
The review report gives the actual scope, purpose, excerpt, and decision returned by each reviewer.
Each test joins the accepted Run and checks its retained terminal and exported report.
The wrong-scope case edits the shared producer itself and verifies that the preserved book assertion rejects the changed result.
