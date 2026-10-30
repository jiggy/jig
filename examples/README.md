# Build software with code and Agents

Try [Photo organiser](photo-organiser/) for a visible before-and-after collection.
Start with **Contact import** for a code-only first run: produce a useful CSV preview without an Agent,
then swap in Agent interpretation for unfamiliar headings. Each example introduces one primary idea; adapt it
without treating it as a complete production solution. These examples use the ordinary public FLOW SDK and Jig
interfaces. Choose an Agent on your host; the applications do not choose a
provider or carry credentials.

Foundational examples keep the demonstrated methods inside the project.
Composition examples may use independently maintained FLOW packages through
ordinary versioned dependencies, while keeping application wiring, checks and
operator grants visible locally. Each example must be understandable and usable
on its own, without another example or sibling checkout.

| Start here | What you get | What you learn |
| --- | --- | --- |
| [Photo organiser](photo-organiser/) | Grouped image copies, a manifest and a before/after contact sheet | Agent interpretation proposes event groups; code checks complete assignments and safe filenames. |
| [Kitchen roster](kitchen-roster/) | Eight checked volunteer assignments in a CSV | Compose focused Flows; Agent preferences cannot override availability, qualifications or workload. |
| [Contact import](contact-import/) | A contact preview from an unfamiliar CSV | Compose code and Agent mapping through one boundary, then validate rows in code. |
| [Support case](support-case/) | A disputed-charge decision and reply | Code checks an Agent's proposal against account facts and application policy. |
| [Tested patch](tested-patch/) | A patch with executed checks and evidence | A reusable repair method combines Agent proposals with independent acceptance. |

Complete [workspace setup](../docs/jig/guide/dependencies.md#local-workspace-packages)
and follow the selected example's README on a
[supported host](../docs/jig/guide/index.md#supported-host).
The [documentation](../docs/jig/guide/overview.md) explains installation,
Agent configuration, results, and integration.

Support case returns its result on stdout
without creating a packet by default. The file-producing examples receive fresh packet directories
in operating-system temporary storage; Jig reports each destination on stderr.
The operating system may clear that storage. Use `jig run --out DIRECTORY` for a
chosen retained location. The directory must be new; existing results are never
overwritten.

Each application publishes optional semantic application views through the standard
[reporting contract](../docs/jig/contracts/reporting.md). Add `--display
tui` for terminal inspection or `--display web` for a private local browser
display, using the invocation arguments in its README. The host supplies actual calls
and blocking causes. Application views explain the requested work and its evidence.

| Application | Domain views |
| --- | --- |
| Photo organiser | Photos gallery, checked organisation and before/after contact sheet |
| Kitchen roster | Saturday shifts, checked assignments and the roster CSV |
| Support case | Customer request, relevant charges, checked eligibility and draft reply |
| Contact import | Source mapping, accepted contacts, correction reasons and complete preview |
| Tested patch | Requested repair, original/candidate checks and review files |

The examples keep typed application state separate from pure view projections.
Stable targets identify captured sources or domain requests across Runs. They do not replace the actual publisher's provenance.
Contact import uses `previewCollection` to retain complete selected rows and disclose omitted counts.
Photo organiser uses gallery roles and captured input references. Kitchen roster offers captured CSV content, while tested patch labels literal code and diffs.

Select delivered file references to read content. Completed inspection remains open
until explicit exit. Reopen a saved packet with `jig inspect --result DIRECTORY
--display web` or `--display tui`; saved packets contain recorded results, files
and diagnostics, rather than retained live views. Dashboards are observations, never
authority to issue a credit, import records, publish a brief or apply a patch.

Fixtures are synthetic. The examples teach authored procedures and their
boundaries; successful runs do not establish general model accuracy.

The software factory is planned for extraction into an independent project.
Its source remains temporarily in this tree to preserve existing host checks;
it is outside the cookbook. Tested patch is the developer repair example.

## Check the examples

CI runs one end-to-end case for every example against the current package archives.
Each case copies the complete original project, installs its dependencies,
reviews it, runs its authored default invocation and checks the expected result.
Manifests, Bindings and Flow source must remain unchanged. Assertions cover
delivered files and native cleanup as well as stdout.

These tests use a genuine Codex client with a controlled HTTPS model endpoint.
They check the application and native execution path without live model calls.
Run `just test-examples` on the qualified Linux test host with its frozen
archives, client and test certificate setup. Missing prerequisites fail explicitly.

For portable source checks after workspace setup, run `just test-example-source`.
This installs every example, evaluates its declarations, bundles its Flow imports
and runs its application tests. New examples require both source and end-to-end coverage.
