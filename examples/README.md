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

Each application publishes one optional, display-neutral application page through the standard
[reporting contract](../docs/jig/contracts/reporting.md). Add `--display
tui` for terminal inspection or `--display web` for a private local browser
display, using the invocation arguments in its README. The host supplies actual calls
and blocking causes; application views explain the requested work and its evidence.

| Application | Domain views |
| --- | --- |
| Photo organiser | Original filenames, event groups and checked copies |
| Kitchen roster | Saturday shifts, checked assignments and the roster CSV |
| Support case | Customer request, relevant charges, checked eligibility and draft reply |
| Contact import | Source mapping, accepted contacts, correction reasons and complete preview |
| Tested patch | Requested repair, original/candidate checks and review files |

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
